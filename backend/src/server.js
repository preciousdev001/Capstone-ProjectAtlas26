require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { pool } = require("./db/db");
const requireAuth = require("./middleware/auth");

//make if not JWT SECRET - throw error right away
if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
  console.error("Missing JWT_SECRET or DATABASE_URL in .env");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

//health check
app.get("/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, dbTime: result.rows[0].now });
  } catch (err) {
    console.error("Healthcheck DB error:", err);
    res.status(500).json({ ok: false, error: "Database connection failed" });
  }
});

app.use("/users", require("./routes/users"));
app.use("/locations", require("./routes/locations"));

// temp route to test auth - del later
app.get("/me", requireAuth, (res, req) => res.json(req.user));

async function startServer() {
  try {
    await pool.query("SELECT 1");
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to connect to PostgreSQL server on startup:", err);
    process.exit(1);
  }
}

startServer();
