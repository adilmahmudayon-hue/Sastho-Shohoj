// ================= ADMIN PORTAL =================
const A = (url, method, body) => request('/api/admin' + url, method, body);
const isSuper = () => window.ME && window.ME.adminRole === 'Super Admin';

let reqTab = 'requested';     // requests: requested | confirmed | history
let docTab = 'pending';       // doctors: pending | approved | rejected
let reqIndex = {};

// ================= DASHBOARD =================
async function dashboardView() {
  const d = await A('/dashboard');
  const stat = (n, label, go) => `<div class="stat ${go ? 'link' : ''}" ${go ? `data-go="${go}"` : ''}><b>${n}</b><span>${label}</span></div>`;
  const oldest = d.oldest.map((a) => `
    <div class="appt-mini"><div><strong>${esc(a.patientName)}</strong> → ${esc(a.doctorName)} · ${esc(a.speciality)}<br>
      <small>Prefers ${fmtDate(a.preferredDate)} at ${fmtTime(a.preferredTime)} · ${esc(a.workplaceName)}</small></div>
      <button class="secondary" data-go="requests:requested">Review</button></div>`).join('')
    || '<p class="hint">No requests are waiting. 🎉</p>';
  view.innerHTML = `
    <h1>Dashboard</h1>
    <div class="stats">
      ${stat(d.waiting, 'Requests waiting', 'requests:requested')}
      ${stat(d.today, "Today's appointments", 'requests:confirmed')}
      ${stat(d.pendingDoctors, 'Doctors to verify', 'doctors')}
      ${d.isSuper ? stat(d.pendingAdmins, 'Admins to approve', 'admins') : ''}
      ${stat(d.patients, 'Patients', 'patients')}
      ${stat(d.doctors, 'Approved doctors', 'doctors')}
    </div>
    <div class="card"><h2>Oldest waiting requests</h2>${oldest}</div>`;
}

// ================= APPOINTMENT REQUESTS =================
function reqCard(a) {
  reqIndex[a.id] = a;
  const when = a.status === 'confirmed'
    ? `<p><strong>Scheduled:</strong> ${fmtDate(a.scheduledDate)} at ${fmtTime(a.scheduledTime)}</p>`
    : '';
  const buttons = a.status === 'requested'
    ? `<button class="primary-sm" data-sched="${a.id}">Confirm &amp; set time</button><button class="danger-btn" data-reject="${a.id}">Reject</button>`
    : a.status === 'confirmed'
      ? `<button class="secondary" data-sched="${a.id}">Change time</button><button class="danger-btn" data-cancel="${a.id}">Cancel appointment</button>`
      : '';
  return `<article class="doc">
    <div class="doc-head"><div class="avatar">👤</div>
      <div><h3>${esc(a.patientName)}</h3><p>${esc(a.patientAge)} yrs · ${esc(a.patientGender)} · ${esc(a.patientPhone)}</p>
        <small>Request #${a.id} · sent ${fmtStamp(a.createdAt)}</small></div>
      ${pill(a.status)}</div>
    <p><strong>${esc(a.doctorName)}</strong> · ${esc(a.speciality)}<br>
      <small>${esc(a.workplaceName)} · ${esc(a.workplaceAddress)} · Fee ৳${esc(a.fee)} · ${esc(a.type)}</small></p>
    <p><strong>Patient prefers:</strong> ${fmtDate(a.preferredDate)} at ${fmtTime(a.preferredTime)}</p>
    ${when}
    ${a.previousSchedule ? `<p class="hint">Previous time: ${esc(a.previousSchedule)}</p>` : ''}
    ${a.reason ? `<p><strong>Reason:</strong> ${esc(a.reason)}</p>` : ''}
    ${a.adminNote ? `<p><strong>Note:</strong> ${esc(a.adminNote)}</p>` : ''}
    ${a.status === 'cancelled' ? `<p class="hint">Cancelled by ${esc(a.cancelledBy || 'the clinic')}.</p>` : ''}
    ${buttons ? `<div class="row-btns">${buttons}</div>` : ''}</article>`;
}

