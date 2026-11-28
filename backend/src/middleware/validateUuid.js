const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(req, res, next, value) {
  if (!UUID_RE.test(value)) return res.status(404).json({ error: "Not Found" });
  next();
}

module.exports = { uuidParam, UUID_RE };
