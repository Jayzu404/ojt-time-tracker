
/*
  HOURS TRACKER API SERVER
  Frontend: GitHub Pages
  Backend: Render
  Database: TiDB Cloud
*/

require("dotenv").config();

// ==================================================
// 1. IMPORTS
// ==================================================

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const path = require("node:path");
const { rateLimit } = require("express-rate-limit");

// Routes and authentication middleware
const trackerRoutes = require("./routes/tracker");
const authRoutes = require("./routes/auth");
const requireAuth = require("./middleware/auth");

// ==================================================
// 2. INITIALIZE EXPRESS
// ==================================================

const app = express();

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

app.disable("x-powered-by");

// Render runs behind a reverse proxy.
// Trust one proxy hop to obtain the correct client IP.
app.set("trust proxy", 1);

// ==================================================
// 3. CONFIGURE ALLOWED FRONTEND ORIGINS
// ==================================================

const configuredOrigins = [
  process.env.FRONTEND_ORIGIN || "",
  ...(process.env.FRONTEND_ORIGINS || "").split(","),
];

const developmentOrigins = IS_PRODUCTION
  ? []
  : [
      "http://localhost:5500",
      "http://127.0.0.1:5500",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ];

const allowedOrigins = new Set(
  [...configuredOrigins, ...developmentOrigins]
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
);

// Prevent production deployment without a configured frontend.
if (IS_PRODUCTION && allowedOrigins.size === 0) {
  throw new Error(
    "Missing FRONTEND_ORIGIN or FRONTEND_ORIGINS environment variable."
  );
}

// ==================================================
// 4. SECURITY HEADERS
// ==================================================

app.use(helmet());

// ==================================================
// 5. CORS CONFIGURATION
// ==================================================

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests without an Origin header.
    // State-changing API requests are checked separately below.
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin not allowed by CORS."));
  },

  credentials: true,

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-CSRF-Token",
  ],

  maxAge: 86400,
};

app.use(cors(corsOptions));

// ==================================================
// 6. CSRF ORIGIN PROTECTION
// ==================================================

const SAFE_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
]);

app.use("/api", (req, res, next) => {
  // Read-only requests do not need this Origin check.
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const origin = req.get("Origin");

  // Require an approved browser origin for all
  // state-changing API requests.
  if (!origin || !allowedOrigins.has(origin)) {
    return res.status(403).json({
      error: "Request origin is not allowed.",
    });
  }

  next();
});

// ==================================================
// 7. BODY AND COOKIE PARSING
// ==================================================

app.use(express.json({
  limit: "50kb",
}));

app.use(cookieParser());

// ==================================================
// 8. STATIC FILES
// ==================================================

// GitHub Pages hosts your production frontend.
// This is retained for local testing or optional
// static-file serving from the Express application.
app.use(express.static(path.join(__dirname, "public")));

// ==================================================
// 9. RATE LIMITING
// ==================================================

// General API limit:
// Maximum 300 requests per IP every 15 minutes.

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,

  standardHeaders: "draft-8",
  legacyHeaders: false,

  message: {
    error: "Too many requests. Please try again later.",
  },
});

// Authentication limit:
// Count unsuccessful requests only.

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,

  standardHeaders: "draft-8",
  legacyHeaders: false,

  skipSuccessfulRequests: true,

  message: {
    error: "Too many failed authentication attempts. Please try again later.",
  },
});

// Apply general limit to all API endpoints.
app.use("/api", apiLimiter);

// Apply stricter limit to authentication endpoints.
app.use("/api/auth", authLimiter);

// ==================================================
// 10. HEALTH CHECK
// ==================================================

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Hours Tracker API is running.",
  });
});

// ==================================================
// 11. AUTHENTICATION ROUTES
// ==================================================

app.use("/api/auth", authRoutes);

// ==================================================
// 12. AUTHENTICATED USER ROUTE
// ==================================================

app.get("/api/me", requireAuth, (req, res) => {
  res.status(200).json({
    userId: req.userId,
  });
});

// ==================================================
// 13. TRACKER ROUTES
// ==================================================

app.use("/api", trackerRoutes);

// ==================================================
// 14. NOT FOUND HANDLER
// ==================================================

app.use((req, res) => {
  res.status(404).json({
    error: "The requested endpoint does not exist.",
  });
});

// ==================================================
// 15. GLOBAL ERROR HANDLER
// ==================================================

app.use((err, req, res, next) => {
  // Delegate if the response has already started.
  if (res.headersSent) {
    return next(err);
  }

  // Invalid JSON request body.
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "Invalid JSON request body.",
    });
  }

  // Request body exceeds the configured limit.
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request body is too large.",
    });
  }

  // Reject requests from unapproved origins.
  if (err.message === "Origin not allowed by CORS.") {
    return res.status(403).json({
      error: "Access from this origin is not allowed.",
    });
  }

  // Log internal errors without exposing them to clients.
  console.error("Server error:", err);

  return res.status(500).json({
    error: "Something went wrong. Please try again later.",
  });
});

// ==================================================
// 16. START SERVER
// ==================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hours Tracker API running on port ${PORT}`);
});