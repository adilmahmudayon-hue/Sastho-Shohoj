// ================= helpers =================
const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isoToday = () => isoDate(new Date());
const isoPlus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d); };

function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
const fmtStamp = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const STATUS = {
  requested: ['Waiting for admin', 'warn'], confirmed: ['Confirmed', 'ok'],
  completed: ['Completed', 'done'], cancelled: ['Cancelled', 'bad'], rejected: ['Rejected', 'bad'],
};
const pill = (s) => `<span class="pill ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

let toastTimer;
function toast(text, type = 'ok') {
  const m = $('#msg');
  m.textContent = text;
  m.className = 'message ' + (type === 'ok' ? 'ok' : 'error');
  m.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (m.hidden = true), 6000);
}

async function request(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/'; throw new Error('Please log in'); }
  if (res.status === 403 && /temporary password/.test(data.error || '')) { location.href = '/change-password.html'; }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
const api = (url, method, body) => request('/api/patient' + url, method, body);

function openModal(html) { $('#modalBox').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; }
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal();
});

// ================= state =================
const doctorIndex = {};      // doctors currently on screen, by id (for the booking window)
let apptIndex = {};          // appointments on screen, by id
let apptTab = 'upcoming';
let presetFilters = null;    // set by the dashboard quick search

// ================= doctor cards, booking, slots =================
function doctorCard(d) {
  doctorIndex[d.id] = d;
  const photo = d.photo ? `<img src="${esc(d.photo)}" alt="" />` : '<div class="avatar">🩺</div>';
  const places = d.workplaces.map((w) => `
    <div class="wp">
      <div><strong>${esc(w.name)}</strong><br><small>${esc(w.address)}</small></div>
      <div class="wp-meta">৳${esc(w.fee)} · ${esc(w.days.join(', '))} · ${fmtTime(w.startTime)}–${fmtTime(w.endTime)}</div>
      <button class="secondary" data-book="${d.id}:${w.id}">Request appointment</button>
    </div>`).join('');
  return `<article class="doc">
    <div class="doc-head">${photo}
      <div><h3>${esc(d.name)}</h3><p>${esc(d.speciality)} · ${esc(d.degree)}</p><small>${esc(d.experience)} years of experience</small></div>
      <button class="fav ${d.isFavorite ? 'on' : ''}" data-fav="${d.id}" title="Favorite">${d.isFavorite ? '★' : '☆'}</button>
    </div>${places}</article>`;
}

// Loads the free time slots whenever the date changes
function slotPicker(form, doctorId, workplaceId) {
  const box = $('.slots', form), dateInput = form.elements.date;
  dateInput.addEventListener('change', async () => {
    if (!dateInput.value) return;
    box.innerHTML = '<small>Loading…</small>';
    try {
      const d = await api(`/doctors/${doctorId}/slots?workplaceId=${workplaceId}&date=${dateInput.value}`);
      if (!d.available) { box.innerHTML = `<small class="err">The doctor does not sit on this day. Available days: ${esc(d.days.join(', '))}</small>`; return; }
      box.innerHTML = d.slots.map((s) => `<label class="slot ${s.taken ? 'taken' : ''}">
        <input type="radio" name="slot" value="${s.time}" ${s.taken ? 'disabled' : ''} />${fmtTime(s.time)}</label>`).join('')
        || '<small>No slots on this day.</small>';
    } catch (err) { box.innerHTML = `<small class="err">${esc(err.message)}</small>`; }
  });
}
const pickedSlot = (form) => { const r = $('input[name=slot]:checked', form); return r ? r.value : ''; };

function bookingModal(doc, w) {
  openModal(`
    <h2>Request appointment</h2>
    <p><strong>${esc(doc.name)}</strong> · ${esc(w.name)}<br><small>Fee ৳${esc(w.fee)} · Days: ${esc(w.days.join(', '))}</small></p>
    <p class="hint">Pick the day and time you prefer. The admin will confirm the final schedule.</p>
    <form id="bookForm" novalidate>
      <label>Consultation type
        <select name="type"><option>In-person</option><option>Online</option></select></label>
      <label>Preferred date
        <input type="date" name="date" min="${isoToday()}" max="${isoPlus(60)}" required /></label>
      <div class="slots"><small>Choose a date to see the time slots.</small></div>
      <label>Reason / symptoms
        <textarea name="reason" rows="3" maxlength="1000" placeholder="Describe your problem briefly"></textarea></label>
      <div class="row-btns">
        <button type="button" class="secondary" data-close>Cancel</button>
        <button type="submit" class="primary">Send request</button>
      </div>
    </form>`);
  const form = $('#bookForm');
  slotPicker(form, doc.id, w.id);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const time = pickedSlot(form);
    if (!form.date.value || !time) return toast('Please choose a date and a time slot.', 'error');
    try {
      const r = await api('/appointments', 'POST', {
        doctorId: doc.id, workplaceId: w.id, type: form.type.value,
        date: form.date.value, time, reason: form.reason.value,
      });
      closeModal();
      toast(r.message);
      location.hash = '#appointments';
    } catch (err) { toast(err.message, 'error'); }
  });
}

function rescheduleModal(a) {
  openModal(`
    <h2>Reschedule</h2>
    <p><strong>${esc(a.doctorName)}</strong> · ${esc(a.workplaceName)}<br>
      <small>Current: ${fmtDate(a.date)} at ${fmtTime(a.time)}</small></p>
    <p class="hint">Choose a new day and time. The admin will confirm it.</p>
    <form id="reForm" novalidate>
      <label>New date<input type="date" name="date" min="${isoToday()}" max="${isoPlus(60)}" required /></label>
      <div class="slots"><small>Choose a date to see the time slots.</small></div>
      <div class="row-btns">
        <button type="button" class="secondary" data-close>Close</button>
        <button type="submit" class="primary">Request new time</button>
      </div>
    </form>`);
  const form = $('#reForm');
  slotPicker(form, a.doctorId, a.workplaceId);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const time = pickedSlot(form);
    if (!form.date.value || !time) return toast('Please choose a date and a time slot.', 'error');
    try {
      const r = await api(`/appointments/${a.id}/reschedule`, 'POST', { date: form.date.value, time });
      closeModal(); toast(r.message); appointmentsView();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ================= 1. DASHBOARD =================
async function dashboardView() {
  const d = await api('/dashboard');
  const up = d.upcoming.map((a) => `
    <div class="appt-mini"><div><strong>${esc(a.doctorName)}</strong> · ${esc(a.speciality)}<br>
      <small>${esc(a.workplaceName)} · ${esc(a.type)}</small></div>
      <div class="when">${fmtDate(a.date)}<br>${fmtTime(a.time)}</div></div>`).join('')
    || '<p class="hint">No confirmed appointments yet.</p>';
  const recent = d.recent.map((n) => `
    <div class="note ${n.isRead ? '' : 'unread'}"><strong>${esc(n.title)}</strong><br>
      <small>${esc(n.message)}</small><br><small class="hint">${fmtStamp(n.createdAt)}</small></div>`).join('')
    || '<p class="hint">No activity yet.</p>';
  const favs = d.favorites.map((f) => `
    <div class="appt-mini"><div><strong>${esc(f.name)}</strong><br><small>${esc(f.speciality)}</small></div>
      <button class="secondary" data-book="${f.id}:${f.workplaces[0].id}">Book</button></div>`).join('');
  d.favorites.forEach((f) => (doctorIndex[f.id] = f));

  view.innerHTML = `
    <h1>Dashboard</h1>
    <div class="stats">
      <div class="stat"><b>${d.upcoming.length}</b><span>Upcoming</span></div>
      <div class="stat"><b>${d.pendingCount}</b><span>Waiting for admin</span></div>
      <div class="stat"><b>${d.completedCount}</b><span>Past visits</span></div>
      <div class="stat"><b>${d.unread}</b><span>Unread notifications</span></div>
    </div>
    <div class="card"><h2>Quick booking</h2>
      <form id="quick" class="row"><input name="q" placeholder="Doctor name or speciality, e.g. Cardiology" />
      <button class="primary" style="margin:0;width:auto;padding:10px 20px">Search</button></form>
      ${favs ? `<h3>Your favorites</h3>${favs}` : ''}</div>
    <div class="two">
      <div class="card"><h2>Upcoming appointments</h2>${up}<p><a href="#appointments">See all →</a></p></div>
      <div class="card"><h2>Recent activity</h2>${recent}<p><a href="#notifications">All notifications →</a></p></div>
    </div>`;
  $('#quick').addEventListener('submit', (e) => {
    e.preventDefault();
    presetFilters = { q: e.target.q.value };
    location.hash = '#doctors';
  });
}

// ================= 2. FIND DOCTORS =================
async function doctorsView() {
  const f = presetFilters || {};
  presetFilters = null;
  view.innerHTML = `
    <h1>Find Doctors</h1>
    <form id="filters" class="card filters">
      <label>Name or speciality<input name="q" value="${esc(f.q || '')}" placeholder="e.g. Nusrat or Cardiology" /></label>
      <label>Speciality<input name="speciality" placeholder="e.g. Pediatrics" /></label>
      <label>Hospital / clinic / area<input name="hospital" placeholder="e.g. Khulna Medical" /></label>
      <label>Max fee (৳)<input name="maxFee" type="number" min="0" /></label>
      <label>Available on
        <select name="day"><option value="">Any day</option>
          ${['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => `<option>${d}</option>`).join('')}</select></label>
      <button class="primary" type="submit">Search</button>
    </form>
    <div id="results"></div>`;
  const form = $('#filters');
  const search = async () => {
    const params = new URLSearchParams();
    new FormData(form).forEach((v, k) => v && params.append(k, v));
    $('#results').innerHTML = '<p class="hint">Searching…</p>';
    try {
      const list = await api('/doctors?' + params);
      $('#results').innerHTML = list.length
        ? `<p class="hint">${list.length} doctor(s) found</p><div class="docs">${list.map(doctorCard).join('')}</div>`
        : '<div class="card"><p>No doctors match your search. Try fewer filters.</p></div>';
    } catch (err) { $('#results').innerHTML = `<div class="message error">${esc(err.message)}</div>`; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); search(); });
  search();
}

// ================= 4. MY APPOINTMENTS =================
function apptCard(a) {
  apptIndex[a.id] = a;
  const photo = a.photo ? `<img src="${esc(a.photo)}" alt="" />` : '<div class="avatar">🩺</div>';
  const history = a.status === 'completed' ? `
      ${a.reason ? `<p><strong>Your information:</strong> ${esc(a.reason)}</p>` : ''}
      ${a.doctorNotes ? `<p><strong>Doctor's notes:</strong> ${esc(a.doctorNotes)}</p>` : ''}
      ${a.prescription ? `<div class="rx"><strong>Prescription</strong><pre>${esc(a.prescription)}</pre></div>` : '<p class="hint">No prescription was added.</p>'}` : '';
  const note = a.status === 'cancelled' ? `<p class="hint">Cancelled by ${esc(a.cancelledBy || 'the clinic')}.</p>` : '';
  const buttons = (a.canReschedule ? `<button class="secondary" data-resched="${a.id}">Reschedule</button>` : '')
    + (a.canCancel ? `<button class="danger-btn" data-cancel="${a.id}">Cancel</button>` : '');
  return `<article class="doc">
    <div class="doc-head">${photo}
      <div><h3>${esc(a.doctorName)}</h3><p>${esc(a.speciality)} · ${esc(a.workplaceName)}</p>
        <small>${fmtDate(a.date)} at ${fmtTime(a.time)} · ${esc(a.type)}${a.status === 'requested' ? ' (preferred time)' : ''}</small></div>
      ${pill(a.status)}
    </div>
    ${a.status === 'requested' && a.previousSchedule ? `<p class="hint">Previously: ${esc(a.previousSchedule)}</p>` : ''}
    ${a.adminNote ? `<p><strong>Note from clinic:</strong> ${esc(a.adminNote)}</p>` : ''}
    ${history}${note}
    ${buttons ? `<div class="row-btns">${buttons}</div>` : ''}</article>`;
}

async function appointmentsView() {
  const data = await api('/appointments');
  apptIndex = {};
  const list = (rows, empty) => rows.length ? rows.map(apptCard).join('') : `<div class="card"><p>${empty}</p></div>`;
  view.innerHTML = `
    <h1>My Appointments</h1>
    <div class="tabs">
      <button class="tab ${apptTab === 'upcoming' ? 'active' : ''}" data-tab="upcoming">Upcoming (${data.upcoming.length})</button>
      <button class="tab ${apptTab === 'past' ? 'active' : ''}" data-tab="past">Past (${data.past.length})</button>
    </div>
    <div class="docs">${apptTab === 'upcoming'
      ? list(data.upcoming, 'No upcoming appointments. Use “Find Doctors” to request one.')
      : list(data.past, 'No past appointments yet.')}</div>`;
}

// ================= 5. FAVORITES =================
async function favoritesView() {
  const list = await api('/favorites');
  view.innerHTML = `<h1>Favorite Doctors</h1>` + (list.length
    ? `<div class="docs">${list.map(doctorCard).join('')}</div>`
    : '<div class="card"><p>No favorites yet. Tap the ☆ on a doctor to save them here.</p></div>');
}

// ================= 6. NOTIFICATIONS =================
async function notificationsView() {
  const list = await api('/notifications');
  view.innerHTML = `
    <div class="row-between"><h1>Notifications</h1>
      ${list.some((n) => !n.isRead) ? '<button class="secondary" id="readAll">Mark all as read</button>' : ''}</div>
    ${list.length ? list.map((n) => `
      <div class="card note ${n.isRead ? '' : 'unread'}" data-note="${n.id}">
        <strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small class="hint">${fmtStamp(n.createdAt)}</small></div>`).join('')
      : '<div class="card"><p>No notifications yet.</p></div>'}`;
  const btn = $('#readAll');
  if (btn) btn.addEventListener('click', async () => { await api('/notifications/read-all', 'POST'); notificationsView(); refreshBadge(); });
}

// ================= 7. PROFILE =================
async function profileView() {
  const p = await api('/profile');
  view.innerHTML = `
    <h1>My Profile</h1>
    <form id="profileForm" class="card" novalidate>
      <h2>Personal details</h2>
      <div class="grid">
        <label>Full name<input name="name" value="${esc(p.name)}" required /></label>
        <label>Email (login ID)<input value="${esc(p.email)}" disabled /></label>
        <label>Personal phone<input name="phone" value="${esc(p.phone)}" required /></label>
        <label>Emergency phone<input name="emergencyPhone" value="${esc(p.emergencyPhone)}" required /></label>
        <label>Date of birth<input type="date" name="dob" value="${esc(p.dob)}" max="${isoToday()}" required /></label>
        <label>Gender<select name="gender">
          ${['male', 'female', 'other'].map((g) => `<option value="${g}" ${p.gender === g ? 'selected' : ''}>${g[0].toUpperCase() + g.slice(1)}</option>`).join('')}</select></label>
        <label class="full">Address<textarea name="address" rows="2" required>${esc(p.address)}</textarea></label>
      </div>
      <p class="hint">Age: ${esc(p.age)} (calculated from your date of birth)</p>
      <button class="primary" type="submit">Save changes</button>
    </form>

    <form id="pwForm" class="card" novalidate>
      <h2>Password</h2>
      <div class="grid">
        <label>Current password<input type="password" name="currentPassword" autocomplete="current-password" required /></label>
        <span></span>
        <label>New password<input type="password" name="newPassword" autocomplete="new-password" required /></label>
        <label>Confirm new password<input type="password" name="confirm" autocomplete="new-password" required /></label>
      </div>
      <p class="hint">At least 8 characters, with a letter and a number.</p>
      <button class="primary" type="submit">Change password</button>
    </form>`;

  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api('/profile', 'PUT', Object.fromEntries(['name', 'phone', 'emergencyPhone', 'dob', 'gender', 'address'].map((k) => [k, f[k].value])));
      toast(r.message); profileView();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.newPassword.value !== f.confirm.value) return toast('New passwords do not match.', 'error');
    try {
      const r = await request('/api/auth/change-password', 'POST', { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value });
      toast(r.message); f.reset();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ================= clicks (one listener for all pages) =================
view.addEventListener('click', async (e) => {
  const t = e.target.closest('button, .note');
  if (!t) return;
  try {
    if (t.dataset.book) {                                   // open the booking window
      const [d, w] = t.dataset.book.split(':').map(Number);
      const doc = doctorIndex[d];
      bookingModal(doc, doc.workplaces.find((x) => x.id === w));
    } else if (t.dataset.fav) {                             // star / un-star a doctor
      const id = Number(t.dataset.fav), on = t.classList.contains('on');
      await api('/favorites/' + id, on ? 'DELETE' : 'POST');
      if (location.hash === '#favorites') return favoritesView();
      t.classList.toggle('on', !on); t.textContent = on ? '☆' : '★';
      if (doctorIndex[id]) doctorIndex[id].isFavorite = !on;
    } else if (t.dataset.tab) {                             // upcoming / past tabs
      apptTab = t.dataset.tab; appointmentsView();
    } else if (t.dataset.cancel) {
      if (!confirm('Cancel this appointment?')) return;
      const r = await api(`/appointments/${t.dataset.cancel}/cancel`, 'POST');
      toast(r.message); appointmentsView();
    } else if (t.dataset.resched) {
      rescheduleModal(apptIndex[t.dataset.resched]);
    } else if (t.dataset.note && t.classList.contains('unread')) {   // click = mark as read
      await api(`/notifications/${t.dataset.note}/read`, 'POST');
      t.classList.remove('unread'); refreshBadge();
    }
  } catch (err) { toast(err.message, 'error'); }
});

// ================= routing =================
const VIEWS = { dashboard: dashboardView, doctors: doctorsView, appointments: appointmentsView, favorites: favoritesView, notifications: notificationsView, profile: profileView };

async function refreshBadge() {
  try {
    const { unread } = await api('/notifications/count');
    const b = $('#badge');
    b.textContent = unread; b.hidden = !unread;
  } catch { /* ignore */ }
}

async function route() {
  const name = location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'dashboard';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  $('#sidebar').classList.remove('open');
  view.innerHTML = '<p class="hint">Loading…</p>';
  try { await VIEWS[name](); }
  catch (err) { view.innerHTML = `<div class="message error">${esc(err.message)}</div>`; }
  refreshBadge();
}

$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#logout').addEventListener('click', async () => { await request('/api/auth/logout', 'POST'); location.href = '/'; });
window.addEventListener('hashchange', route);

// Only patients may be here
(async () => {
  try {
    const me = await request('/api/auth/me');
    if (me.role !== 'patient') return (location.href = '/dashboard.html');
    if (me.mustChangePassword) return (location.href = '/change-password.html');
    route();
  } catch { location.href = '/'; }
})();