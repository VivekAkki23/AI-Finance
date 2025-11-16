// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const validator = require('validator');
const dns = require('dns').promises;
const crypto = require('crypto');
const logger = require('./logger'); // ✅ Added logger
const app = express();

// ---------- Sessions ----------
app.use(session({
  secret: 'super-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));

// ---------- Static & Body Parsing ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------- SQLite connection ----------
const sqlite = require('./database'); // your database.js connects to data.db

// ---------- Email / Validation Utils ----------
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com',
  'tempmail.io', 'yopmail.com'
]);

function isAllowedEmail(email) {
  if (!email) return false;
  const allowOnlyGmail = process.env.ALLOW_ONLY_GMAIL === '1';
  if (!allowOnlyGmail) return true;
  return /^[^@\s]+@gmail\.com$/i.test(String(email).trim());
}

async function hasMX(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

async function validateEmailServerSide(email) {
  const SKIP_MX = process.env.SKIP_MX === '1';
  if (!validator.isEmail(email || '')) return { ok: false, reason: 'format' };

  const domain = String(email.split('@')[1] || '').toLowerCase();
  if (DISPOSABLE.has(domain)) return { ok: false, reason: 'disposable' };

  if (SKIP_MX) return { ok: true };
  if (!(await hasMX(domain))) return { ok: false, reason: 'mx' };
  return { ok: true };
}

// ---------- Mailer ----------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// ---------- ROUTES ----------

// Default route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* =========================
   SIGNUP: save user + verify
   ========================= */
app.post('/signup', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const passwordPlain = req.body.password || '';
    const passwordConfirm = req.body.password_confirm || '';

    if (!name || !email || !passwordPlain || !passwordConfirm)
      return res.redirect('/signup.html?error=' + encodeURIComponent('Please fill out all fields.'));
    if (passwordPlain.length < 8)
      return res.redirect('/signup.html?error=' + encodeURIComponent('Password must be at least 8 characters.'));
    if (passwordPlain !== passwordConfirm)
      return res.redirect('/signup.html?error=' + encodeURIComponent('Passwords do not match.'));
    if (!isAllowedEmail(email))
      return res.redirect('/signup.html?error=' + encodeURIComponent('Only Gmail addresses are allowed.'));

    const chk = await validateEmailServerSide(email);
    if (!chk.ok)
      return res.redirect('/signup.html?error=' + encodeURIComponent('Invalid or disposable email.'));

    // Check for existing email
    sqlite.get('SELECT id FROM users WHERE email = ?', [email], async (selErr, row) => {
      if (selErr) {
        console.error('SQLite select failed:', selErr);
        return res.redirect('/signup.html?error=' + encodeURIComponent('Server error.'));
      }
      if (row)
        return res.redirect('/signup.html?error=' + encodeURIComponent('Email already registered.'));

      const password_hash = bcrypt.hashSync(passwordPlain, 10);
      const token = crypto.randomBytes(32).toString('hex');
      const expires = Date.now() + 1000 * 60 * 30;

      sqlite.run(
        `INSERT INTO users (name, email, password_hash, verified, verification_token, verification_expires)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [name, email, password_hash, token, expires],
        async function (insErr) {
          if (insErr) {
            console.error('SQLite insert failed:', insErr);
            return res.redirect('/signup.html?error=' + encodeURIComponent('Server error.'));
          }

          const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify?token=${token}`;
          try {
            await transporter.sendMail({
              from: process.env.SMTP_FROM || 'no-reply@yourapp.com',
              to: email,
              subject: 'Verify your email',
              html: `<p>Hi ${name},</p>
                     <p>Please verify your email to activate your account:</p>
                     <p><a href="${verifyUrl}">Verify Email</a></p>`
            });

            logger.info(`New signup: ${email}`); // ✅ log signup event
          } catch (mailErr) {
            console.error('Mail send failed:', mailErr);
            return res.redirect('/signup.html?error=' + encodeURIComponent('Failed to send email.'));
          }

          return res.redirect('/check-email.html');
        }
      );
    });
  } catch (e) {
    console.error('SIGNUP FLOW ERROR:', e);
    return res.redirect('/signup.html?error=' + encodeURIComponent('Server error.'));
  }
});

/* =========================
   VERIFY EMAIL
   ========================= */
app.get('/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/index.html?error=invalid_link');

  sqlite.get(
    'SELECT id, verification_expires, verified FROM users WHERE verification_token = ?',
    [token],
    (err, row) => {
      if (err) {
        console.error('VERIFY SELECT ERROR:', err);
        return res.redirect('/index.html?error=db_error');
      }
      if (!row) return res.redirect('/index.html?error=invalid_token');
      if (row.verified) return res.redirect('/verified.html?status=already');
      if (Date.now() > Number(row.verification_expires))
        return res.redirect('/index.html?error=expired_link');

      sqlite.run(
        'UPDATE users SET verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?',
        [row.id],
        (uErr) => {
          if (uErr) {
            console.error('VERIFY UPDATE ERROR:', uErr);
            return res.redirect('/index.html?error=server');
          }
          logger.info(`Email verified for user ID: ${row.id}`); // ✅ log verification
          return res.redirect('/verified.html?status=ok');
        }
      );
    }
  );
});

/* =========================
   LOGIN (works with SQLite)
   ========================= */
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  console.log('🔹 Login request received:', email);

  sqlite.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      console.error('❌ Database error:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    bcrypt.compare(password, user.password_hash, (err, result) => {
      if (err) {
        console.error('❌ Bcrypt error:', err);
        return res.status(500).json({ message: 'Password check failed' });
      }

      if (!result) {
        return res.status(400).json({ message: 'Invalid password' });
      }

      // Save session
      req.session.user = { id: user.id, name: user.name, email: user.email };
      logger.info(`User logged in: ${email}`); // ✅ log login
      console.log('✅ Login success for:', email);

      res.json({ message: 'Login successful', user });
    });
  });
});

// ---------- Protected Dashboard ----------
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/index.html?error=auth');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ---------- Account ----------
app.get('/account', (req, res) => {
  if (!req.session.user) return res.redirect('/index.html?error=auth');
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});

// ---------- Get Logged-in User Info ----------
app.get('/api/user', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  res.json(req.session.user);
});


// ---------- Open Excel ----------
app.get('/open-excel', (req, res) => {
  exec('start excel.exe', (err) => {
    if (err) {
      console.error('⚠ Could not open Excel:', err);
      return res.status(500).send('⚠ Could not open Excel. Make sure Microsoft Excel is installed.');
    }
    logger.info(`Excel exported by: ${req.session.user?.email || 'Unknown user'}`); // ✅ log excel event
    console.log('✅ Excel app opened successfully.');
    res.send('✅ Excel app opened successfully.');
  });
});

// ---------- Debug Users ----------
app.get('/debug/users', (req, res) => {
  sqlite.all("SELECT id, name, email, verified FROM users ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).send('Read failed');
    res.json(rows);
  });
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).send('<h1>404 - Page Not Found</h1>');
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
