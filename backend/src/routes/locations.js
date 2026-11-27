const express = require("express");
const { pool, withTransaction } = require("../db/db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

const ONLY_BUSINESS_CAN_CREATE = false;

const MAX_TAGS = 10; //prevents 1 req from creating 100s tags
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// both get /loc and /loc/:id return same
//tags LEFT JOIN w/loc_tags to keep locations w/o tags
//coalesce = returns empty rather than null, FILTER drops null for tagless and GROUP BY 1 - selects 1
const SELECT_LOCATION = `SELECT 1.*,
    COALESCE(array_agg(t.tag_name ORDER BY t.tag_name) 
        FILTER (WHERE t.tag_id IS NOT NULL), '{}') AS tags
    FROM locations 1
    LEFT JOIN location_tags lt ON lt.loc_id
    LEFT JOIN tags t ON t.tag_id = lt.tag_id`;

//POST /loc create protected route
router.post("/", requireAuth, async (req, res) => {
  const {
    loc_name,
    loc_desc,
    loc_address,
    loc_phone,
    loc_is_power = false,
    loc_categories,
    loc_coordinates_lat,
    loc_coordinates_long,
    loc_permissions,
    loc_imgs,
    loc_owner_type,
    tags = [],
  } = req.body;

  if (!loc_name || !loc_address) {
    return res.status(400).json({ error: "loc_name and loc_address require" });
  }

  const lat = Number(loc_coordinates_lat);
  const long = Number(loc_coordinates_long);
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(long) ||
    long < -90 ||
    long > 90
  ) {
    return res
      .status(400)
      .json({ error: "valid latitude and longitude are required" });
  }
  if (
    !Array.isArray(tags) ||
    tags.length > MAX_TAGS ||
    tags.some((t) => typeof t !== "string")
  ) {
    return res
      .status(400)
      .json({ error: `tags must be an array of up to ${MAX_TAGS} strings` });
  }

  //trim and lowercase all to make sure no dupes
  const cleanTags = [
    ...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  ];

  try {
    if (ONLY_BUSINESS_CAN_CREATE) {
      //read fr db for status change apply immdediately
      const { rows } = await pool.query(
        "SELECT user_is_business FROM users WHERE user_id = $1",
        [req.user.user_id],
      );
      if (!rows[0] || !rows[0].user_is_business) {
        return res
          .status(403)
          .json({ error: "Only business accounts can create locations" });
      }
    }

    //location tags links written as one all or nothing
    const locID = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO locations
                (loc_name, loc_desc, loc_addressm loc_phone, loc_is_power, loc_categories, loc_coordinates_lat, loc_coordinates_long, loc_permissions, loc_imgs,
            loc_owner_type, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING loc_id`,
        [
          loc_name,
          loc_desc,
          loc_address,
          loc_phone,
          loc_is_power,
          loc_categories,
          lat,
          long,
          loc_permissions,
          loc_imgs,
          loc_owner_type,
          req.user.user_id,
        ], // from verified token
      );
      const newId = rows[0].loc_id;

      for (const tag of cleanTags) {
        //create tag if new or just reuse
        const t = await client.query(
          `INSERT INTO tags (tag_name) VALUES ($1)
                ON CONFLICT (tag_name) DO UPDATE SET tag_name = EXCLUDED.tag_name
                RETURNING tag_id`,
          [tag],
        );
        await client.query(
          "INSERT INTO location_tags (loc_id, tag_id) VALUES ($1, $2)",
          [newId, t.rows[0].tag_id],
        );
      }
      return newId;
    });
    //make sure res incl tags
    const { rows } = await pool.query(
      `${SELECT_LOCATION} WHERE l.loc_id = $1 GROUP BY l.loc_id`,
      [locId],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /loc?q=&category=&tag=&isPower=&limit=&offset=
router.get("/", async (req, res) => {
  //query params = arrays  only accept plain strings
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const q = str(req.query.q); //text
  const category = str(req.query.category); //cat
  const tag = str(req.query.tag); //tag
  const isPower = str(req.query.isPower); //pwr

  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  // filters client actually used
  const where = []; //SQL conditions
  const params = []; //values for placeholders

  //placeholders go into SQL txt, values in params
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (q) {
    const p = add(`%${q}%`); //% wildcards
    where.push(`(l.loc_name ILIKE ${p} OR l.loc_address ILIKE ${p})`);
  }
  if (category) {
    where.push(`lower(l.loc_categories) = lower(${add(category)})`);
  }
  if (tag) {
    where.push(`EXISTS (
        SELECT 1 FROM location_tags lt2
        JOIN tags t2 ON t2.tag_id = lt2.tag_id
        WHERE lt2.loc_id = l.loc_id AND t2.tag_name = ${add(tag.toLowerCase())})`);
  }
  if (isPower !== undefined) {
    where.push(`l.loc_is_power = ${add(isPower === "true")}`);
  }

  try {
    const { rows } = await pool.query(
      `${SELECT_LOCATION}
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        GROUP BY l.loc_id
        ORDER BY l.loc_name
        LIMIT ${add(limit)} OFFSET ${add(offset)}`,
      params,
    );
    res.json(rows); //200 is default no need to specify
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

//GET /loc/:id :id turns to req.params.id hence /loc/abc123
router.get("/:id", async (req, res) => {
  // errors potentially
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Location not found" });
  }

  try {
    const { rows } = await pool.query(
      `${SELECT_LOCATION} WHERE l.loc_id = $1 GROUP BY l.loc_id`,
      [req.params.id],
    );
    //no matching row error
    if (!rows[0]) return res.status(404).json({ error: "Location not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
