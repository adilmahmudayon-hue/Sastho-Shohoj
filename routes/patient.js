const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../utils/auth');

const router = express.Router();

// Only logged-in patients who have already replaced their temporary password
router.use(requireAuth, requireRole('patient'));
router.use((req, res, next) => {
  const u = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(req.auth.id);
  if (!u) return res.status(401).json({ error: 'Please log in' });
  if (u.must_change_password) return res.status(403).json({ error: 'Please change your temporary password first' });
  next();
});

// ---------- helpers ----------
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE = /^\+?[0-9]{7,15}$/;
const HOURS_24 = 24 * 60 * 60 * 1000;
const pid = (req) => req.auth.id;
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayStr = () => dateStr(new Date());
function plusDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return dateStr(d); }
function weekday(s) {
  const [y, m, d] = s.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function whenMs(date, time) { return new Date(`${date}T${time || '00:00'}`).getTime(); }

function slotsFor(w) {
  const [sh, sm] = w.start_time.split(':').map(Number);
  const [eh, em] = w.end_time.split(':').map(Number);
  const out = [];
  for (let t = sh * 60 + sm; t + w.slot_minutes <= eh * 60 + em; t += w.slot_minutes) {
    out.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
  }
  return out;
}

function notify(userId, title, message) {
  db.prepare('INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)').run(userId, title, message);
}
function notifyAdmins(title, message) {
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin'").all()) notify(a.id, title, message);
}

// Checks doctor, workplace, date and time slot. Returns { error } or { w }.
function validateSlot(doctorId, workplaceId, date, time) {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return { error: 'Choose a valid date and time slot' };
  const w = db.prepare(`SELECT w.* FROM workplaces w JOIN doctors d ON d.user_id = w.doctor_id
                        WHERE w.id = ? AND w.doctor_id = ? AND d.status = 'approved'`).get(workplaceId, doctorId);
  if (!w) return { error: 'Doctor or workplace not found' };
  if (date < todayStr()) return { error: 'The date cannot be in the past' };
  if (date > plusDays(60)) return { error: 'Please choose a date within the next 60 days' };
  if (!JSON.parse(w.days).includes(weekday(date))) return { error: `The doctor does not sit on ${weekday(date)}s at this place` };
  if (!slotsFor(w).includes(time)) return { error: 'That time slot does not exist' };
  const taken = db.prepare(`SELECT 1 FROM appointments WHERE workplace_id = ? AND scheduled_date = ?
                            AND scheduled_time = ? AND status = 'confirmed'`).get(w.id, date, time);
  if (taken) return { error: 'That slot is already booked. Please pick another one' };
  return { w };
}

function findDoctors(patientId, f = {}) {
  const q = text(f.q).toLowerCase();
  const spec = text(f.speciality).toLowerCase();
  const hosp = text(f.hospital).toLowerCase();
  const fee = f.maxFee === undefined || f.maxFee === '' ? NaN : Number(f.maxFee);
  const day = DAYS.includes(f.day) ? f.day : null;

  const docs = db.prepare(`SELECT user_id AS id, name, speciality, degree, experience_years AS experience, photo
                           FROM doctors WHERE status = 'approved' ORDER BY name`).all();
  const wps = db.prepare('SELECT * FROM workplaces').all().map((w) => ({
    id: w.id, doctorId: w.doctor_id, name: w.name, address: w.address, fee: w.fee,
    days: JSON.parse(w.days), startTime: w.start_time, endTime: w.end_time, slotMinutes: w.slot_minutes,
  }));
  const favs = new Set(db.prepare('SELECT doctor_id FROM favorites WHERE patient_id = ?').all(patientId).map((r) => r.doctor_id));

  const out = [];
  for (const d of docs) {
    if (f.favOnly && !favs.has(d.id)) continue;
    if (q && !(d.name.toLowerCase().includes(q) || d.speciality.toLowerCase().includes(q))) continue;
    if (spec && !d.speciality.toLowerCase().includes(spec)) continue;
    const mine = wps.filter((w) => w.doctorId === d.id
      && (!hosp || `${w.name} ${w.address}`.toLowerCase().includes(hosp))
      && (Number.isNaN(fee) || w.fee <= fee)
      && (!day || w.days.includes(day)));
    if (mine.length) out.push({ ...d, isFavorite: favs.has(d.id), workplaces: mine });
  }
  return out;
}

const APPT_SQL = `SELECT a.*, d.name AS doctor_name, d.speciality, d.photo, w.name AS workplace_name,
                         w.address AS workplace_address, w.fee
                  FROM appointments a
                  JOIN doctors d ON d.user_id = a.doctor_id
                  JOIN workplaces w ON w.id = a.workplace_id`;

function shapeAppt(a) {
  const date = a.scheduled_date || a.preferred_date;
  const time = a.scheduled_time || a.preferred_time;
  const ms = whenMs(date, time);
  const open = a.status === 'requested' || a.status === 'confirmed';
  const farEnough = ms - Date.now() >= HOURS_24;
  return {
    id: a.id, status: a.status, type: a.consultation_type, reason: a.reason,
    doctorId: a.doctor_id, doctorName: a.doctor_name, speciality: a.speciality, photo: a.photo,
    workplaceId: a.workplace_id, workplaceName: a.workplace_name, workplaceAddress: a.workplace_address, fee: a.fee,
    date, time, preferredDate: a.preferred_date, preferredTime: a.preferred_time,
    adminNote: a.admin_note, previousSchedule: a.previous_schedule, cancelledBy: a.cancelled_by,
    doctorNotes: a.doctor_notes, prescription: a.prescription,
    canCancel: open && (a.status === 'requested' || farEnough),
    canReschedule: a.status === 'confirmed' && farEnough,
    isUpcoming: a.status === 'requested' || (a.status === 'confirmed' && ms >= Date.now()),
  };
}

function ageFrom(dob) {
  const b = new Date(dob), n = new Date();
  let age = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) age--;
  return Math.max(age, 0);
}

