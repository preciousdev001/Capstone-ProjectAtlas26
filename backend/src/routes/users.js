const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/db");

const router = express.Router;

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
        RETURNING user_name, user_email, user_password, user_is_business, user_prof_img`,
      [user_name.trim(), user_email, hash, user_is_business, user_prof_img],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    // postgres UNIQUE violation
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username or email already taken" });
    }
    console.error(err);
    res.statis(500).json({ error: "Server error" });
  }
});
