const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../utils/auth');
const { DATE_RE, TIME_RE, todayStr, weekday, slotsFor, text } = require('../utils/schedule');
const { notify } = require('../utils/notify');

const router = express.Router();

// Only logged-in admins whose account a Super Admin has approved
router.use(requireAuth, requireRole('admin'));
router.use((req, res, next) => {
  const u = db.prepare(`SELECT u.must_change_password AS must, a.status, a.admin_role AS role
                        FROM users u JOIN admins a ON a.user_id = u.id WHERE u.id = ?`).get(req.auth.id);
  if (!u) return res.status(401).json({ error: 'Please log in' });
  if (u.must) return res.status(403).json({ error: 'Please change your temporary password first' });
  if (u.status !== 'approved') return res.status(403).json({ error: 'Your admin account is waiting for approval by a Super Admin.' });
  req.admin = { id: req.auth.id, role: u.role };
  next();
});
const superOnly = (req, res, next) =>
  req.admin.role === 'Super Admin' ? next() : res.status(403).json({ error: 'Only a Super Admin can do this' });

// ---------- helpers ----------
const APPT_SQL = `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone, p.age AS patient_age, p.gender AS patient_gender,
                         d.name AS doctor_name, d.speciality, w.name AS workplace_name, w.address AS workplace_address, w.fee
                  FROM appointments a
                  JOIN patients p ON p.user_id = a.patient_id
                  JOIN doctors d ON d.user_id = a.doctor_id
                  JOIN workplaces w ON w.id = a.workplace_id`;

const shape = (a) => ({
  id: a.id, status: a.status, type: a.consultation_type, reason: a.reason, createdAt: a.created_at,
  patientId: a.patient_id, patientName: a.patient_name, patientPhone: a.patient_phone, patientAge: a.patient_age, patientGender: a.patient_gender,
  doctorId: a.doctor_id, doctorName: a.doctor_name, speciality: a.speciality,
  workplaceId: a.workplace_id, workplaceName: a.workplace_name, workplaceAddress: a.workplace_address, fee: a.fee,
  preferredDate: a.preferred_date, preferredTime: a.preferred_time,
  scheduledDate: a.scheduled_date, scheduledTime: a.scheduled_time,
  adminNote: a.admin_note, previousSchedule: a.previous_schedule, cancelledBy: a.cancelled_by,
});

// Checks that a date + time is a real, free slot at this workplace. Returns { error } or { w }.
function checkSlot(workplaceId, date, time, excludeId = 0) {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return { error: 'Choose a date and a time slot' };
  const w = db.prepare('SELECT * FROM workplaces WHERE id = ?').get(workplaceId);
  if (!w) return { error: 'Workplace not found' };
  if (date < todayStr()) return { error: 'The date cannot be in the past' };
  if (!JSON.parse(w.days).includes(weekday(date))) return { error: `The doctor does not sit on ${weekday(date)}s at this place` };
  if (!slotsFor(w).includes(time)) return { error: 'That time slot does not exist' };
  const taken = db.prepare(`SELECT 1 FROM appointments WHERE workplace_id = ? AND scheduled_date = ? AND scheduled_time = ?
                            AND status = 'confirmed' AND id != ?`).get(w.id, date, time, excludeId);
  if (taken) return { error: 'That slot is already booked for another patient' };
  return { w };
}

const getAppt = (req) => db.prepare('SELECT * FROM appointments WHERE id = ?').get(Number(req.params.id));
const doctorName = (id) => db.prepare('SELECT name FROM doctors WHERE user_id = ?').get(id).name;

// ---------- DASHBOARD ----------
router.get('/dashboard', (req, res) => {
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  const isSuper = req.admin.role === 'Super Admin';
  res.json({
    isSuper,
    waiting: n("SELECT COUNT(*) AS n FROM appointments WHERE status = 'requested'"),
    today: n("SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed' AND scheduled_date = ?", todayStr()),
    pendingDoctors: n("SELECT COUNT(*) AS n FROM doctors WHERE status = 'pending'"),
    pendingAdmins: isSuper ? n("SELECT COUNT(*) AS n FROM admins WHERE status = 'pending'") : null,
    patients: n('SELECT COUNT(*) AS n FROM patients'),
    doctors: n("SELECT COUNT(*) AS n FROM doctors WHERE status = 'approved'"),
    oldest: db.prepare(`${APPT_SQL} WHERE a.status = 'requested' ORDER BY a.created_at, a.id LIMIT 5`).all().map(shape),
  });
});

