const { pool } = require("../db/db");

const TARGETS = {
  location: { table: "locations", idCol: "loc_id", ownerCol: "created_by" },
  review: { table: "reviews", idCol: "rev_id", ownerCol: "user_id" },
  list: { table: "lists", idCol: "list_id", ownerCol: "user_id" },
};

//guard clauses for potential errors
async function checkOwner(kind, id, userId) {
  const t = TARGETS[kind];
  const { rows } = await pool.query(
    `SELECT ${t.ownerCol} AS owner FROM ${t.table} WHERE ${t.idCol} = $1`,
    [id],
  );
  if (!rows[0]) return "not_found";
  return rows[0].owner === userId ? "ok" : "forbidden";
}

function denyIfNotOwner(status, res, label) {
  if (status === "not_found") {
    res.status(404).json({ error: `${label} not found` });
    return true;
  }

  //someone else is owner
  if (status === "forbidden") {
    res
      .status(403)
      .json({ error: `You don't own this ${label.toLowerCase()}` });
    return true;
  }

  return false;
}
module.exports = { checkOwner, denyIfNotOwner };
