const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db");

const router = express.Router();

// ==================================================
// CONSTANTS
// ==================================================

const COOKIE_NAME = "sid";
const SESSION_DAYS = 7;
const BCRYPT_ROUNDS = 10;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;

const MAX_EMAIL_LENGTH = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// GitHub Pages + Render require cross-site cookies.
// SameSite=None requires Secure.
const SAME_SITE = (
  process.env.COOKIE_SAME_SITE ||
  (IS_PRODUCTION ? "none" : "lax")
).toLowerCase();

if (!["strict", "lax", "none"].includes(SAME_SITE)) {
  throw new Error("Invalid COOKIE_SAME_SITE configuration.");
}

const cookieOptions = {
  httpOnly: true,
  secure: IS_PRODUCTION || SAME_SITE === "none",
  sameSite: SAME_SITE,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
};

const clearCookieOptions = {
  httpOnly: cookieOptions.httpOnly,
  secure: cookieOptions.secure,
  sameSite: cookieOptions.sameSite,
  path: cookieOptions.path,
};

// Dummy hash prevents a simple timing difference when
// an email does not exist in the database.
const DUMMY_HASH = bcrypt.hashSync(
  "not-a-real-password",
  BCRYPT_ROUNDS
);

// ==================================================
// HELPER FUNCTIONS
// ==================================================

function cleanEmail(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}

function isValidEmail(email) {
  return (
    email.length > 0 &&
    email.length <= MAX_EMAIL_LENGTH &&
    EMAIL_PATTERN.test(email)
  );
}

function isValidRegistrationPassword(password) {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES
  );
}

// Creates a cryptographically secure session ID.
async function createSession(db, userId) {
  const sessionId = crypto.randomBytes(32).toString("hex");

  await db.execute(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ${SESSION_DAYS} DAY))`,
    [sessionId, userId]
  );

  return sessionId;
}

// ==================================================
// REGISTER
// ==================================================

router.post("/register", async (req, res, next) => {
  const body = req.body || {};

  const email = cleanEmail(body.email);

  const password =
    typeof body.password === "string"
      ? body.password
      : "";

  // Validate email.
  if (!isValidEmail(email)) {
    return res.status(400).json({
      error: "Enter a valid email address.",
    });
  }

  // Validate password.
  if (!isValidRegistrationPassword(password)) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters and at most ${MAX_PASSWORD_BYTES} bytes.`,
    });
  }

  let conn;
  let transactionStarted = false;

  try {
    // Hash password before acquiring a database connection.
    const passwordHash = await bcrypt.hash(
      password,
      BCRYPT_ROUNDS
    );

    conn = await pool.getConnection();

    // Begin database transaction.
    await conn.beginTransaction();
    transactionStarted = true;

    // Create user.
    const [userResult] = await conn.execute(
      `INSERT INTO users (email, password_hash)
       VALUES (?, ?)`,
      [email, passwordHash]
    );

    const userId = userResult.insertId;

    // Create the user's initial goal.
    await conn.execute(
      `INSERT INTO goals (user_id)
       VALUES (?)`,
      [userId]
    );

    // Create initial login session.
    const sessionId = await createSession(
      conn,
      userId
    );

    // Commit all database operations.
    await conn.commit();
    transactionStarted = false;

    // Set session cookie only after successful commit.
    res.cookie(COOKIE_NAME, sessionId, cookieOptions);

    return res.status(201).json({
      user: {
        id: userId,
        email,
      },
    });

  } catch (err) {
    // Roll back if a transaction was started.
    if (conn && transactionStarted) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        console.error("Registration rollback failed:", rollbackError);
      }
    }

    // Handle duplicate email.
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "That email is already registered.",
      });
    }

    return next(err);

  } finally {
    if (conn) {
      conn.release();
    }
  }
});

// ==================================================
// LOGIN
// ==================================================

router.post("/login", async (req, res, next) => {
  try {
    const body = req.body || {};

    const email = cleanEmail(body.email);

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    // Validate input.
    if (
      !isValidEmail(email) ||
      !password ||
      Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES
    ) {
      return res.status(400).json({
        error: "Enter a valid email and password.",
      });
    }

    // Find user.
    const [rows] = await pool.execute(
      `SELECT id, email, password_hash
       FROM users
       WHERE email = ?`,
      [email]
    );

    const user = rows[0];

    // Compare password even when the user does not exist.
    const matches = await bcrypt.compare(
      password,
      user ? user.password_hash : DUMMY_HASH
    );

    // Do not reveal whether the email exists.
    if (!user || !matches) {
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

    // Create a new session.
    const sessionId = await createSession(
      pool,
      user.id
    );

    // Set new session cookie.
    res.cookie(COOKIE_NAME, sessionId, cookieOptions);

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
      },
    });

  } catch (err) {
    return next(err);
  }
});

// ==================================================
// LOGOUT
// ==================================================

router.post("/logout", async (req, res, next) => {
  try {
    const sessionId = req.cookies?.[COOKIE_NAME];

    // Delete the session from the database.
    if (sessionId) {
      await pool.execute(
        `DELETE FROM sessions
         WHERE id = ?`,
        [sessionId]
      );
    }

    // Remove the browser cookie.
    res.clearCookie(
      COOKIE_NAME,
      clearCookieOptions
    );

    return res.status(204).end();

  } catch (err) {
    return next(err);
  }
});

module.exports = router;
