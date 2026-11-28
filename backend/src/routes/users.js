const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/db");

const router = express.Router();

//if email doesnt exit - hacker can time reesponses and discover which emails are registered - dummy has events out timing

const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

//POST/users - register
router.post("/", async (req, res) => {
  const {
    user_name,
    password,
    user_is_business = false,
    user_prof_img = null,
  } = req.body;
  //make sure lowercase so its no duplicate accounts bc of casing
  const user_email =
    typeof req.body.user_email === "string"
      ? req.body.user_email.trim().toLowerCase()
      : "";

  // validation check if they fit the requirements
  if (!user_name || !user_email || !password) {
    return res
      .status(400)
      .json({ error: "user_name, user_email and password are required" });
  }

  if (!EMAIL_RE.test(user_email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  if (typeof password !== "string" || password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }

  if (typeof user_is_business !== "boolean") {
    return res
      .status(400)
      .json({ error: "user_is_business must be true or false" });
  }

  try {
    //10-12 typical hash range for pass
    const hash = await bcrypt.hash(password, 10);

    //keeps hash out of response
    const { rows } = await pool.query(
      `INSERT INTO users (user_name, user_email, user_password, user_is_business, user_prof_img) 
        VALUES ($1, $2, $3, $4, $5)
        RETURNING user_id, user_name, user_email, user_is_business, user_prof_img`,
      //check if user pass is correct in that case
      [user_name.trim(), user_email, hash, user_is_business, user_prof_img],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    // postgres UNIQUE violation
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username or email already taken" });
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

//POST /users/login
router.post("/login", async (req, res) => {
  const user_email =
    typeof req.body.user_email === "string"
      ? req.body.user_email.trim().toLowerCase()
      : "";

  const { password } = req.body;

  if (!user_email || typeof password !== "string") {
    return res
      .status(400)
      .json({ error: "user_email and password are required" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT user_id, user_password FROM users WHERE user_email = $1`,
      [user_email],
    );

    const user = rows[0];

    //safety check runs bcrypt, real or dummy hash
    const ok = await bcrypt.compare(
      password,
      user ? user.user_password : DUMMY_HASH,
    );

    //error msg if fail, w/o mentioning what the cause is for potential hacker
    if (!user || !ok)
      return res.status(401).json({ error: "Invalid email or password" });

    // token holds user_id only, signature proves nonaltered but anyone can access jwt
    const token = jwt.sign({ user_id: user.user_id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
