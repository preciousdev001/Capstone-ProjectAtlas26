const jwt = require("jsonwebtoken");

// attached to each route
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing token" });

  try {
    //verify signature and expiry
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    //attach whats needed by handlers, all ese read from db when needed
    req.user = { user_id: payload.user_id };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
module.exports = requireAuth;
