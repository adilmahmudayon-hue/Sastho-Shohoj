// Developer helper that stands in for the admin / doctor screens until we build them.
// It uses the SAME database file as the app (db.js), so it can never edit the wrong copy.
//
//   node scripts/dev.js list                  show all appointments
//   node scripts/dev.js approve-doctors       approve every pending doctor
//   node scripts/dev.js confirm <id>          admin confirms a request
//   node scripts/dev.js complete <id>         doctor finishes the visit (adds notes + prescription)
const db = require('../db');

const [cmd, arg] = process.argv.slice(2);
const id = Number(arg);

function notify(userId, title, message) {
  db.prepare('INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)').run(userId, title, message);
}
function getAppt() {
  const a = db.prepare(`SELECT a.*, d.name AS doctor_name FROM appointments a
                        JOIN doctors d ON d.user_id = a.doctor_id WHERE a.id = ?`).get(id);
  if (!a) { console.log(`No appointment with id ${arg}. Run "node scripts/dev.js list" to see the real ids.`); return null; }
  return a;
}

if (cmd === 'list') {
  const rows = db.prepare(`SELECT a.id, p.name AS patient, d.name AS doctor, a.status,
                                  a.preferred_date AS preferred, a.preferred_time AS pref_time,
                                  a.scheduled_date AS scheduled, a.scheduled_time AS sched_time
                           FROM appointments a JOIN patients p ON p.user_id = a.patient_id
                           JOIN doctors d ON d.user_id = a.doctor_id ORDER BY a.id`).all();
  console.log(rows.length ? '' : 'No appointments yet.');
  if (rows.length) console.table(rows);

} else if (cmd === 'approve-doctors') {
  const r = db.prepare("UPDATE doctors SET status = 'approved' WHERE status != 'approved'").run();
  console.log(`Approved ${r.changes} doctor(s).`);

} else if (cmd === 'confirm') {
  const a = getAppt();
  if (a) {
    if (a.status !== 'requested') console.log(`Appointment ${id} is "${a.status}", not "requested". Nothing changed.`);
    else {
      db.prepare(`UPDATE appointments SET status = 'confirmed', scheduled_date = preferred_date,
                  scheduled_time = preferred_time, admin_note = 'Please arrive 10 minutes early' WHERE id = ?`).run(id);
      notify(a.patient_id, 'Appointment confirmed', `Your appointment with ${a.doctor_name} is confirmed for ${a.preferred_date} at ${a.preferred_time}.`);
      console.log(`Appointment ${id} confirmed. Refresh the patient page.`);
    }
  }

} else if (cmd === 'complete') {
  const a = getAppt();
  if (a) {
    if (a.status !== 'confirmed') console.log(`Appointment ${id} is "${a.status}". Confirm it first: node scripts/dev.js confirm ${id}`);
    else {
      db.prepare(`UPDATE appointments SET status = 'completed', doctor_notes = ?, prescription = ? WHERE id = ?`)
        .run('Blood pressure slightly high. Reduce salt and review in 2 weeks.', 'Tab. Amlodipine 5mg - 1+0+0 for 30 days', id);
      notify(a.patient_id, 'Visit summary available', `Your visit with ${a.doctor_name} is complete. Your prescription is in Past appointments.`);
      console.log(`Appointment ${id} marked completed. See it under Past appointments.`);
    }
  }

} else {
  console.log('Commands: list | approve-doctors | confirm <id> | complete <id>');
}