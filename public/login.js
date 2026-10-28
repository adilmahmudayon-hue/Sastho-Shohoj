const tabs = document.querySelectorAll('.tab');
const loginForm = document.getElementById('loginForm');
const forgotForm = document.getElementById('forgotForm');
const msg = document.getElementById('message');
const LABEL = { patient: 'Patient', doctor: 'Doctor', admin: 'Hospital / Clinic Admin' };
let role = 'patient';

function showMessage(text, type = 'error') {
  msg.hidden = !text;
  msg.textContent = text;
  msg.className = 'message ' + type;
}

// Already logged in? Skip the login page.
fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((me) => {
  if (me) location.href = me.mustChangePassword ? '/change-password.html' : '/dashboard.html';
});

tabs.forEach((tab) =>
  tab.addEventListener('click', () => {
    role = tab.dataset.role;
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    document.getElementById('loginTitle').textContent = LABEL[role] + ' login';
    showMessage('');
  })
);

document.getElementById('forgotLink').addEventListener('click', (e) => {
  e.preventDefault(); loginForm.hidden = true; forgotForm.hidden = false; showMessage('');
});
document.getElementById('backLink').addEventListener('click', (e) => {
  e.preventDefault(); forgotForm.hidden = true; loginForm.hidden = false; showMessage('');
});

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage('');
  const btn = loginForm.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const data = await post('/api/auth/login', {
      email: loginForm.email.value, password: loginForm.password.value, role,
    });
    location.href = data.mustChangePassword ? '/change-password.html' : '/dashboard.html';
  } catch (err) {
    showMessage(err.message);
  } finally {
    btn.disabled = false;
  }
});

forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage('');
  const btn = forgotForm.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const data = await post('/api/auth/forgot-password', { email: forgotForm.email.value });
    showMessage(data.message, 'ok');
  } catch (err) {
    showMessage(err.message);
  } finally {
    btn.disabled = false;
  }
});