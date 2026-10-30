// Date / slot helpers shared by the admin and doctor routes
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE = /^\+?[0-9]{7,15}$/;

const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => dateStr(new Date());
function plusDays(n, from = new Date()) { const d = new Date(from); d.setDate(d.getDate() + n); return dateStr(d); }
function weekday(s) {
  const [y, m, d] = s.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function slotsFor(w) {
  const [sh, sm] = w.start_time.split(':').map(Number);
  const [eh, em] = w.end_time.split(':').map(Number);
  const out = [];
  for (let t = sh * 60 + sm; t + w.slot_minutes <= eh * 60 + em; t += w.slot_minutes) {
    out.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
  }
  return out;
}
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);

module.exports = { DAYS, DATE_RE, TIME_RE, PHONE, dateStr, todayStr, plusDays, weekday, slotsFor, text };