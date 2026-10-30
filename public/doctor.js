// ================= DOCTOR PORTAL =================
const D = (url, method, body) => request('/api/doctor' + url, method, body);

let schedDate = isoToday();
let apptIndex = {};

// One appointment line (used on the dashboard and the schedule)
function visitCard(a, withActions) {
  apptIndex[a.id] = a;
  let action = '';
  if (withActions) {
    if (a.canComplete) action = `<button class="primary-sm" data-visit="${a.id}">Write notes &amp; prescription</button>`;
    else if (a.status === 'completed') action = `<button class="secondary" data-visit="${a.id}">Edit notes</button>`;
    else action = `<small class="hint">The visit can be completed on ${fmtDate(a.date)}.</small>`;
  }
  return `<article class="doc">
    <div class="doc-head"><div class="avatar">👤</div>
      <div><h3>${fmtTime(a.time)} · ${esc(a.patientName)}</h3>
        <p>${esc(a.patientAge)} yrs · ${esc(a.patientGender)} · ${esc(a.patientPhone)}</p>
        <small>${esc(a.workplaceName)} · ${esc(a.type)}</small></div>
      ${pill(a.status)}</div>
    ${a.reason ? `<p><strong>Reason:</strong> ${esc(a.reason)}</p>` : ''}
    ${a.adminNote ? `<p><strong>Clinic note:</strong> ${esc(a.adminNote)}</p>` : ''}
    <p class="hint">Emergency contact: ${esc(a.patientEmergency)}</p>
    ${a.status === 'completed' && (a.doctorNotes || a.prescription) ? `
      ${a.doctorNotes ? `<p><strong>Notes:</strong> ${esc(a.doctorNotes)}</p>` : ''}
      ${a.prescription ? `<div class="rx"><strong>Prescription</strong><pre>${esc(a.prescription)}</pre></div>` : ''}` : ''}
    ${action ? `<div class="row-btns">${action}</div>` : ''}</article>`;
}

// ================= DASHBOARD =================
async function dashboardView() {
  const d = await D('/dashboard');
  apptIndex = {};
  view.innerHTML = `
    <h1>Dashboard</h1>
    ${d.status === 'pending' ? '<div class="message error">Your profile is waiting for verification. Patients cannot find you until a Super Admin approves it.</div>' : ''}
    ${d.status === 'rejected' ? '<div class="message error">Your profile was not approved. Please contact the clinic administration.</div>' : ''}
    <div class="stats">
      <div class="stat"><b>${d.today.length}</b><span>Patients today</span></div>
      <div class="stat link" data-go="schedule"><b>${d.upcoming}</b><span>Upcoming (after today)</span></div>
      <div class="stat"><b>${d.completed}</b><span>Visits completed</span></div>
      <div class="stat"><b>${d.patients}</b><span>Patients seen</span></div>
    </div>
    <h2>Today's patients · ${fmtDate(isoToday())}</h2>
    <div class="docs">${d.today.length ? d.today.map((a) => visitCard(a, false)).join('')
      : '<div class="card"><p>No patients are scheduled for today.</p></div>'}</div>
    ${d.today.length ? '<p><a href="#schedule">Open my schedule to write notes →</a></p>' : ''}`;
}

// ================= SCHEDULE =================
async function scheduleView() {
  const d = await D('/schedule?date=' + schedDate);
  apptIndex = {};
  const week = d.week.map((w) => `
    <button class="day ${w.date === d.date ? 'active' : ''}" data-day="${w.date}">
      <span>${parseDate(w.date).toLocaleDateString(undefined, { weekday: 'short' })}</span>
      <b>${parseDate(w.date).getDate()}</b><small>${w.count} pt</small></button>`).join('');
  view.innerHTML = `
    <h1>My Schedule</h1>
    <div class="card">
      <div class="datebar">
        <button class="secondary" data-shift="-1">◀</button>
        <input type="date" id="dayPick" value="${d.date}" />
        <button class="secondary" data-shift="1">▶</button>
        <button class="secondary" data-day="${isoToday()}">Today</button>
      </div>
      <div class="week">${week}</div>
    </div>
    <h2>${fmtDate(d.date)} · ${d.appointments.length} patient(s)</h2>
    <div class="docs">${d.appointments.length ? d.appointments.map((a) => visitCard(a, true)).join('')
      : '<div class="card"><p>No patients scheduled on this day.</p></div>'}</div>`;
  $('#dayPick').addEventListener('change', (e) => { if (e.target.value) { schedDate = e.target.value; scheduleView(); } });
}

