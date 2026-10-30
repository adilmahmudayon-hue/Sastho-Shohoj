const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../utils/auth');
const { DAYS, DATE_RE, TIME_RE, PHONE, todayStr, plusDays, text } = require('../utils/schedule');
const { notify } = require('../utils/notify');

const router = express.Router();

// Only logged-in doctors who have already replaced their temporary password
router.use(requireAuth, requireRole('doctor'));
router.use((req, res, next) => {
  const u = db.prepare('SELECT must_change_password AS must FROM users WHERE id = ?').get(req.auth.id);
  if (!u) return res.status(401).json({ error: 'Please log in' });
  if (u.must) return res.status(403).json({ error: 'Please change your temporary password first' });
  next();
});
const did = (req) => req.auth.id;

// ---------- helpers ----------
const APPT_SQL = `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone, p.emergency_phone AS patient_emergency,
                         p.age AS patient_age, p.gender AS patient_gender, w.name AS workplace_name, w.address AS workplace_address
                  FROM appointments a
                  JOIN patients p ON p.user_id = a.patient_id
                  JOIN workplaces w ON w.id = a.workplace_id`;

const shape = (a) => ({
  id: a.id, status: a.status, type: a.consultation_type, reason: a.reason,
  patientId: a.patient_id, patientName: a.patient_name, patientPhone: a.patient_phone, patientEmergency: a.patient_emergency,
  patientAge: a.patient_age, patientGender: a.patient_gender,
  workplaceName: a.workplace_name, workplaceAddress: a.workplace_address,
  date: a.scheduled_date, time: a.scheduled_time, adminNote: a.admin_note,
  doctorNotes: a.doctor_notes, prescription: a.prescription,
  canComplete: a.status === 'confirmed' && a.scheduled_date <= todayStr(),
});

const doctorStatus = (id) => db.prepare('SELECT status FROM doctors WHERE user_id = ?').get(id).status;

// ---------- DASHBOARD ----------
router.get('/dashboard', (req, res) => {
  const id = did(req), today = todayStr();
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  res.json({
    status: doctorStatus(id),
    today: db.prepare(`${APPT_SQL} WHERE a.doctor_id = ? AND a.scheduled_date = ? AND a.status IN ('confirmed','completed')
                       ORDER BY a.scheduled_time`).all(id, today).map(shape),
    upcoming: n("SELECT COUNT(*) AS n FROM appointments WHERE doctor_id = ? AND status = 'confirmed' AND scheduled_date > ?", id, today),
    completed: n("SELECT COUNT(*) AS n FROM appointments WHERE doctor_id = ? AND status = 'completed'", id),
    patients: n("SELECT COUNT(DISTINCT patient_id) AS n FROM appointments WHERE doctor_id = ? AND status = 'completed'", id),
    unread: n('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', id),
  });
});

// ---------- SCHEDULE: the patient list for one day ----------
router.get('/schedule', (req, res) => {
  const id = did(req);
  const date = DATE_RE.test(String(req.query.date)) ? req.query.date : todayStr();
  const appointments = db.prepare(`${APPT_SQL} WHERE a.doctor_id = ? AND a.scheduled_date = ? AND a.status IN ('confirmed','completed')
                                   ORDER BY a.scheduled_time`).all(id, date).map(shape);
  const counts = db.prepare(`SELECT scheduled_date AS date, COUNT(*) AS n FROM appointments
                             WHERE doctor_id = ? AND status IN ('confirmed','completed') AND scheduled_date BETWEEN ? AND ?
                             GROUP BY scheduled_date`).all(id, todayStr(), plusDays(6));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = plusDays(i);
    week.push({ date: d, count: (counts.find((c) => c.date === d) || { n: 0 }).n });
  }
  res.json({ date, appointments, week });
});

// ---------- VISIT HISTORY ----------
router.get('/history', (req, res) => {
  res.json(db.prepare(`${APPT_SQL} WHERE a.doctor_id = ? AND a.status = 'completed'
                       ORDER BY a.scheduled_date DESC, a.scheduled_time DESC LIMIT 200`).all(did(req)).map(shape));
});

// Earlier visits of one patient with this doctor (shown while writing a prescription)
router.get('/patients/:id/history', (req, res) => {
  const patient = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM appointments WHERE doctor_id = ? AND patient_id = ?').get(did(req), patient)) {
    return res.status(404).json({ error: 'Patient not found' });
  }
  res.json(db.prepare(`SELECT id, scheduled_date AS date, reason, doctor_notes AS notes, prescription
                       FROM appointments WHERE doctor_id = ? AND patient_id = ? AND status = 'completed'
                       ORDER BY scheduled_date DESC LIMIT 10`).all(did(req), patient));
});

// Finish a visit (or edit the notes of a finished one)
router.post('/appointments/:id/complete', (req, res) => {
  const a = db.prepare('SELECT * FROM appointments WHERE id = ? AND doctor_id = ?').get(Number(req.params.id), did(req));
  if (!a) return res.status(404).json({ error: 'Appointment not found' });
  if (a.status === 'confirmed') {
    if (a.scheduled_date > todayStr()) return res.status(400).json({ error: 'You can complete a visit only on or after the appointment day' });
  } else if (a.status !== 'completed') {
    return res.status(400).json({ error: 'This appointment cannot be completed' });
  }
  const notes = text(req.body.notes, 3000), prescription = text(req.body.prescription, 3000);
  if (!notes && !prescription) return res.status(400).json({ error: 'Write the notes or the prescription' });

  db.prepare("UPDATE appointments SET status = 'completed', doctor_notes = ?, prescription = ? WHERE id = ?").run(notes || null, prescription || null, a.id);
  if (a.status === 'confirmed') {
    const name = db.prepare('SELECT name FROM doctors WHERE user_id = ?').get(did(req)).name;
    notify(a.patient_id, 'Visit summary available', `Your visit with ${name} is complete. See your notes and prescription in Past appointments.`);
  }
  res.json({ message: a.status === 'confirmed' ? 'Visit completed. The patient can now see the prescription.' : 'Notes updated.' });
});

