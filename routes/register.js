const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { generatePassword } = require('../utils/passwordGenerator');
const { sendCredentials } = require('../utils/mailer');

const router = express.Router();

// ---------- photo upload (doctors) ----------
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads'),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + EXT[file.mimetype]),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(new Error('Photo must be JPG, PNG or WEBP')),
});

// ---------- validation helpers ----------
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{7,15}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function fail(res, msg, code = 400) {
  return res.status(code).json({ error: msg });
}

function validateCommon(b) {
  if (!str(b.name)) return 'Name is required';
  if (!EMAIL.test(str(b.email))) return 'Valid email is required';
  return null;
}

function createUser(role, email, password) {
  const hash = bcrypt.hashSync(password, 10);
  return db
    .prepare('INSERT INTO users (role, email, password_hash, must_change_password) VALUES (?, ?, ?, 1)')
    .run(role, email.toLowerCase(), hash).lastInsertRowid;
}

function handleDbError(err, res) {
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    const what = /users\.email/.test(err.message) ? 'Email'
      : /license/.test(err.message) ? 'Medical license'
      : /employee/.test(err.message) ? 'Employee ID' : 'Value';
    return fail(res, `${what} is already registered`, 409);
  }
  console.error(err);
  return fail(res, 'Server error', 500);
}

// Send the generated password, then answer the browser. The password is never returned in the API response.
async function finish(res, { id, password }, role, email, name, okMessage) {
  let note = ' Your password has been sent to your email.';
  try {
    const r = await sendCredentials({ to: email, name, role, password });
    if (r.dev) note = ' (Dev mode: email is not configured, so the password was printed in the server console.)';
  } catch (e) {
    console.error('Email failed:', e.message);
    note = ' However, we could not email your password. Please contact support.';
  }
  return res.status(201).json({ message: okMessage + note, id });
}

// ---------- 1. PATIENT ----------
router.post('/patient', async (req, res) => {
  const b = req.body;
  let err = validateCommon(b);
  if (!err && !PHONE.test(str(b.phone))) err = 'Valid personal phone number is required';
  if (!err && !PHONE.test(str(b.emergencyPhone))) err = 'Valid emergency phone number is required';
  if (!err && !str(b.address)) err = 'Address is required';
  if (!err && !(Number(b.age) >= 0 && Number(b.age) <= 120)) err = 'Age must be between 0 and 120';
  if (!err && !['male', 'female', 'other'].includes(str(b.gender))) err = 'Select a gender';
  if (!err && !(str(b.dob) && new Date(b.dob) < new Date())) err = 'Valid date of birth is required';
  if (err) return fail(res, err);

  try {
    const run = db.transaction(() => {
      const password = generatePassword(str(b.name), str(b.phone));
      const id = createUser('patient', str(b.email), password);
      db.prepare(`INSERT INTO patients
        (user_id, name, phone, emergency_phone, address, age, gender, dob)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        id, str(b.name), str(b.phone), str(b.emergencyPhone),
        str(b.address), Number(b.age), str(b.gender), str(b.dob));
      return { id, password };
    });
    return await finish(res, run(), 'patient', str(b.email), str(b.name), 'Patient registered successfully.');
  } catch (e) { handleDbError(e, res); }
});

// ---------- 2. DOCTOR ----------
router.post('/doctor', upload.single('photo'), async (req, res) => {
  const b = req.body;
  let workplaces = [];
  try { workplaces = JSON.parse(b.workplaces || '[]'); } catch { /* handled below */ }

  let err = validateCommon(b);
  if (!err && !PHONE.test(str(b.phone))) err = 'Valid personal phone number is required';
  if (!err && !PHONE.test(str(b.clinicalPhone))) err = 'Valid clinical phone number is required';
  if (!err && !str(b.address)) err = 'Address is required';
  if (!err && !str(b.license)) err = 'Medical license number is required';
  if (!err && !str(b.degree)) err = 'Degree / qualification is required';
  if (!err && !str(b.speciality)) err = 'Speciality is required';
  if (!err && !(Number(b.experience) >= 0 && Number(b.experience) <= 70)) err = 'Experience (years) is invalid';
  if (!err && !req.file) err = 'Photo is required';
  if (!err && (!Array.isArray(workplaces) || workplaces.length === 0)) err = 'Add at least one workplace';

  if (!err) {
    for (const [i, w] of workplaces.entries()) {
      const n = i + 1;
      if (!str(w.name)) { err = `Workplace ${n}: name is required`; break; }
      if (!str(w.address)) { err = `Workplace ${n}: address is required (use "Find address")`; break; }
      if (!(Number(w.fee) >= 0)) { err = `Workplace ${n}: consultation fee is invalid`; break; }
      if (!Array.isArray(w.days) || !w.days.length || !w.days.every((d) => DAYS.includes(d))) { err = `Workplace ${n}: select available days`; break; }
      if (!TIME.test(w.startTime) || !TIME.test(w.endTime) || w.startTime >= w.endTime) { err = `Workplace ${n}: time range is invalid`; break; }
      if (![10, 15, 20, 30, 45, 60].includes(Number(w.slotMinutes))) { err = `Workplace ${n}: slot length is invalid`; break; }
    }
  }
  if (err) return fail(res, err);

  try {
    const run = db.transaction(() => {
      const password = generatePassword(str(b.name), str(b.phone));
      const id = createUser('doctor', str(b.email), password);
      db.prepare(`INSERT INTO doctors
        (user_id, name, phone, clinical_phone, address, license_no, degree, speciality, experience_years, photo)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        id, str(b.name), str(b.phone), str(b.clinicalPhone), str(b.address),
        str(b.license), str(b.degree), str(b.speciality), Number(b.experience),
        '/uploads/' + req.file.filename);
      const ins = db.prepare(`INSERT INTO workplaces
        (doctor_id, name, address, lat, lon, fee, days, start_time, end_time, slot_minutes)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const w of workplaces) {
        ins.run(id, str(w.name), str(w.address),
          w.lat != null ? Number(w.lat) : null, w.lon != null ? Number(w.lon) : null,
          Number(w.fee), JSON.stringify(w.days), w.startTime, w.endTime, Number(w.slotMinutes));
      }
      return { id, password };
    });
    return await finish(res, run(), 'doctor', str(b.email), str(b.name), 'Doctor registered. Your profile is pending verification.');
  } catch (e) { handleDbError(e, res); }
});

// ---------- 3. HOSPITAL / CLINIC ADMIN ----------
const ADMIN_ROLES = ['Super Admin', 'Receptionist', 'Manager', 'Staff'];
router.post('/admin', async (req, res) => {
  const b = req.body;
  let err = validateCommon(b);
  if (!err && !str(b.employeeId)) err = 'Employee ID is required';
  if (!err && !ADMIN_ROLES.includes(str(b.adminRole))) err = 'Select an admin role';
  if (err) return fail(res, err);

  try {
    const run = db.transaction(() => {
      const password = generatePassword(str(b.name), str(b.employeeId));
      const id = createUser('admin', str(b.email), password);
      db.prepare(`INSERT INTO admins (user_id, name, employee_id, admin_role) VALUES (?,?,?,?)`)
        .run(id, str(b.name), str(b.employeeId), str(b.adminRole));
      return { id, password };
    });
    return await finish(res, run(), 'admin', str(b.email), str(b.name), 'Admin registered. Awaiting approval.');
  } catch (e) { handleDbError(e, res); }
});

module.exports = router;