async function requestsView() {
  const d = await A('/appointments?tab=' + reqTab);
  reqIndex = {};
  const tab = (key, label) => `<button class="tab ${reqTab === key ? 'active' : ''}" data-rtab="${key}">${label} (${d.counts[key]})</button>`;
  view.innerHTML = `
    <h1>Appointment Requests</h1>
    <div class="tabs">${tab('requested', 'Waiting')}${tab('confirmed', 'Confirmed')}${tab('history', 'History')}</div>
    <div class="docs">${d.items.length ? d.items.map(reqCard).join('') : '<div class="card"><p>Nothing here.</p></div>'}</div>`;
}

// Confirm a request, or change the time of a confirmed appointment
async function loadSlots(form, a, wantedTime) {
  const box = $('.slots', form), date = form.date.value;
  if (!date) { box.innerHTML = '<small>Choose a date to see the time slots.</small>'; return; }
  box.innerHTML = '<small>Loading…</small>';
  try {
    const d = await A(`/slots?workplaceId=${a.workplaceId}&date=${date}&excludeId=${a.id}`);
    if (!d.available) { box.innerHTML = `<small class="err">The doctor does not sit on this day. Available days: ${esc(d.days.join(', '))}</small>`; return; }
    box.innerHTML = d.slots.map((s) => `<label class="slot ${s.taken ? 'taken' : ''}">
      <input type="radio" name="slot" value="${s.time}" ${s.taken ? 'disabled' : ''} ${s.time === wantedTime && !s.taken ? 'checked' : ''} />${fmtTime(s.time)}</label>`).join('')
      || '<small>No slots on this day.</small>';
  } catch (err) { box.innerHTML = `<small class="err">${esc(err.message)}</small>`; }
}

function scheduleModal(a) {
  const editing = a.status === 'confirmed';
  const startDate = editing ? a.scheduledDate : a.preferredDate;
  const startTime = editing ? a.scheduledTime : a.preferredTime;
  openModal(`
    <h2>${editing ? 'Change time' : 'Confirm appointment'}</h2>
    <p><strong>${esc(a.patientName)}</strong> with <strong>${esc(a.doctorName)}</strong><br>
      <small>${esc(a.workplaceName)} · patient prefers ${fmtDate(a.preferredDate)} at ${fmtTime(a.preferredTime)}</small></p>
    <p class="hint">Doctor sits on the days shown in the slot list. Greyed slots are already booked.</p>
    <form id="schedForm" novalidate>
      <label>Date<input type="date" name="date" min="${isoToday()}" value="${startDate >= isoToday() ? startDate : ''}" required /></label>
      <div class="slots"></div>
      <label>Note to the patient (optional)<textarea name="note" rows="2" maxlength="500" placeholder="e.g. Please bring your old reports"></textarea></label>
      <div class="row-btns">
        <button type="button" class="secondary" data-close>Close</button>
        <button type="submit" class="primary">${editing ? 'Save new time' : 'Confirm'}</button>
      </div>
    </form>`);
  const form = $('#schedForm');
  loadSlots(form, a, startTime);
  form.date.addEventListener('change', () => loadSlots(form, a, ''));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slot = $('input[name=slot]:checked', form);
    if (!form.date.value || !slot) return modalError('Please choose a date and a free time slot.');
    try {
      const r = await A(`/appointments/${a.id}/confirm`, 'POST', { date: form.date.value, time: slot.value, note: form.note.value });
      closeModal(); toast(r.message); requestsView();
    } catch (err) { modalError(err.message); }
  });
}

