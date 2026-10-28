const nodemailer = require('nodemailer');

// Email is sent through any SMTP server (Gmail, Brevo, Mailtrap...). Settings live in .env
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const ROLE_LABEL = { patient: 'Patient', doctor: 'Doctor', admin: 'Hospital/Clinic Admin' };

/** Returns { sent: true } or { sent: false, dev: true } when SMTP is not configured. */
async function sendCredentials({ to, name, role, password }) {
  if (!transporter) {
    // Development fallback: no SMTP set up yet, so show the password in the SERVER console only.
    console.log(`\n[DEV MODE - email not configured]\n  To: ${to}\n  Password for ${name}: ${password}\n`);
    return { sent: false, dev: true };
  }

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Your MediBook account details',
    text:
`Hello ${name},

Your ${ROLE_LABEL[role]} account has been created.

Login email: ${to}
Temporary password: ${password}

You will be asked to change this password the first time you log in.
If you did not register, please ignore this email.

- MediBook`,
  });
  return { sent: true };
}

module.exports = { sendCredentials };
