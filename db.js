const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('patient','doctor','admin')),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patients (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  emergency_phone TEXT NOT NULL,
  address TEXT NOT NULL,
  age INTEGER NOT NULL,
  gender TEXT NOT NULL,
  dob TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctors (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  clinical_phone TEXT NOT NULL,
  address TEXT NOT NULL,
  license_no TEXT NOT NULL UNIQUE,
  degree TEXT NOT NULL,
  speciality TEXT NOT NULL,
  experience_years INTEGER NOT NULL,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'pending'   -- pending | approved | rejected
);

CREATE TABLE IF NOT EXISTS workplaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(user_id),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL,
  lon REAL,
  fee REAL NOT NULL,
  days TEXT NOT NULL,            -- JSON array e.g. ["Mon","Wed"]
  start_time TEXT NOT NULL,      -- HH:MM
  end_time TEXT NOT NULL,        -- HH:MM
  slot_minutes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  name TEXT NOT NULL,
  employee_id TEXT NOT NULL UNIQUE,
  admin_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);
`);

// Migration: flag accounts that must change their generated password on first login
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('must_change_password')) {
  db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
}

module.exports = db;
