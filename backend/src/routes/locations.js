const express = require("express");
const { pool, withTransaction } = require("../db/db");
const requireAuth = require("../middleware/auth");
const { checkOwner, denyIfNotOwner } = require("../utils/ownership");
const { buildUpdate } = require("../utils/buildUpdate");
const { uuidParam } = require("../middleware/validateUuid");

const router = express.Router();

router.param("id", uuidParam);

const ONLY_BUSINESS_CAN_CREATE = false;

const MAX_TAGS = 10; //prevents 1 req from creating 100s tags

// both get /loc and /loc/:id return same
//tags LEFT JOIN w/loc_tags to keep locations w/o tags
//coalesce = returns empty rather than null, FILTER drops null for tagless and GROUP BY l - selects l
const SELECT_LOCATION = `SELECT l.*,
    COALESCE(array_agg(t.tag_name ORDER BY t.tag_name) 
        FILTER (WHERE t.tag_id IS NOT NULL), '{}') AS tags
    FROM locations l
    LEFT JOIN location_tags lt ON lt.loc_id = l.loc_id
    LEFT JOIN tags t ON t.tag_id = lt.tag_id`;

const EDITABLE = [
  "loc_name",
  "loc_desc",
  "loc_address",
  "loc_phone",
  "loc_is_power",
  "loc_categories",
  "loc_coordinates_lat",
  "loc_coordinates_long",
  "loc_permissions",
  "loc_imgs",
  "loc_owner_type",
];

const COORD_RANGES = [
  ["loc_coordinates_lat", -90, 90],
  ["loc_coordinates_long", -180, 180],
];

function normalizeTags(tags) {
  if (
    !Array.isArray(tags) ||
    tags.length > MAX_TAGS ||
    tags.some((t) => typeof t !== "string")
  ) {
    return null;
  }
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

async function saveTags(client, locId, cleanTags) {
  for (const tag of cleanTags) {
    const t = await client.query(
      `INSERT INTO tags (tag_name) VALUES ($1)
            ON CONFLICT (tag_name) DO UPDATE SET tag_name = EXCLUDED.tag_name
            RETURNING tag_id`,
      [tag],
    );
    await client.query(
      "INSERT INTO location_tags (loc_id, tag_id) VALUES ($1, $2)",
      [locId, t.rows[0].tag_id],
    );
  }
}

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
    long < -180 ||
    long > 180
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
    const locId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO locations
                (loc_name, loc_desc, loc_address, loc_phone, loc_is_power, loc_categories, loc_coordinates_lat, loc_coordinates_long, loc_permissions, loc_imgs,
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
        SELECT l FROM location_tags lt2
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

//PATCH /loc>:id - owner only
router.patch("/:id", requireAuth, async (req, res) => {
  const body = req.body ?? {};

  for (const col of ["loc_name", "loc_address"]) {
    if (body[col] !== undefined && !String(body[col]).trim()) {
      return res.status(400).json({ error: `${col} cannot be empty` });
    }
  }
  if (
    body.loc_is_power !== undefined &&
    typeof body.loc_is_power !== "boolean"
  ) {
    return res
      .status(400)
      .json({ error: "loc_is_power must be true or false" });
  }
  //   coodinates check
  for (const [col, min, max] of COORD_RANGES) {
    if (body[col] !== undefined) {
      const n = body[col] === null ? NaN : Number(body[col]);
      if (!Number.isFinite(n) || n < min || n > max) {
        return res
          .status(400)
          .json({ error: `${col} must be between ${min} and ${max}` });
      }
      body[col] = n;
    }
  }
  //tags check
  const cleanTags =
    body.tags === undefined ? undefined : normalizeTags(body.tags);

  //null tags = invalid tags
  if (cleanTags === null) {
    return res
      .status(400)
      .json({ error: `tags must be an array of up to ${MAX_TAGS} strings` });
  }

  //  sets for avail fields
  const { sets, params } = buildUpdate(body, EDITABLE);
  //guard check
  if (!sets.length && cleanTags === undefined) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  try {
    //auth and guard checks
    const status = await checkOwner(
      "location",
      req.params.id,
      req.user.user_id,
    );
    if (denyIfNotOwner(status, res, "Location")) return;

    await withTransaction(async (client) => {
      //update only if col changed
      if (sets.length) {
        await client.query(
          `UPDATE locations SET ${sets.join(", ")}
                WHERE loc_id = $${params.length + 1} AND created_by = $${params.length + 2}`,
          [...params, req.params.id, req.user.user_id],
        );
      }
      //replace whole set if new tags added
      if (cleanTags !== undefined) {
        await client.query("DELETE FROM location_tags WHERE loc_id = $1", [
          req.params.id,
        ]);
        await saveTags(client, req.params.id, cleanTags);
      }
    });

    //make sure res incl new tags
    const { rows } = await pool.query(
      `${SELECT_LOCATION} WHERE l.loc_id = $1 GROUP BY l.loc_id`,
      [req.params.id],
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /loc/:id - owner only
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    // guard and owner checks
    const status = await checkOwner(
      "location",
      req.params.id,
      req.user.user_id,
    );
    if (denyIfNotOwner(status, res, "Location")) return;
    //make sure all details of location are deleted
    await pool.query(
      "DELETE FROM locations WHERE loc_id = $1 AND created_by = $2",
      [req.params.id, req.user.id],
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
