require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { pool } = require("./db/db");

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

app.get("/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, dbTime: result.rows[0].now });
  } catch (err) {
    console.error("Healthcheck DB error:", err);
    res.status(500).json({ ok: false, error: "Database connection failed" });
  }
});

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
