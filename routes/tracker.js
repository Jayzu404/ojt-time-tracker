const express = require("express");
const pool = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

// Every route in this file needs a logged-in user.
router.use(requireAuth);

// ===== CONSTANTS (same limits as the frontend) =====
const MAX_HOURS = 100000;
const MAX_TARGET_MINUTES = MAX_HOURS * 60;
const MAX_PREVIOUS_MINUTES = MAX_HOURS * 60 + 59;
const MIN_PACE = 1;
const MAX_PACE = 24;

// Entries leave the database in the same shape the frontend's `data` uses.
const ENTRY_COLUMNS = `
  id,
  DATE_FORMAT(entry_date, '%Y-%m-%d') AS date,
  TIME_FORMAT(time_in, '%H:%i') AS timeIn,
  TIME_FORMAT(time_out, '%H:%i') AS timeOut,
  minutes`;

// ===== HELPERS =====

function isWholeNumberInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isRealDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // "2026-02-31" would roll over into March, so compare the parts back
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTime(text) {
  return typeof text === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

// The newest date we accept: tomorrow in UTC. The server's "today" can be a
// day behind (or ahead of) the user's today, so we allow one day of slack.
function getLatestAllowedDate() {
  const limit = new Date();
  limit.setUTCDate(limit.getUTCDate() + 1);
  return limit.toISOString().slice(0, 10);
}

// Works with the pool or a single connection (both have .execute).
// lock: true adds FOR UPDATE, which holds the row until the transaction ends.
async function getActiveGoal(db, userId, { lock = false } = {}) {
  const [rows] = await db.execute(
    `SELECT id, target_minutes, previous_accumulated_minutes, assumed_hours_per_day
     FROM goals
     WHERE user_id = ? AND status = 'active'
     ORDER BY id DESC
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return rows[0] || null;
}

function formatGoal(goal) {
  return {
    targetMinutes: goal.target_minutes,
    previousAccumulatedMinutes: goal.previous_accumulated_minutes,
    assumedHoursPerDay: goal.assumed_hours_per_day,
  };
}

// ===== GET /api/tracker  (replaces loadState) =====
router.get("/tracker", async (req, res, next) => {
  try {
    const goal = await getActiveGoal(pool, req.userId);
    if (!goal) {
      return res.status(404).json({ error: "No active goal found." });
    }

    const [entries] = await pool.execute(
      `SELECT ${ENTRY_COLUMNS}
       FROM entries
       WHERE goal_id = ?
       ORDER BY entry_date DESC, time_in DESC`,
      [goal.id],
    );

    res.json({ goal: formatGoal(goal), entries });
  } catch (err) {
    next(err);
  }
});

// ===== PATCH /api/goal  (target, previous time, pace) =====
router.patch("/goal", async (req, res, next) => {
  try {
    const body = req.body || {};
    const sets = [];
    const values = [];

    // Column names below are fixed in our code, never taken from the request.
    if (body.targetMinutes !== undefined) {
      if (!isWholeNumberInRange(body.targetMinutes, 1, MAX_TARGET_MINUTES)) {
        return res.status(400).json({
          error: `Target must be a whole number of minutes from 1 to ${MAX_TARGET_MINUTES}.`,
        });
      }
      sets.push("target_minutes = ?");
      values.push(body.targetMinutes);
    }

    if (body.previousAccumulatedMinutes !== undefined) {
      if (
        !isWholeNumberInRange(
          body.previousAccumulatedMinutes,
          0,
          MAX_PREVIOUS_MINUTES,
        )
      ) {
        return res.status(400).json({
          error: `Previous time must be a whole number of minutes from 0 to ${MAX_PREVIOUS_MINUTES}.`,
        });
      }
      sets.push("previous_accumulated_minutes = ?");
      values.push(body.previousAccumulatedMinutes);
    }

    if (body.assumedHoursPerDay !== undefined) {
      if (!isWholeNumberInRange(body.assumedHoursPerDay, MIN_PACE, MAX_PACE)) {
        return res.status(400).json({
          error: `Hours per day must be a whole number from ${MIN_PACE} to ${MAX_PACE}.`,
        });
      }
      sets.push("assumed_hours_per_day = ?");
      values.push(body.assumedHoursPerDay);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    const goal = await getActiveGoal(pool, req.userId);
    if (!goal) {
      return res.status(404).json({ error: "No active goal found." });
    }

    await pool.execute(`UPDATE goals SET ${sets.join(", ")} WHERE id = ?`, [
      ...values,
      goal.id,
    ]);

    const updated = await getActiveGoal(pool, req.userId);
    res.json({ goal: formatGoal(updated) });
  } catch (err) {
    next(err);
  }
});

// ===== POST /api/entries  (log an entry) =====
router.post("/entries", async (req, res, next) => {
  const body = req.body || {};
  const { date, timeIn, timeOut } = body;

  if (!isRealDate(date)) {
    return res.status(400).json({ error: "Pick a valid date." });
  }
  if (date > getLatestAllowedDate()) {
    return res.status(400).json({ error: "You can't log time for a future date." });
  }
  if (!isValidTime(timeIn) || !isValidTime(timeOut)) {
    return res.status(400).json({ error: "Fill in both time in and time out." });
  }
  // "HH:MM" strings with leading zeros compare correctly as plain text
  if (timeOut <= timeIn) {
    return res.status(400).json({ error: "Time out must be later than time in." });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Lock the goal row. A second request for the same user waits here
    // until this transaction finishes, so the overlap check can't be raced.
    const goal = await getActiveGoal(conn, req.userId, { lock: true });
    if (!goal) {
      await conn.rollback();
      return res.status(404).json({ error: "No active goal found." });
    }

    // Same rule as the frontend: new start < old end AND new end > old start.
    // Back-to-back entries (12:00 end, 12:00 start) are allowed.
    const [overlaps] = await conn.execute(
      `SELECT 1 FROM entries
       WHERE goal_id = ? AND entry_date = ?
         AND ? < time_out AND ? > time_in
       LIMIT 1`,
      [goal.id, date, timeIn, timeOut],
    );

    if (overlaps.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        error: "This overlaps an entry you already logged for that date.",
      });
    }

    const [result] = await conn.execute(
      `INSERT INTO entries (goal_id, entry_date, time_in, time_out)
       VALUES (?, ?, ?, ?)`,
      [goal.id, date, timeIn, timeOut],
    );

    const [rows] = await conn.execute(
      `SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`,
      [result.insertId],
    );

    await conn.commit();
    res.status(201).json({ entry: rows[0] });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ===== DELETE /api/entries/:id =====
router.delete("/entries/:id", async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid entry id." });
    }

    // The JOIN checks ownership: the entry must belong to a goal that is
    // this user's AND still active (archived goals are history).
    const [result] = await pool.execute(
      `DELETE e FROM entries e
       JOIN goals g ON g.id = e.goal_id
       WHERE e.id = ? AND g.user_id = ? AND g.status = 'active'`,
      [req.params.id, req.userId],
    );

    // Same answer for "doesn't exist" and "isn't yours".
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Entry not found." });
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ===== POST /api/goal/reset  (archive the old goal, start a new one) =====
router.post("/goal/reset", async (req, res, next) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // The lock makes a double-clicked Reset run one after the other.
    const current = await getActiveGoal(conn, req.userId, { lock: true });

    if (current) {
      await conn.execute(
        "UPDATE goals SET status = 'archived', archived_at = NOW() WHERE id = ?",
        [current.id],
      );
    }

    await conn.execute("INSERT INTO goals (user_id) VALUES (?)", [req.userId]);

    const fresh = await getActiveGoal(conn, req.userId);

    await conn.commit();
    res.json({ goal: formatGoal(fresh), entries: [] });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;