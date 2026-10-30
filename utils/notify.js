const db = require('../db');

function notify(userId, title, message) {
  db.prepare('INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)').run(userId, title, message);
}
function notifyAdmins(title, message) {
  for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin'").all()) notify(a.id, title, message);
}

module.exports = { notify, notifyAdmins };