// Write the notes + prescription for a visit
async function visitModal(a) {
  openModal(`
    <h2>${a.status === 'completed' ? 'Edit visit notes' : 'Complete visit'}</h2>
    <p><strong>${esc(a.patientName)}</strong> · ${esc(a.patientAge)} yrs · ${esc(a.patientGender)}<br>
      <small>${fmtDate(a.date)} at ${fmtTime(a.time)} · ${esc(a.workplaceName)}</small></p>
    ${a.reason ? `<p><strong>Patient says:</strong> ${esc(a.reason)}</p>` : ''}
    <div id="prev"><small class="hint">Loading earlier visits…</small></div>
    <form id="visitForm" novalidate>
      <label>Notes / diagnosis<textarea name="notes" rows="3" maxlength="3000">${esc(a.doctorNotes || '')}</textarea></label>
      <label>Prescription<textarea name="prescription" rows="5" maxlength="3000" placeholder="Tab. Name 5mg - 1+0+1 for 7 days">${esc(a.prescription || '')}</textarea></label>
      <div class="row-btns">
        <button type="button" class="secondary" data-close>Close</button>
        <button type="submit" class="primary">${a.status === 'completed' ? 'Save changes' : 'Complete visit'}</button>
      </div>
    </form>`);
  $('#visitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await D(`/appointments/${a.id}/complete`, 'POST', { notes: e.target.notes.value, prescription: e.target.prescription.value });
      closeModal(); toast(r.message); scheduleView();
    } catch (err) { modalError(err.message); }
  });
  try {
    const earlier = (await D(`/patients/${a.patientId}/history`)).filter((v) => v.id !== a.id);
    $('#prev').innerHTML = earlier.length
      ? `<details><summary>Earlier visits (${earlier.length})</summary>${earlier.map((v) => `
          <div class="rx"><strong>${fmtDate(v.date)}</strong>${v.notes ? `<br>${esc(v.notes)}` : ''}${v.prescription ? `<pre>${esc(v.prescription)}</pre>` : ''}</div>`).join('')}</details>`
      : '<small class="hint">No earlier visits with you.</small>';
  } catch { $('#prev').innerHTML = ''; }
}

// ================= HISTORY =================
async function historyView() {
  const list = await D('/history');
  apptIndex = {};
  view.innerHTML = `
    <h1>Visit History</h1>
    <div class="card"><input id="hFilter" placeholder="Filter by patient name" /></div>
    <div id="hlist" class="docs"></div>`;
  const show = () => {
    const q = $('#hFilter').value.trim().toLowerCase();
    const rows = list.filter((a) => a.patientName.toLowerCase().includes(q));
    $('#hlist').innerHTML = rows.length
      ? rows.map((a) => visitCard(a, true).replace(/(<h3>)\S+ · /, '$1' + esc(fmtDate(a.date)) + ' · ')).join('')
      : '<div class="card"><p>No completed visits yet.</p></div>';
  };
  $('#hFilter').addEventListener('input', show);
  show();
}

// ================= WORKPLACES =================
async function workplacesView() {
  const list = await D('/workplaces');
  window.WPS = Object.fromEntries(list.map((w) => [w.id, w]));
  view.innerHTML = `
    <div class="row-between"><h1>My Workplaces</h1><button class="primary-sm" data-wp="new">+ Add workplace</button></div>
    <p class="hint">Patients see these places, fees, days and times when they book. Changes do not move appointments that are already confirmed.</p>
    <div class="docs">${list.map((w) => `
      <article class="doc"><h3>${esc(w.name)}</h3><p>${esc(w.address)}</p>
        <p><strong>Fee:</strong> ৳${esc(w.fee)} · <strong>Days:</strong> ${esc(w.days.join(', '))}<br>
        <strong>Time:</strong> ${fmtTime(w.startTime)} – ${fmtTime(w.endTime)} · ${esc(w.slotMinutes)}-minute slots</p>
        <div class="row-btns"><button class="secondary" data-wp="${w.id}">Edit</button>
          <button class="danger-btn" data-wpdel="${w.id}">Delete</button></div></article>`).join('')}</div>`;
}

