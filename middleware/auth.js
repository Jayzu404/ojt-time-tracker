
const pool = require("../db");

// ==================================================
// CONSTANTS
// ==================================================

const COOKIE_NAME = "sid";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const SAME_SITE = (
  process.env.COOKIE_SAME_SITE ||
  (IS_PRODUCTION ? "none" : "lax")
).toLowerCase();

if (!["strict", "lax", "none"].includes(SAME_SITE)) {
  throw new Error("Invalid COOKIE_SAME_SITE configuration.");
}

// These options must match routes/auth.js.
// In particular, the cookie path must be the same.
const clearCookieOptions = {
  httpOnly: true,
  secure: IS_PRODUCTION || SAME_SITE === "none",
  sameSite: SAME_SITE,
  path: "/",
};

// Your createSession() function generates 32 random bytes
// converted into 64 hexadecimal characters.
const SESSION_ID_PATTERN = /^[a-f0-9]{64}$/;

// ==================================================
// AUTHENTICATION MIDDLEWARE
// ==================================================

async function requireAuth(req, res, next) {
  try {
    // 1. Retrieve the session cookie.
    const sessionId = req.cookies?.[COOKIE_NAME];

    // 2. Check whether the cookie exists.
    if (!sessionId) {
      return res.status(401).json({
        error: "Not logged in.",
      });
    }

    // 3. Validate the session ID format.
    if (
      typeof sessionId !== "string" ||
      !SESSION_ID_PATTERN.test(sessionId)
    ) {
      res.clearCookie(COOKIE_NAME, clearCookieOptions);

      return res.status(401).json({
        error: "Invalid session. Please log in again.",
      });
    }

    // 4. Check whether the session exists and is still valid.
    // Also verify that its associated user still exists.
    const [rows] = await pool.execute(
      `SELECT s.user_id
       FROM sessions AS s
       INNER JOIN users AS u ON u.id = s.user_id
       WHERE s.id = ?
         AND s.expires_at > NOW()
       LIMIT 1`,
      [sessionId]
    );

    // 5. Reject missing, expired, or orphaned sessions.
    if (rows.length === 0) {
      // Clean up the invalid session if it exists.
      try {
        await pool.execute(
          "DELETE FROM sessions WHERE id = ?",
          [sessionId]
        );
      } catch (cleanupError) {
        console.error("Session cleanup failed:", cleanupError);
      }

      res.clearCookie(COOKIE_NAME, clearCookieOptions);

      return res.status(401).json({
        error: "Session expired or invalid. Please log in again.",
      });
    }

    // 6. Get the authenticated user ID from the database.
    // Never trust a user ID supplied by the frontend.
    req.userId = rows[0].user_id;

    // 7. Continue to the protected route.
    return next();

  } catch (err) {
    // Pass unexpected errors to the global error handler.
    return next(err);
  }
}

module.exports = requireAuth;