// ---------- WORKPLACES ----------
const shapeWp = (w) => ({
  id: w.id, name: w.name, address: w.address, lat: w.lat, lon: w.lon, fee: w.fee,
  days: JSON.parse(w.days), startTime: w.start_time, endTime: w.end_time, slotMinutes: w.slot_minutes,
});

function readWorkplace(b) {
  const w = {
    name: text(b.name), address: text(b.address, 300), fee: Number(b.fee), days: b.days,
    startTime: text(b.startTime, 5), endTime: text(b.endTime, 5), slotMinutes: Number(b.slotMinutes),
    lat: b.lat === null || b.lat === '' || b.lat === undefined ? null : Number(b.lat),
    lon: b.lon === null || b.lon === '' || b.lon === undefined ? null : Number(b.lon),
  };
  let error = null;
  if (!w.name) error = 'Hospital / clinic name is required';
  else if (!w.address) error = 'Address is required';
  else if (!(w.fee >= 0 && w.fee <= 100000)) error = 'Consultation fee is invalid';
  else if (!Array.isArray(w.days) || !w.days.length || !w.days.every((d) => DAYS.includes(d))) error = 'Select the available days';
  else if (!TIME_RE.test(w.startTime) || !TIME_RE.test(w.endTime) || w.startTime >= w.endTime) error = 'The time range is invalid';
  else if (![10, 15, 20, 30, 45, 60].includes(w.slotMinutes)) error = 'The slot length is invalid';
  return { w, error };
}

router.get('/workplaces', (req, res) => {
  res.json(db.prepare('SELECT * FROM workplaces WHERE doctor_id = ? ORDER BY id').all(did(req)).map(shapeWp));
});

router.post('/workplaces', (req, res) => {
  const { w, error } = readWorkplace(req.body);
  if (error) return res.status(400).json({ error });
  const info = db.prepare(`INSERT INTO workplaces (doctor_id, name, address, lat, lon, fee, days, start_time, end_time, slot_minutes)
                           VALUES (?,?,?,?,?,?,?,?,?,?)`).run(did(req), w.name, w.address, w.lat, w.lon, w.fee, JSON.stringify(w.days), w.startTime, w.endTime, w.slotMinutes);
  res.status(201).json({ message: 'Workplace added', id: info.lastInsertRowid });
});

router.put('/workplaces/:id', (req, res) => {
  const own = db.prepare('SELECT id FROM workplaces WHERE id = ? AND doctor_id = ?').get(Number(req.params.id), did(req));
  if (!own) return res.status(404).json({ error: 'Workplace not found' });
  const { w, error } = readWorkplace(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare(`UPDATE workplaces SET name = ?, address = ?, lat = ?, lon = ?, fee = ?, days = ?, start_time = ?, end_time = ?, slot_minutes = ?
              WHERE id = ?`).run(w.name, w.address, w.lat, w.lon, w.fee, JSON.stringify(w.days), w.startTime, w.endTime, w.slotMinutes, own.id);
  res.json({ message: 'Workplace updated. Appointments already confirmed are not changed.' });
});

router.delete('/workplaces/:id', (req, res) => {
  const own = db.prepare('SELECT id FROM workplaces WHERE id = ? AND doctor_id = ?').get(Number(req.params.id), did(req));
  if (!own) return res.status(404).json({ error: 'Workplace not found' });
  if (db.prepare('SELECT COUNT(*) AS n FROM workplaces WHERE doctor_id = ?').get(did(req)).n <= 1) {
    return res.status(400).json({ error: 'You must keep at least one workplace' });
  }
  if (db.prepare('SELECT 1 FROM appointments WHERE workplace_id = ?').get(own.id)) {
    return res.status(400).json({ error: 'This workplace has appointments, so it cannot be deleted. Edit it instead.' });
  }
  db.prepare('DELETE FROM workplaces WHERE id = ?').run(own.id);
  res.json({ message: 'Workplace deleted' });
});

// ---------- PROFILE ----------
router.get('/profile', (req, res) => {
  res.json(db.prepare(`SELECT d.name, u.email, d.phone, d.clinical_phone AS clinicalPhone, d.address, d.license_no AS license,
                              d.degree, d.speciality, d.experience_years AS experience, d.photo, d.status
                       FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.user_id = ?`).get(did(req)));
});

router.put('/profile', (req, res) => {
  const b = req.body;
  const phone = text(b.phone, 20), clinical = text(b.clinicalPhone, 20), address = text(b.address, 300), exp = Number(b.experience);
  let error = null;
  if (!PHONE.test(phone)) error = 'Enter a valid personal phone number';
  else if (!PHONE.test(clinical)) error = 'Enter a valid clinical phone number';
  else if (!address) error = 'Address is required';
  else if (!(exp >= 0 && exp <= 70)) error = 'Experience (years) is invalid';
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE doctors SET phone = ?, clinical_phone = ?, address = ?, experience_years = ? WHERE user_id = ?').run(phone, clinical, address, exp, did(req));
  res.json({ message: 'Profile updated' });
});

module.exports = router;