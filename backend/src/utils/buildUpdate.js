const { param } = require("../routes/users");

function buildUpdate(body, allowed) {
  const sets = [];
  const params = [];

  for (const col of allowed) {
    if (body[col] === undefined) continue;
    params.push(body[col]);
    sets.push(`${col} = ${params.length}`);
  }
  return { sets, params };
}

module.exports = { buildUpdate };
