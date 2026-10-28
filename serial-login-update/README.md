# Serial – Doctor Appointment System

Digitalising manual doctor appointments.

## Run locally
```bash
npm install
npm start
```
Copy `.env.example` to `.env` and fill it in (email + JWT secret). Open http://localhost:3000

## Stack
Node.js · Express · SQLite (better-sqlite3) · bcryptjs · JWT cookies · nodemailer · vanilla HTML/CSS/JS

## Roadmap
- [x] Registration (patient, doctor, admin) with generated passwords sent by email
- [x] Login, forced password change, forgot password
- [ ] Role-based menus
- [ ] Admin approval of doctors
- [ ] Doctor search & appointment booking
