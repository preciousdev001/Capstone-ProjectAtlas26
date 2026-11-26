require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

//idle connection errors - ex. db restart, needs a listener so node doesnt treast as uncaught exception
pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
  process.exit(-1);
});

//run in transact - all queries succeed together or none are kept
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err; //route decides what the user sees
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
