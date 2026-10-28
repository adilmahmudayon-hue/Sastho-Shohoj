require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/register', require('./routes/register'));

// Generic error handler (e.g. multer file errors)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong' });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