// ================= DOCTORS =================
function adminDoctorCard(d) {
  const photo = d.photo ? `<img src="${esc(d.photo)}" alt="" />` : '<div class="avatar">🩺</div>';
  const places = d.workplaces.map((w) => `<li>${esc(w.name)} · ৳${esc(w.fee)} · ${esc(w.days.join(', '))} · ${fmtTime(w.startTime)}–${fmtTime(w.endTime)}</li>`).join('');
  const buttons = isSuper()
    ? (d.status !== 'approved' ? `<button class="primary-sm" data-docact="approve:${d.id}">Approve</button>` : '')
      + (d.status !== 'rejected' ? `<button class="danger-btn" data-docact="reject:${d.id}">${d.status === 'approved' ? 'Suspend' : 'Reject'}</button>` : '')
    : '';
  return `<article class="doc">
    <div class="doc-head">${photo}
      <div><h3>${esc(d.name)}</h3><p>${esc(d.speciality)} · ${esc(d.degree)}</p><small>${esc(d.experience)} years of experience</small></div>
      ${pill(d.status)}</div>
    <p><strong>Medical license:</strong> ${esc(d.license)}<br>
      <strong>Email:</strong> ${esc(d.email)}<br>
      <strong>Phones:</strong> ${esc(d.phone)} (personal) · ${esc(d.clinicalPhone)} (clinical)<br>
      <strong>Address:</strong> ${esc(d.address)}</p>
    <strong>Workplaces</strong><ul>${places}</ul>
    ${buttons ? `<div class="row-btns">${buttons}</div>` : '<p class="hint">Only a Super Admin can approve or reject doctors.</p>'}</article>`;
}

async function doctorsView() {
  const list = await A('/doctors?status=' + docTab);
  const tab = (key, label) => `<button class="tab ${docTab === key ? 'active' : ''}" data-dtab="${key}">${label}</button>`;
  view.innerHTML = `
    <h1>Doctors</h1>
    <div class="tabs">${tab('pending', 'To verify')}${tab('approved', 'Approved')}${tab('rejected', 'Rejected')}</div>
    <div class="docs">${list.length ? list.map(adminDoctorCard).join('') : '<div class="card"><p>No doctors in this list.</p></div>'}</div>`;
}

// ================= PATIENTS =================
async function patientsView() {
  view.innerHTML = `
    <h1>Patients</h1>
    <form id="pSearch" class="card row"><input name="q" placeholder="Search by name, email or phone" />
      <button class="primary" style="margin:0;width:auto;padding:10px 20px">Search</button></form>
    <div id="plist" class="docs"></div>`;
  const load = async () => {
    const list = await A('/patients?q=' + encodeURIComponent($('#pSearch').q.value));
    $('#plist').innerHTML = list.length ? list.map((p) => `
      <article class="doc"><div class="doc-head"><div class="avatar">👤</div>
        <div><h3>${esc(p.name)}</h3><p>${esc(p.age)} yrs · ${esc(p.gender)} · ${esc(p.phone)}</p><small>${esc(p.email)}</small></div>
        <span class="pill done">${p.appointments} appointment(s)</span></div>
        <p><small>Emergency: ${esc(p.emergencyPhone)} · ${esc(p.address)}</small></p></article>`).join('')
      : '<div class="card"><p>No patients found.</p></div>';
  };
  $('#pSearch').addEventListener('submit', (e) => { e.preventDefault(); load().catch((err) => toast(err.message, 'error')); });
  await load();
}

// ================= ADMINS (Super Admin only) =================
async function adminsView() {
  if (!isSuper()) { view.innerHTML = '<div class="message error">Only a Super Admin can see this page.</div>'; return; }
  const list = await A('/admins');
  view.innerHTML = `<h1>Admins</h1><div class="docs">${list.map((a) => `
    <article class="doc"><div class="doc-head"><div class="avatar">🛡️</div>
      <div><h3>${esc(a.name)} ${a.isMe ? '<small>(you)</small>' : ''}</h3><p>${esc(a.adminRole)} · ID ${esc(a.employeeId)}</p><small>${esc(a.email)}</small></div>
      ${pill(a.status)}</div>
      ${a.isMe ? '' : `<div class="row-btns">
        ${a.status !== 'approved' ? `<button class="primary-sm" data-adminact="approve:${a.id}">Approve</button>` : ''}
        ${a.status !== 'rejected' ? `<button class="danger-btn" data-adminact="reject:${a.id}">${a.status === 'approved' ? 'Remove access' : 'Reject'}</button>` : ''}</div>`}
    </article>`).join('')}</div>`;
}

