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
// ---------- Appointments, favorites, notifications ----------
db.exec(`
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(user_id),
  doctor_id INTEGER NOT NULL REFERENCES doctors(user_id),
  workplace_id INTEGER NOT NULL REFERENCES workplaces(id),
  consultation_type TEXT NOT NULL DEFAULT 'In-person',
  reason TEXT,
  preferred_date TEXT NOT NULL,
  preferred_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','confirmed','completed','cancelled','rejected')),
  scheduled_date TEXT,          -- fixed by the admin
  scheduled_time TEXT,          -- fixed by the admin
  admin_note TEXT,
  previous_schedule TEXT,
  cancelled_by TEXT,
  doctor_notes TEXT,            -- written by the doctor after the visit
  prescription TEXT,            -- written by the doctor after the visit
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_doctor ON appointments(doctor_id, scheduled_date);

CREATE TABLE IF NOT EXISTS favorites (
  patient_id INTEGER NOT NULL REFERENCES patients(user_id),
  doctor_id INTEGER NOT NULL REFERENCES doctors(user_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (patient_id, doctor_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
`);
