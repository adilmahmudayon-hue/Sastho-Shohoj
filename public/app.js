// ---------- tab switching ----------
const tabs = document.querySelectorAll('.tab');
const forms = document.querySelectorAll('form');
const msg = document.getElementById('message');

tabs.forEach((tab) =>
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    forms.forEach((f) => (f.hidden = f.id !== tab.dataset.form));
    showMessage('');
  })
);

function showMessage(text, type = 'error') {
  msg.hidden = !text;
  msg.textContent = text;
  msg.className = 'message ' + type;
  if (text) window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- auto-calculate age from date of birth ----------
const patientForm = document.getElementById('patient');
patientForm.dob.addEventListener('change', () => {
  const dob = new Date(patientForm.dob.value);
  if (isNaN(dob)) return;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  patientForm.age.value = Math.max(age, 0);
});

// ---------- generic helpers ----------
function checkRequired(form) {
  let ok = true;
  form.querySelectorAll('input[required], select[required], textarea[required]').forEach((el) => {
    const bad = !el.value.trim();
    el.classList.toggle('invalid', bad);
    if (bad) ok = false;
  });
  return ok;
}

async function submitForm(form, url, bodyBuilder, isMultipart = false) {
  showMessage('');
  if (!checkRequired(form)) return showMessage('Please fill in all required fields.');

  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const body = bodyBuilder();
    const res = await fetch(url, {
      method: 'POST',
      headers: isMultipart ? {} : { 'Content-Type': 'application/json' },
      body: isMultipart ? body : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    showMessage(data.message, 'ok');
    form.reset();
    if (form.id === 'doctor') { wpContainer.innerHTML = ''; addWorkplace(); }
  } catch (err) {
    showMessage(err.message);
  } finally {
    btn.disabled = false;
  }
}

const formToObject = (form) => {
  const obj = Object.fromEntries(new FormData(form).entries());
  delete obj.confirm;
  return obj;
};

// ---------- patient + admin ----------
patientForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(patientForm, '/api/register/patient', () => formToObject(patientForm));
});

const adminForm = document.getElementById('admin');
adminForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(adminForm, '/api/register/admin', () => formToObject(adminForm));
});

// ---------- doctor: workplaces ----------
const doctorForm = document.getElementById('doctor');
const wpContainer = document.getElementById('workplaces');
const wpTpl = document.getElementById('workplaceTpl');

function renumber() {
  wpContainer.querySelectorAll('.workplace').forEach((w, i) => (w.querySelector('.num').textContent = i + 1));
}

function addWorkplace() {
  const node = wpTpl.content.firstElementChild.cloneNode(true);
  node.dataset.lat = '';
  node.dataset.lon = '';
  node.querySelector('.remove').addEventListener('click', () => {
    if (wpContainer.children.length > 1) { node.remove(); renumber(); }
    else showMessage('At least one workplace is required.');
  });
  node.querySelector('.find').addEventListener('click', () => findAddress(node));
  wpContainer.appendChild(node);
  renumber();
}

// Geocoding with OpenStreetMap Nominatim (free, no API key).
// Usage policy: max 1 request/second, so it only runs on button click.
async function findAddress(node) {
  const name = node.querySelector('.wp-name').value.trim();
  const status = node.querySelector('.geo-status');
  if (!name) { status.textContent = 'Enter the hospital / clinic name first.'; return; }
  status.textContent = 'Searching…';
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(name);
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const results = await res.json();
    if (!results.length) {
      status.textContent = 'No match found. Try adding the city, or type the address manually.';
      return;
    }
    const place = results[0];
    node.querySelector('.wp-address').value = place.display_name;
    node.dataset.lat = place.lat;
    node.dataset.lon = place.lon;
    status.textContent = 'Address found. Please check it is correct.';
  } catch {
    status.textContent = 'Search failed. You can type the address manually.';
  }
}

function collectWorkplaces() {
  return [...wpContainer.querySelectorAll('.workplace')].map((w) => ({
    name: w.querySelector('.wp-name').value.trim(),
    address: w.querySelector('.wp-address').value.trim(),
    lat: w.dataset.lat || null,
    lon: w.dataset.lon || null,
    fee: w.querySelector('.wp-fee').value,
    slotMinutes: w.querySelector('.wp-slot').value,
    startTime: w.querySelector('.wp-start').value,
    endTime: w.querySelector('.wp-end').value,
    days: [...w.querySelectorAll('.days input:checked')].map((c) => c.value),
  }));
}

document.getElementById('addWorkplace').addEventListener('click', addWorkplace);
addWorkplace();

doctorForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitForm(doctorForm, '/api/register/doctor', () => {
    const fd = new FormData(doctorForm);
    fd.delete('confirm');
    fd.append('workplaces', JSON.stringify(collectWorkplaces()));
    return fd;
  }, true);
});
