
require("dotenv").config();

const mysql = require("mysql2/promise");

// ==========================================
// 1. VALIDATE ENVIRONMENT VARIABLES
// ==========================================

const requiredVariables = [
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
];

const missingVariables = requiredVariables.filter(
  (variable) => !process.env[variable]
);

if (missingVariables.length > 0) {
  throw new Error(
    `Missing database environment variables: ${missingVariables.join(", ")}`
  );
}

const DB_PORT = Number(process.env.DB_PORT || 4000);

if (!Number.isInteger(DB_PORT) || DB_PORT < 1 || DB_PORT > 65535) {
  throw new Error("Invalid DB_PORT configuration.");
}

// ==========================================
// 2. CREATE DATABASE CONNECTION POOL
// ==========================================

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  // TiDB Cloud Starter requires TLS.
  ssl: {
    minVersion: "TLSv1.2",
  },

  // Connection pool configuration.
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

// ==========================================
// 3. EXPORT CONNECTION POOL
// ==========================================

module.exports = pool;
