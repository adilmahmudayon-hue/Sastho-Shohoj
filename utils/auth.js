const jwt = require('jsonwebtoken');
const crypto = require('crypto');

let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.log('[AUTH] JWT_SECRET is missing in .env, using a temporary one. Everyone is logged out whenever the server restarts.');
}

const COOKIE = 'serial_token';

function issue(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '8h' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

const clear = (res) => res.clearCookie(COOKIE);

function requireAuth(req, res, next) {
  try {
    req.auth = jwt.verify(req.cookies[COOKIE], SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Please log in' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.auth.role) ? next() : res.status(403).json({ error: 'Not allowed' });

module.exports = { issue, clear, requireAuth, requireRole };