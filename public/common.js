// ================= shared helpers for the admin and doctor portals =================
const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isoToday = () => isoDate(new Date());
const isoPlus = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return isoDate(d); };

function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDate(s) {
  if (!s) return '';
  return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
const fmtStamp = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const STATUS = {
  requested: ['Waiting for admin', 'warn'], confirmed: ['Confirmed', 'ok'], completed: ['Completed', 'done'],
  cancelled: ['Cancelled', 'bad'], rejected: ['Rejected', 'bad'], pending: ['Pending', 'warn'], approved: ['Approved', 'ok'],
};
const pill = (s) => `<span class="pill ${(STATUS[s] || ['', 'done'])[1]}">${(STATUS[s] || [s])[0]}</span>`;

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
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const res = await fetch(url, {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/'; throw new Error('Please log in'); }
  if (res.status === 403 && /temporary password/.test(data.error || '')) location.href = '/change-password.html';
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ---------- modal ----------
function openModal(html) { $('#modalBox').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; }
function modalError(msg) {
  let e = $('#modalErr');
  if (!e) { e = document.createElement('div'); e.id = 'modalErr'; e.className = 'message error'; $('#modalBox').prepend(e); }
  e.textContent = msg;
}
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal();
});

// A small window with one text box (used for rejecting, cancelling ...)
function noteModal({ title, label, required = false, button, onSubmit }) {
  openModal(`
    <h2>${esc(title)}</h2>
    <form id="noteForm" novalidate>
      <label>${esc(label)}<textarea name="note" rows="3" maxlength="500"></textarea></label>
      <div class="row-btns">
        <button type="button" class="secondary" data-close>Close</button>
        <button type="submit" class="primary">${esc(button)}</button>
      </div>
    </form>`);
  $('#noteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = e.target.note.value.trim();
    if (required && !note) return modalError('Please write a short note.');
    try { await onSubmit(note); closeModal(); } catch (err) { modalError(err.message); }
  });
}

// ---------- password card (My Profile pages) ----------
const passwordCard = () => `
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

function bindPasswordForm() {
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

// ---------- notifications (same page for admin and doctor) ----------
async function notificationsView() {
  const list = await request('/api/notifications');
  view.innerHTML = `
    <div class="row-between"><h1>Notifications</h1>
      ${list.some((n) => !n.isRead) ? '<button class="secondary" id="readAll">Mark all as read</button>' : ''}</div>
    ${list.length ? list.map((n) => `
      <div class="card note ${n.isRead ? '' : 'unread'}" data-note="${n.id}">
        <strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small class="hint">${fmtStamp(n.createdAt)}</small></div>`).join('')
      : '<div class="card"><p>No notifications yet.</p></div>'}`;
  const btn = $('#readAll');
  if (btn) btn.addEventListener('click', async () => { await request('/api/notifications/read-all', 'POST'); notificationsView(); refreshBadge(); });
}
view.addEventListener('click', async (e) => {
  const n = e.target.closest('[data-note]');
  if (n && n.classList.contains('unread')) {
    await request(`/api/notifications/${n.dataset.note}/read`, 'POST');
    n.classList.remove('unread'); refreshBadge();
  }
});

async function refreshBadge() {
  try {
    const { unread } = await request('/api/notifications/count');
    const b = $('#badge');
    b.textContent = unread; b.hidden = !unread;
  } catch { /* ignore */ }
}

// ---------- page shell: menu, routing, logout, role check ----------
function startPortal(role, VIEWS, guard) {
  async function route() {
    const keys = Object.keys(VIEWS);
    const wanted = location.hash.slice(1).split('?')[0];
    const key = keys.includes(wanted) ? wanted : keys[0];
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === key));
    $('#sidebar').classList.remove('open');
    view.innerHTML = '<p class="hint">Loading…</p>';
    try { await VIEWS[key](); }
    catch (err) { view.innerHTML = `<div class="message error">${esc(err.message)}</div>`; }
    refreshBadge();
  }
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#logout').addEventListener('click', async () => { await request('/api/auth/logout', 'POST'); location.href = '/'; });
  window.addEventListener('hashchange', route);

  (async () => {
    try {
      const me = await request('/api/auth/me');
      if (me.role !== role) return (location.href = '/dashboard.html');
      if (me.mustChangePassword) return (location.href = '/change-password.html');
      window.ME = me;
      if (guard && guard(me) === false) return;
      route();
    } catch { location.href = '/'; }
  })();
}