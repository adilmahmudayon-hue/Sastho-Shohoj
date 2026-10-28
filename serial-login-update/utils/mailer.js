const nodemailer = require('nodemailer');

const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const ROLE_LABEL = { patient: 'Patient', doctor: 'Doctor', admin: 'Hospital/Clinic Admin' };

async function deliver({ to, subject, text, devNote }) {
  if (!transporter) {
    console.log(`\n[DEV MODE - email not configured]\n  To: ${to}\n  ${devNote}\n`);
    return { sent: false, dev: true };
  }
  await transporter.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
  return { sent: true };
}

/** Welcome email with the generated password. */
function sendCredentials({ to, name, role, password }) {
  return deliver({
    to,
    subject: 'Your Serial account details',
    devNote: `Password for ${name}: ${password}`,
    text:
`Hello ${name},

Your ${ROLE_LABEL[role]} account on Serial has been created.

Login email: ${to}
Temporary password: ${password}

You will be asked to change this password the first time you log in.
If you did not register, please ignore this email.

- Serial`,
  });
}

/** "Forgot password" email with a new temporary password. */
function sendPasswordReset({ to, name, password }) {
  return deliver({
    to,
    subject: 'Your Serial password was reset',
    devNote: `RESET password for ${name}: ${password}`,
    text:
`Hello ${name},

A password reset was requested for your Serial account.

New temporary password: ${password}

Log in with it and you will be asked to choose a new password.
If you did not request this, please contact support.

- Serial`,
  });
}

async function checkEmailSetup() {
  if (!transporter) {
    console.log('[EMAIL] DEV MODE: SMTP not configured. Passwords will only be printed here, NOT emailed.');
    console.log('[EMAIL] To fix: create a .env file (copy .env.example) and restart.');
    return;
  }
  try {
    await transporter.verify();
    console.log(`[EMAIL] OK: connected to SMTP as ${process.env.SMTP_USER}. Passwords will be emailed.`);
  } catch (e) {
    console.log('[EMAIL] FAILED to connect to SMTP: ' + e.message);
    console.log('[EMAIL] Check SMTP_USER / SMTP_PASS in .env (Gmail needs an App Password, not your normal password).');
  }
}

module.exports = { sendCredentials, sendPasswordReset, checkEmailSetup };