// ---------- APPOINTMENT REQUESTS ----------
router.get('/appointments', (req, res) => {
  const tab = ['requested', 'confirmed', 'history'].includes(req.query.tab) ? req.query.tab : 'requested';
  const where = { requested: "a.status = 'requested'", confirmed: "a.status = 'confirmed'", history: "a.status IN ('completed','cancelled','rejected')" }[tab];
  const order = { requested: 'a.created_at, a.id', confirmed: 'a.scheduled_date, a.scheduled_time', history: 'a.id DESC' }[tab];
  const counts = db.prepare(`SELECT
      SUM(status = 'requested') AS requested, SUM(status = 'confirmed') AS confirmed,
      SUM(status IN ('completed','cancelled','rejected')) AS history FROM appointments`).get();
  res.json({
    counts: { requested: counts.requested || 0, confirmed: counts.confirmed || 0, history: counts.history || 0 },
    items: db.prepare(`${APPT_SQL} WHERE ${where} ORDER BY ${order} LIMIT 200`).all().map(shape),
  });
});

router.get('/slots', (req, res) => {
  const workplaceId = Number(req.query.workplaceId), date = text(req.query.date, 10), excludeId = Number(req.query.excludeId) || 0;
  const w = db.prepare('SELECT * FROM workplaces WHERE id = ?').get(workplaceId);
  if (!w || !DATE_RE.test(date)) return res.status(400).json({ error: 'Choose a valid date' });
  const days = JSON.parse(w.days);
  if (!days.includes(weekday(date))) return res.json({ available: false, days, slots: [] });
  const taken = new Set(db.prepare(`SELECT scheduled_time FROM appointments WHERE workplace_id = ? AND scheduled_date = ?
                                    AND status = 'confirmed' AND id != ?`).all(w.id, date, excludeId).map((r) => r.scheduled_time));
  res.json({ available: true, days, slots: slotsFor(w).map((t) => ({ time: t, taken: taken.has(t) })) });
});

// Confirm a request, or change the time of an already confirmed appointment
router.post('/appointments/:id/confirm', (req, res) => {
  const a = getAppt(req);
  if (!a) return res.status(404).json({ error: 'Appointment not found' });
  if (a.status !== 'requested' && a.status !== 'confirmed') return res.status(400).json({ error: 'This appointment can no longer be scheduled' });
  const date = text(req.body.date, 10), time = text(req.body.time, 5), note = text(req.body.note, 500);
  const { error, w } = checkSlot(a.workplace_id, date, time, a.id);
  if (error) return res.status(400).json({ error });

  const changed = a.status === 'confirmed';
  db.prepare(`UPDATE appointments SET status = 'confirmed', scheduled_date = ?, scheduled_time = ?, admin_note = ?,
              previous_schedule = ? WHERE id = ?`)
    .run(date, time, note || null, changed ? `${a.scheduled_date} ${a.scheduled_time}` : a.previous_schedule, a.id);

  const doc = doctorName(a.doctor_id);
  notify(a.patient_id, changed ? 'Appointment time changed' : 'Appointment confirmed',
    `Your appointment with ${doc} at ${w.name} is ${changed ? 'now' : 'confirmed for'} ${date} at ${time}.${note ? ' Note: ' + note : ''}`);
  notify(a.doctor_id, 'New patient scheduled', `A patient is scheduled with you on ${date} at ${time} at ${w.name}.`);
  res.json({ message: changed ? 'Time changed. The patient and doctor were notified.' : 'Appointment confirmed. The patient and doctor were notified.' });
});

router.post('/appointments/:id/reject', (req, res) => {
  const a = getAppt(req);
  if (!a) return res.status(404).json({ error: 'Appointment not found' });
  if (a.status !== 'requested') return res.status(400).json({ error: 'Only waiting requests can be rejected' });
  const note = text(req.body.note, 500);
  db.prepare("UPDATE appointments SET status = 'rejected', admin_note = ? WHERE id = ?").run(note || null, a.id);
  notify(a.patient_id, 'Request not accepted', `Your request for ${doctorName(a.doctor_id)} on ${a.preferred_date} could not be scheduled.${note ? ' Reason: ' + note : ''} Please request another time.`);
  res.json({ message: 'Request rejected. The patient was notified.' });
});