// ---------- 1. DASHBOARD ----------
router.get('/dashboard', (req, res) => {
  const id = pid(req);
  const upcoming = db.prepare(`${APPT_SQL} WHERE a.patient_id = ? AND a.status = 'confirmed' AND a.scheduled_date >= ?
                               ORDER BY a.scheduled_date, a.scheduled_time LIMIT 3`).all(id, todayStr()).map(shapeAppt);
  const count = (sql) => db.prepare(sql).get(id).n;
  res.json({
    upcoming,
    pendingCount: count("SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ? AND status = 'requested'"),
    completedCount: count("SELECT COUNT(*) AS n FROM appointments WHERE patient_id = ? AND status = 'completed'"),
    unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(id).n,
    recent: db.prepare('SELECT id, title, message, is_read AS isRead, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(id),
    favorites: findDoctors(id, { favOnly: true }).slice(0, 4),
  });
});

// ---------- 2. FIND DOCTORS (+ slots) ----------
router.get('/doctors', (req, res) => res.json(findDoctors(pid(req), req.query)));

router.get('/doctors/:id/slots', (req, res) => {
  const doctorId = Number(req.params.id), workplaceId = Number(req.query.workplaceId), date = text(req.query.date, 10);
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Choose a valid date' });
  const w = db.prepare(`SELECT w.* FROM workplaces w JOIN doctors d ON d.user_id = w.doctor_id
                        WHERE w.id = ? AND w.doctor_id = ? AND d.status = 'approved'`).get(workplaceId, doctorId);
  if (!w) return res.status(404).json({ error: 'Doctor or workplace not found' });
  const days = JSON.parse(w.days);
  if (!days.includes(weekday(date))) return res.json({ available: false, days, slots: [] });
  const taken = new Set(db.prepare(`SELECT scheduled_time FROM appointments WHERE workplace_id = ? AND scheduled_date = ?
                                    AND status = 'confirmed'`).all(w.id, date).map((r) => r.scheduled_time));
  res.json({ available: true, days, slots: slotsFor(w).map((t) => ({ time: t, taken: taken.has(t) })) });
});

// Request an appointment (the admin will fix the final schedule)
router.post('/appointments', (req, res) => {
  const b = req.body;
  const doctorId = Number(b.doctorId), workplaceId = Number(b.workplaceId);
  const type = ['In-person', 'Online'].includes(b.type) ? b.type : null;
  const date = text(b.date, 10), time = text(b.time, 5), reason = text(b.reason, 1000);
  if (!type) return res.status(400).json({ error: 'Choose a consultation type' });

  const { error, w } = validateSlot(doctorId, workplaceId, date, time);
  if (error) return res.status(400).json({ error });

  const dup = db.prepare(`SELECT 1 FROM appointments WHERE patient_id = ? AND doctor_id = ? AND preferred_date = ?
                          AND status IN ('requested','confirmed')`).get(pid(req), doctorId, date);
  if (dup) return res.status(409).json({ error: 'You already have a request with this doctor on that date' });

  const info = db.prepare(`INSERT INTO appointments (patient_id, doctor_id, workplace_id, consultation_type, reason, preferred_date, preferred_time)
                           VALUES (?,?,?,?,?,?,?)`).run(pid(req), doctorId, w.id, type, reason, date, time);
  const who = db.prepare('SELECT name FROM patients WHERE user_id = ?').get(pid(req)).name;
  const doc = db.prepare('SELECT name FROM doctors WHERE user_id = ?').get(doctorId).name;
  notify(pid(req), 'Request sent', `Your request for ${doc} on ${date} at ${time} was sent. The admin will confirm the final schedule.`);
  notifyAdmins('New appointment request', `${who} requested ${doc} on ${date} at ${time} (${type}) at ${w.name}.`);
  res.status(201).json({ message: 'Request sent! The admin will confirm your schedule soon.', id: info.lastInsertRowid });
});

// ---------- 4. MY APPOINTMENTS ----------
router.get('/appointments', (req, res) => {
  const rows = db.prepare(`${APPT_SQL} WHERE a.patient_id = ?
    ORDER BY COALESCE(a.scheduled_date, a.preferred_date) DESC, COALESCE(a.scheduled_time, a.preferred_time) DESC`)
    .all(pid(req)).map(shapeAppt);
  res.json({ upcoming: rows.filter((a) => a.isUpcoming).reverse(), past: rows.filter((a) => !a.isUpcoming) });
});

function ownAppointment(req) {
  return db.prepare('SELECT * FROM appointments WHERE id = ? AND patient_id = ?').get(Number(req.params.id), pid(req));
}

router.post('/appointments/:id/cancel', (req, res) => {
  const a = ownAppointment(req);
  if (!a) return res.status(404).json({ error: 'Appointment not found' });
  if (a.status !== 'requested' && a.status !== 'confirmed') return res.status(400).json({ error: 'This appointment can no longer be cancelled' });
  if (a.status === 'confirmed' && whenMs(a.scheduled_date, a.scheduled_time) - Date.now() < HOURS_24) {
    return res.status(400).json({ error: 'Confirmed appointments can only be cancelled at least 24 hours before. Please contact the clinic.' });
  }
  db.prepare("UPDATE appointments SET status = 'cancelled', cancelled_by = 'patient' WHERE id = ?").run(a.id);
  const doc = db.prepare('SELECT name FROM doctors WHERE user_id = ?').get(a.doctor_id).name;
  notify(pid(req), 'Appointment cancelled', `Your appointment with ${doc} was cancelled.`);
  notifyAdmins('Appointment cancelled by patient', `Request #${a.id} with ${doc} was cancelled by the patient.`);
  res.json({ message: 'Appointment cancelled' });
});

router.post('/appointments/:id/reschedule', (req, res) => {
  const a = ownAppointment(req);
  if (!a) return res.status(404).json({ error: 'Appointment not found' });
  if (a.status !== 'confirmed' || whenMs(a.scheduled_date, a.scheduled_time) - Date.now() < HOURS_24) {
    return res.status(400).json({ error: 'Only confirmed appointments more than 24 hours away can be rescheduled' });
  }
  const date = text(req.body.date, 10), time = text(req.body.time, 5);
  const { error } = validateSlot(a.doctor_id, a.workplace_id, date, time);
  if (error) return res.status(400).json({ error });

  db.prepare(`UPDATE appointments SET status = 'requested', previous_schedule = ?, preferred_date = ?, preferred_time = ?,
              scheduled_date = NULL, scheduled_time = NULL WHERE id = ?`)
    .run(`${a.scheduled_date} ${a.scheduled_time}`, date, time, a.id);
  const doc = db.prepare('SELECT name FROM doctors WHERE user_id = ?').get(a.doctor_id).name;
  notify(pid(req), 'Reschedule requested', `You asked to move your appointment with ${doc} to ${date} at ${time}. The admin will confirm.`);
  notifyAdmins('Reschedule request', `Patient asked to move request #${a.id} (${doc}) from ${a.scheduled_date} ${a.scheduled_time} to ${date} ${time}.`);
  res.json({ message: 'Reschedule request sent. The admin will confirm the new time.' });
});

// ---------- 5. FAVORITES ----------
router.get('/favorites', (req, res) => res.json(findDoctors(pid(req), { favOnly: true })));

router.post('/favorites/:id', (req, res) => {
  const ok = db.prepare("SELECT 1 FROM doctors WHERE user_id = ? AND status = 'approved'").get(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Doctor not found' });
  db.prepare('INSERT OR IGNORE INTO favorites (patient_id, doctor_id) VALUES (?, ?)').run(pid(req), Number(req.params.id));
  res.json({ message: 'Saved to favorites' });
});

router.delete('/favorites/:id', (req, res) => {
  db.prepare('DELETE FROM favorites WHERE patient_id = ? AND doctor_id = ?').run(pid(req), Number(req.params.id));
  res.json({ message: 'Removed from favorites' });
});

// ---------- 6. NOTIFICATIONS ----------
router.get('/notifications/count', (req, res) => {
  res.json({ unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(pid(req)).n });
});

router.get('/notifications', (req, res) => {
  res.json(db.prepare(`SELECT id, title, message, is_read AS isRead, created_at AS createdAt
                       FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(pid(req)));
});

router.post('/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(pid(req));
  res.json({ message: 'All marked as read' });
});

router.post('/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), pid(req));
  res.json({ message: 'Marked as read' });
});

// ---------- 7. PROFILE ----------
router.get('/profile', (req, res) => {
  res.json(db.prepare(`SELECT p.name, u.email, p.phone, p.emergency_phone AS emergencyPhone, p.address,
                              p.age, p.gender, p.dob FROM patients p JOIN users u ON u.id = p.user_id
                       WHERE p.user_id = ?`).get(pid(req)));
});

router.put('/profile', (req, res) => {
  const b = req.body;
  const name = text(b.name), phone = text(b.phone, 20), emergency = text(b.emergencyPhone, 20);
  const address = text(b.address, 300), gender = text(b.gender, 10), dob = text(b.dob, 10);
  let err = null;
  if (!name) err = 'Name is required';
  else if (!PHONE.test(phone)) err = 'Enter a valid personal phone number';
  else if (!PHONE.test(emergency)) err = 'Enter a valid emergency phone number';
  else if (!address) err = 'Address is required';
  else if (!['male', 'female', 'other'].includes(gender)) err = 'Select a gender';
  else if (!DATE_RE.test(dob) || dob >= todayStr()) err = 'Enter a valid date of birth';
  if (err) return res.status(400).json({ error: err });

  db.prepare(`UPDATE patients SET name = ?, phone = ?, emergency_phone = ?, address = ?, gender = ?, dob = ?, age = ?
              WHERE user_id = ?`).run(name, phone, emergency, address, gender, dob, ageFrom(dob), pid(req));
  res.json({ message: 'Profile updated' });
});

module.exports = router;