function workplaceModal(existing) {
  const isNew = !existing;
  const w = existing || { name: '', address: '', fee: '', days: [], startTime: '09:00', endTime: '13:00', slotMinutes: 20, lat: null, lon: null };
  const geo = { lat: w.lat, lon: w.lon };
  openModal(`
    <h2>${isNew ? 'Add workplace' : 'Edit workplace'}</h2>
    <form id="wpForm" novalidate>
      <label>Hospital / clinic name
        <div class="row"><input name="name" value="${esc(w.name)}" /><button type="button" class="secondary" id="findAddr">Find address</button></div></label>
      <label>Address (auto-filled, you can edit)<textarea name="address" rows="2">${esc(w.address)}</textarea><small id="geoStatus"></small></label>
      <label>Consultation fee (৳)<input name="fee" type="number" min="0" value="${esc(w.fee)}" /></label>
      <label>Slot length<select name="slotMinutes">${[10, 15, 20, 30, 45, 60].map((m) => `<option value="${m}" ${m === w.slotMinutes ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
      <label>Start time<input type="time" name="startTime" value="${esc(w.startTime)}" /></label>
      <label>End time<input type="time" name="endTime" value="${esc(w.endTime)}" /></label>
      <div><span class="lbl">Available days</span><div class="days">
        ${['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => `<label><input type="checkbox" value="${d}" ${w.days.includes(d) ? 'checked' : ''} />${d}</label>`).join('')}</div></div>
      <div class="row-btns">
        <button type="button" class="secondary" data-close>Close</button>
        <button type="submit" class="primary">${isNew ? 'Add workplace' : 'Save changes'}</button>
      </div>
    </form>`);
  const form = $('#wpForm');

  // Address lookup with OpenStreetMap (free, no key); runs only when the button is pressed
  $('#findAddr').addEventListener('click', async () => {
    const name = form.name.value.trim(), status = $('#geoStatus');
    if (!name) { status.textContent = 'Enter the hospital / clinic name first.'; return; }
    status.textContent = 'Searching…';
    try {
      const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(name));
      const found = await res.json();
      if (!found.length) { status.textContent = 'No match found. Type the address yourself.'; return; }
      form.address.value = found[0].display_name; geo.lat = found[0].lat; geo.lon = found[0].lon;
      status.textContent = 'Address found. Please check it is correct.';
    } catch { status.textContent = 'Search failed. Type the address yourself.'; }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: form.name.value, address: form.address.value, fee: form.fee.value, slotMinutes: form.slotMinutes.value,
      startTime: form.startTime.value, endTime: form.endTime.value, lat: geo.lat, lon: geo.lon,
      days: [...form.querySelectorAll('.days input:checked')].map((c) => c.value),
    };
    try {
      const r = isNew ? await D('/workplaces', 'POST', body) : await D('/workplaces/' + existing.id, 'PUT', body);
      closeModal(); toast(r.message); workplacesView();
    } catch (err) { modalError(err.message); }
  });
}

// ================= PROFILE =================
async function profileView() {
  const p = await D('/profile');
  view.innerHTML = `
    <h1>My Profile</h1>
    <div class="card"><div class="doc-head">
      ${p.photo ? `<img src="${esc(p.photo)}" alt="" />` : '<div class="avatar">🩺</div>'}
      <div><h2 style="margin:0">${esc(p.name)}</h2><p>${esc(p.speciality)} · ${esc(p.degree)}</p>
        <small>License ${esc(p.license)} · ${esc(p.email)}</small></div>${pill(p.status)}</div>
      <p class="hint">License, degree and speciality were verified by the admin. To change them, please contact the administration.</p></div>
    <form id="profileForm" class="card" novalidate>
      <h2>Contact details</h2>
      <div class="grid">
        <label>Personal phone<input name="phone" value="${esc(p.phone)}" /></label>
        <label>Clinical phone<input name="clinicalPhone" value="${esc(p.clinicalPhone)}" /></label>
        <label>Experience (years)<input name="experience" type="number" min="0" max="70" value="${esc(p.experience)}" /></label>
        <span></span>
        <label class="full">Address<textarea name="address" rows="2">${esc(p.address)}</textarea></label>
      </div>
      <button class="primary" type="submit">Save changes</button>
    </form>
    ${passwordCard()}`;
  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await D('/profile', 'PUT', { phone: f.phone.value, clinicalPhone: f.clinicalPhone.value, address: f.address.value, experience: f.experience.value });
      toast(r.message); profileView();
    } catch (err) { toast(err.message, 'error'); }
  });
  bindPasswordForm();
}

// ================= clicks =================
view.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-go],[data-day],[data-shift],[data-visit],[data-wp],[data-wpdel]');
  if (!t) return;
  const d = t.dataset;
  try {
    if (d.go) location.hash = '#' + d.go;
    else if (d.day) { schedDate = d.day; scheduleView(); }
    else if (d.shift) { schedDate = isoPlus(Number(d.shift), parseDate(schedDate)); scheduleView(); }
    else if (d.visit) visitModal(apptIndex[d.visit]);
    else if (d.wp) workplaceModal(d.wp === 'new' ? null : window.WPS[d.wp]);
    else if (d.wpdel) {
      if (!confirm('Delete this workplace?')) return;
      const r = await D('/workplaces/' + d.wpdel, 'DELETE'); toast(r.message); workplacesView();
    }
  } catch (err) { toast(err.message, 'error'); }
});

// ================= start =================
startPortal('doctor', { dashboard: dashboardView, schedule: scheduleView, history: historyView, workplaces: workplacesView, notifications: notificationsView, profile: profileView });