router.post('/appointments/:id/cancel', (req, res) => {
  const a = getAppt(req);
  if (!a) return res.status(404).json({ error: 'Appointment not found' });
  if (a.status !== 'confirmed') return res.status(400).json({ error: 'Only confirmed appointments can be cancelled' });
  const note = text(req.body.note, 500);
  db.prepare("UPDATE appointments SET status = 'cancelled', cancelled_by = 'admin', admin_note = ? WHERE id = ?").run(note || null, a.id);
  const doc = doctorName(a.doctor_id);
  notify(a.patient_id, 'Appointment cancelled', `Your appointment with ${doc} on ${a.scheduled_date} at ${a.scheduled_time} was cancelled by the clinic.${note ? ' Reason: ' + note : ''}`);
  notify(a.doctor_id, 'Appointment cancelled', `The appointment on ${a.scheduled_date} at ${a.scheduled_time} was cancelled by the clinic.`);
  res.json({ message: 'Appointment cancelled. The patient and doctor were notified.' });
});

// ---------- DOCTORS ----------
router.get('/doctors', (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`SELECT d.user_id AS id, d.name, u.email, d.phone, d.clinical_phone AS clinicalPhone, d.address,
                                  d.license_no AS license, d.degree, d.speciality, d.experience_years AS experience, d.photo, d.status
                           FROM doctors d JOIN users u ON u.id = d.user_id ${status ? 'WHERE d.status = ?' : ''}
                           ORDER BY d.user_id DESC`).all(...(status ? [status] : []));
  const wps = db.prepare('SELECT * FROM workplaces').all();
  res.json(rows.map((d) => ({
    ...d,
    workplaces: wps.filter((w) => w.doctor_id === d.id).map((w) => ({
      id: w.id, name: w.name, address: w.address, fee: w.fee, days: JSON.parse(w.days), startTime: w.start_time, endTime: w.end_time,
    })),
  })));
});

function setDoctorStatus(status, title, body) {
  return (req, res) => {
    const d = db.prepare('SELECT user_id FROM doctors WHERE user_id = ?').get(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Doctor not found' });
    const note = text(req.body.note, 500);
    db.prepare('UPDATE doctors SET status = ? WHERE user_id = ?').run(status, d.user_id);
    notify(d.user_id, title, body + (note && status === 'rejected' ? ' Reason: ' + note : ''));
    res.json({ message: `Doctor ${status}.` });
  };
}
router.post('/doctors/:id/approve', superOnly, setDoctorStatus('approved', 'Profile approved', 'Your profile was verified. Patients can now find and book you.'));
router.post('/doctors/:id/reject', superOnly, setDoctorStatus('rejected', 'Profile not approved', 'Your profile could not be approved.'));

// ---------- OTHER ADMINS (Super Admin only) ----------
router.get('/admins', superOnly, (req, res) => {
  res.json(db.prepare(`SELECT a.user_id AS id, a.name, u.email, a.employee_id AS employeeId, a.admin_role AS adminRole, a.status
                       FROM admins a JOIN users u ON u.id = a.user_id ORDER BY a.status = 'pending' DESC, a.user_id DESC`).all()
    .map((a) => ({ ...a, isMe: a.id === req.admin.id })));
});

function setAdminStatus(status) {
  return (req, res) => {
    const id = Number(req.params.id);
    if (id === req.admin.id) return res.status(400).json({ error: 'You cannot change your own account' });
    const a = db.prepare('SELECT user_id FROM admins WHERE user_id = ?').get(id);
    if (!a) return res.status(404).json({ error: 'Admin not found' });
    db.prepare('UPDATE admins SET status = ? WHERE user_id = ?').run(status, id);
    notify(id, status === 'approved' ? 'Admin account approved' : 'Admin account not approved',
      status === 'approved' ? 'You can now manage appointments.' : 'Your admin account was not approved.');
    res.json({ message: `Admin ${status}.` });
  };
}
router.post('/admins/:id/approve', superOnly, setAdminStatus('approved'));
router.post('/admins/:id/reject', superOnly, setAdminStatus('rejected'));

// ---------- PATIENTS ----------
router.get('/patients', (req, res) => {
  const q = `%${text(req.query.q, 60).toLowerCase()}%`;
  res.json(db.prepare(`SELECT p.user_id AS id, p.name, u.email, p.phone, p.emergency_phone AS emergencyPhone, p.age, p.gender, p.address,
                              (SELECT COUNT(*) FROM appointments WHERE patient_id = p.user_id) AS appointments
                       FROM patients p JOIN users u ON u.id = p.user_id
                       WHERE lower(p.name) LIKE ? OR lower(u.email) LIKE ? OR p.phone LIKE ?
                       ORDER BY p.name LIMIT 100`).all(q, q, q));
});

// ---------- PROFILE ----------
router.get('/profile', (req, res) => {
  res.json(db.prepare(`SELECT a.name, u.email, a.employee_id AS employeeId, a.admin_role AS adminRole, a.status
                       FROM admins a JOIN users u ON u.id = a.user_id WHERE a.user_id = ?`).get(req.admin.id));
});

module.exports = router;