const crypto = require('crypto');

/**
 * Format: <FirstName><last 3 digits of phone>   e.g.  "Rahim" + "123"  ->  Rahim123
 * For admins (no phone number) the last 3 digits of the employee ID are used.
 * If fewer than 3 digits are available, the rest are filled with random digits.
 *
 * To change the format, edit only this function.
 */
function generatePassword(fullName, numberSource) {
  const TITLES = ['dr', 'mr', 'mrs', 'ms', 'md', 'mohd', 'prof'];
  const parts = String(fullName).trim().split(/\s+/);
  const firstPart = parts.find((w) => !TITLES.includes(w.toLowerCase().replace(/[^a-z]/g, ''))) || parts[0] || '';
  const first = firstPart
    .normalize('NFKD')
    .replace(/[^A-Za-z]/g, '')
    .toLowerCase();
  const base = first ? first[0].toUpperCase() + first.slice(1) : 'User';

  let digits = String(numberSource).replace(/\D/g, '').slice(-3);
  while (digits.length < 3) digits = crypto.randomInt(0, 10) + digits;

  return base + digits;
}

module.exports = { generatePassword };