// ================= PROFILE =================
async function profileView() {
  const p = await A('/profile');
  view.innerHTML = `
    <h1>My Profile</h1>
    <div class="card"><h2>${esc(p.name)}</h2>
      <p><strong>Email:</strong> ${esc(p.email)}<br><strong>Employee ID:</strong> ${esc(p.employeeId)}<br>
      <strong>Role:</strong> ${esc(p.adminRole)} ${pill(p.status)}</p></div>
    ${passwordCard()}`;
  bindPasswordForm();
}

// ================= clicks =================
view.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-go],[data-rtab],[data-dtab],[data-sched],[data-reject],[data-cancel],[data-docact],[data-adminact]');
  if (!t) return;
  const d = t.dataset;
  try {
    if (d.go) {
      const [page, tab] = d.go.split(':');
      if (tab) reqTab = tab;
      location.hash = '#' + page;
    } else if (d.rtab) { reqTab = d.rtab; requestsView(); }
    else if (d.dtab) { docTab = d.dtab; doctorsView(); }
    else if (d.sched) scheduleModal(reqIndex[d.sched]);
    else if (d.reject) {
      noteModal({ title: 'Reject request', label: 'Reason for the patient (optional)', button: 'Reject request',
        onSubmit: async (note) => { const r = await A(`/appointments/${d.reject}/reject`, 'POST', { note }); toast(r.message); requestsView(); } });
    } else if (d.cancel) {
      noteModal({ title: 'Cancel appointment', label: 'Reason for the patient (optional)', button: 'Cancel appointment',
        onSubmit: async (note) => { const r = await A(`/appointments/${d.cancel}/cancel`, 'POST', { note }); toast(r.message); requestsView(); } });
    } else if (d.docact) {
      const [act, id] = d.docact.split(':');
      if (act === 'approve') {
        if (!confirm('Approve this doctor? Patients will be able to find and book them.')) return;
        const r = await A(`/doctors/${id}/approve`, 'POST', {}); toast(r.message); doctorsView();
      } else {
        noteModal({ title: 'Reject doctor', label: 'Reason (the doctor will see this)', button: 'Reject',
          onSubmit: async (note) => { const r = await A(`/doctors/${id}/reject`, 'POST', { note }); toast(r.message); doctorsView(); } });
      }
    } else if (d.adminact) {
      const [act, id] = d.adminact.split(':');
      if (!confirm(act === 'approve' ? 'Approve this admin?' : 'Remove this admin\'s access?')) return;
      const r = await A(`/admins/${id}/${act}`, 'POST', {}); toast(r.message); adminsView();
    }
  } catch (err) { toast(err.message, 'error'); }
});

// ================= start =================
startPortal('admin', { dashboard: dashboardView, requests: requestsView, doctors: doctorsView, patients: patientsView, admins: adminsView, notifications: notificationsView, profile: profileView },
  (me) => {
    if (me.adminRole !== 'Super Admin') $('#navAdmins').hidden = true;
    if (me.status !== 'approved') {
      $('#nav').hidden = true;
      view.innerHTML = `<div class="card"><h2>${me.status === 'rejected' ? 'Account not approved' : 'Waiting for approval'}</h2>
        <p>${me.status === 'rejected' ? 'A Super Admin did not approve this account. Please contact your clinic.'
          : 'Your admin account has been created. A Super Admin must approve it before you can manage appointments. Please check back soon.'}</p></div>`;
      return false;
    }
  });