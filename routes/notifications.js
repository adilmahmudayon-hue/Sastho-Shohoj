const express = require('express');
const db = require('../db');
const { requireAuth } = require('../utils/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/count', (req, res) => {
  res.json({ unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.auth.id).n });
});

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT id, title, message, is_read AS isRead, created_at AS createdAt
                       FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(req.auth.id));
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.auth.id);
  res.json({ message: 'All marked as read' });
});

router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.auth.id);
  res.json({ message: 'Marked as read' });
});

module.exports = router;