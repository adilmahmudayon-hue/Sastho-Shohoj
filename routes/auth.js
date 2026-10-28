const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { issue, clear, requireAuth } = require('../utils/auth');
const { sendPasswordReset } = require('../utils/mailer');

const router = express.Router();
const ROLES = ['patient', 'doctor', 'admin'];
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// ---- tiny in-memory rate limiter: 5 tries per 15 minutes per key ----
const attempts = new Map();
const MAX = 5, WINDOW = 15 * 60 * 1000;
function isLimited(key) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < WINDOW);
  attempts.set(key, recent);
  return recent.length >= MAX;
}
function record(key) {
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
}

const clean = (v) => String(v || '').trim();

function profileOf(user) {
  const q = {
    patient: 'SELECT name FROM patients WHERE user_id = ?',
    doctor: 'SELECT name, status FROM doctors WHERE user_id = ?',
    admin: 'SELECT name, admin_role AS adminRole, status FROM admins WHERE user_id = ?',
  }[user.role];
  return db.prepare(q).get(user.id) || {};
}

// ---------- LOGIN ----------
router.post('/login', (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  const role = clean(req.body.role);
  if (!email || !password || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Email, password and account type are required' });
  }

  const key = `login|${email}|${req.ip}`;
  if (isLimited(key)) return res.status(429).json({ error: 'Too many failed attempts. Please try again in 15 minutes.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordOk || user.role !== role) {
    record(key);
    return res.status(401).json({ error: 'Incorrect email, password or account type' });
  }

  attempts.delete(key);
  issue(res, user);
  res.json({ role: user.role, mustChangePassword: !!user.must_change_password });
});

// ---------- WHO AM I ----------
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, role, email, must_change_password FROM users WHERE id = ?').get(req.auth.id);
  if (!user) { clear(res); return res.status(401).json({ error: 'Please log in' }); }
  res.json({
    id: user.id, role: user.role, email: user.email,
    mustChangePassword: !!user.must_change_password,
    ...profileOf(user),
  });
});

// ---------- LOGOUT ----------
router.post('/logout', (req, res) => { clear(res); res.json({ message: 'Logged out' }); });

// ---------- CHANGE PASSWORD ----------
router.post('/change-password', requireAuth, (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.id);

  if (!user || !bcrypt.compareSync(current, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
    return res.status(400).json({ error: 'New password must be at least 8 characters and include a letter and a number' });
  }
  if (next === current) return res.status(400).json({ error: 'New password must be different from the current one' });

  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(bcrypt.hashSync(next, 10), user.id);
  res.json({ message: 'Password changed successfully' });
});

// ---------- FORGOT PASSWORD ----------
router.post('/forgot-password', async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const generic = { message: 'If that email is registered, a new temporary password has been sent to it.' };
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const key = `forgot|${email}|${req.ip}`;
  if (isLimited(key)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  record(key);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    const temp = crypto.randomBytes(9).toString('base64url');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
      .run(bcrypt.hashSync(temp, 10), user.id);
    try {
      await sendPasswordReset({ to: user.email, name: profileOf(user).name || 'there', password: temp });
    } catch (e) { console.error('Reset email failed:', e.message); }
  }
  res.json(generic);
});

module.exports = router;