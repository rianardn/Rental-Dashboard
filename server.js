/**
 * PS3 Rental Manager — Production Backend for Railway
 * SQLite database, JWT auth, optimized for free tier
 */

const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

// ─── CONFIG ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'ps3rental.db');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Change this!

// ─── HELPERS ───────────────────────────────────────────────────
// Get current date in WIB timezone (UTC+7) for Indonesia
function getWIBDateISO() {
  const now = new Date();
  const wibTime = new Date(now.getTime() + (7 * 60 * 60 * 1000)); // Add 7 hours
  return wibTime.toISOString().split('T')[0];
}

// Get date N days ago in WIB timezone
function getWIBDateDaysAgo(days) {
  const now = new Date();
  const wibTime = new Date(now.getTime() + (7 * 60 * 60 * 1000) - (days * 24 * 60 * 60 * 1000));
  return wibTime.toISOString().split('T')[0];
}

// ─── INIT DATA DIR ─────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── SQLITE SETUP ──────────────────────────────────────────────
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 30000000000');

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active INTEGER DEFAULT 0,
    startTime INTEGER,
    customer TEXT,
    duration INTEGER DEFAULT 0,
    note TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    unitId INTEGER,
    unitName TEXT,
    customer TEXT,
    startTime INTEGER,
    endTime INTEGER,
    durationMin INTEGER,
    paid REAL,
    payment TEXT,
    note TEXT,
    date TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    item TEXT,
    amount REAL,
    date TEXT,
    note TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );
`);

// Insert default settings
const defaultSettings = {
  ratePerHour: 4000,
  warnBefore: 1,
  businessName: 'PS3 Rental',
  theme: 'ps3'
};

const settingsStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
Object.entries(defaultSettings).forEach(([key, value]) => {
  settingsStmt.run(key, JSON.stringify(value));
});

// Insert default units if none exist
const unitCount = db.prepare('SELECT COUNT(*) as count FROM units').get().count;
if (unitCount === 0) {
  const unitStmt = db.prepare('INSERT INTO units (name, active) VALUES (?, 0)');
  ['PS 1'].forEach(name => unitStmt.run(name));
}

// ─── HELPERS ───────────────────────────────────────────────────
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(row => {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  });
  return settings;
}

function updateSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password) {
  return crypto.createHmac('sha256', JWT_SECRET).update(password).digest('hex');
}

// ─── EXPRESS APP ─────────────────────────────────────────────
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired token' });
  
  req.user = session.user;
  next();
}

// ─── AUTH ROUTES ───────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  
  // Simple password check
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  const token = generateToken();
  db.prepare('INSERT INTO sessions (token, user) VALUES (?, ?)').run(token, 'admin');
  
  res.json({ token, user: 'admin' });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

app.get('/api/auth/verify', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// ─── DATA EXPORT/IMPORT ────────────────────────────────────────
app.get('/api/db', requireAuth, (req, res) => {
  const data = {
    settings: getSettings(),
    units: db.prepare('SELECT * FROM units ORDER BY id').all(),
    transactions: db.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all(),
    expenses: db.prepare('SELECT * FROM expenses ORDER BY created_at DESC').all()
  };
  res.json(data);
});

app.put('/api/db', requireAuth, (req, res) => {
  const { settings: newSettings, units: newUnits, transactions: newTx, expenses: newExp } = req.body;
  
  // Validate
  if (!newSettings || !Array.isArray(newUnits) || !Array.isArray(newTx)) {
    return res.status(400).json({ error: 'Invalid data format' });
  }
  
  // Transaction for atomic update
  const insertUnits = db.prepare('INSERT OR REPLACE INTO units (id, name, active, startTime, customer, duration, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertTx = db.prepare('INSERT OR REPLACE INTO transactions (id, unitId, unitName, customer, startTime, endTime, durationMin, paid, payment, note, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertExp = db.prepare('INSERT OR REPLACE INTO expenses (id, item, amount, date, note) VALUES (?, ?, ?, ?, ?)');
  
  db.transaction(() => {
    // Clear and re-insert
    db.prepare('DELETE FROM units').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM expenses').run();
    
    newUnits.forEach(u => insertUnits.run(u.id, u.name, u.active ? 1 : 0, u.startTime, u.customer, u.duration, u.note));
    newTx.forEach(t => insertTx.run(t.id, t.unitId, t.unitName, t.customer, t.startTime, t.endTime, t.durationMin, t.paid, t.payment, t.note, t.date));
    (newExp || []).forEach(e => insertExp.run(e.id, e.item, e.amount, e.date, e.note));
    
    // Update settings
    Object.entries(newSettings).forEach(([key, value]) => updateSetting(key, value));
  })();
  
  res.json({ 
    ok: true, 
    counts: {
      units: newUnits.length,
      transactions: newTx.length,
      expenses: (newExp || []).length
    }
  });
});

// ─── SETTINGS ────────────────────────────────────────────────
app.get('/api/settings', requireAuth, (req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', requireAuth, (req, res) => {
  Object.entries(req.body).forEach(([key, value]) => updateSetting(key, value));
  res.json({ ok: true, settings: getSettings() });
});

// ─── UNITS ───────────────────────────────────────────────────
app.get('/api/units', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM units ORDER BY id').all());
});

app.post('/api/units', requireAuth, (req, res) => {
  const { name } = req.body;
  const result = db.prepare('INSERT INTO units (name) VALUES (?)').run(name);
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ok: true, unit });
});

app.put('/api/units/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const { name } = req.body;
  db.prepare('UPDATE units SET name = ? WHERE id = ?').run(name, id);
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  res.json({ ok: true, unit });
});

app.delete('/api/units/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (unit?.active) return res.status(400).json({ error: 'Unit sedang aktif' });
  
  db.prepare('DELETE FROM units WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ─── SESSIONS (RENTAL OPERATIONS) ─────────────────────────────
app.post('/api/units/:id/start', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!unit) return res.status(404).json({ error: 'Unit tidak ditemukan' });
  if (unit.active) return res.status(400).json({ error: 'Unit sudah aktif' });
  
  const { customer = '', duration = 0, note = '' } = req.body;
  const startTime = Date.now();
  
  db.prepare('UPDATE units SET active = 1, startTime = ?, customer = ?, duration = ?, note = ? WHERE id = ?')
    .run(startTime, customer, duration, note, id);
  
  res.json({ ok: true, unit: db.prepare('SELECT * FROM units WHERE id = ?').get(id) });
});

app.post('/api/units/:id/stop', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!unit) return res.status(404).json({ error: 'Unit tidak ditemukan' });
  if (!unit.active) return res.status(400).json({ error: 'Unit tidak aktif' });
  
  const settings = getSettings();
  const elMin = Math.floor((Date.now() - unit.startTime) / 60000);
  const cost = Math.round((elMin / 60) * settings.ratePerHour);
  const { paid = cost, payment = 'cash' } = req.body;
  
  const dateKey = getWIBDateISO(); // Use WIB timezone (UTC+7) for Indonesia
  
  const tx = {
    id: Date.now().toString(36),
    unitId: unit.id,
    unitName: unit.name,
    customer: unit.customer,
    startTime: unit.startTime,
    endTime: Date.now(),
    durationMin: elMin,
    paid: paid,
    payment: payment,
    note: unit.note,
    date: dateKey
  };
  
  db.prepare(`INSERT INTO transactions 
    (id, unitId, unitName, customer, startTime, endTime, durationMin, paid, payment, note, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(tx.id, tx.unitId, tx.unitName, tx.customer, tx.startTime, tx.endTime, tx.durationMin, tx.paid, tx.payment, tx.note, tx.date);
  
  db.prepare("UPDATE units SET active = 0, startTime = NULL, customer = '', duration = 0, note = '' WHERE id = ?").run(id);
  
  res.json({ ok: true, tx });
});

// ─── TRANSACTIONS ─────────────────────────────────────────────
app.get('/api/transactions', requireAuth, (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const transactions = db.prepare('SELECT * FROM transactions ORDER BY endTime DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json(transactions);
});

app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/transactions/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  
  const updates = req.body;
  const fields = Object.keys(updates).filter(k => k !== 'id');
  if (fields.length > 0) {
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    db.prepare(`UPDATE transactions SET ${setClause} WHERE id = ?`).run(...values, id);
  }
  
  res.json({ ok: true, tx: db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) });
});

// ─── EXPENSES ─────────────────────────────────────────────────
app.get('/api/expenses', requireAuth, (req, res) => {
  const { limit = 100 } = req.query;
  res.json(db.prepare('SELECT * FROM expenses ORDER BY created_at DESC LIMIT ?').all(limit));
});

app.post('/api/expenses', requireAuth, (req, res) => {
  const exp = { id: Date.now().toString(36), ...req.body };
  db.prepare('INSERT INTO expenses (id, item, amount, date, note) VALUES (?, ?, ?, ?, ?)')
    .run(exp.id, exp.item, exp.amount, exp.date, exp.note);
  res.json({ ok: true, exp });
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── REPORTS ─────────────────────────────────────────────────
app.get('/api/reports/summary', requireAuth, (req, res) => {
  const { period = 'today' } = req.query;
  let startDate, endDate;
  
  // Use WIB timezone (UTC+7) for Indonesia
  switch(period) {
    case 'today':
      startDate = getWIBDateISO();
      endDate = startDate;
      break;
    case 'week':
      startDate = getWIBDateDaysAgo(7);
      endDate = getWIBDateISO();
      break;
    case 'month':
      const wibNow = new Date(new Date().getTime() + (7 * 60 * 60 * 1000));
      startDate = `${wibNow.toISOString().split('T')[0].slice(0, 7)}-01`; // First day of month
      endDate = getWIBDateISO();
      break;
    case 'year':
      const wibYear = new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).getFullYear();
      startDate = `${wibYear}-01-01`;
      endDate = `${wibYear}-12-31`;
      break;
    default:
      startDate = '1970-01-01';
      endDate = '2099-12-31';
  }
  
  const income = db.prepare(`
    SELECT COALESCE(SUM(paid), 0) as total, COUNT(*) as count 
    FROM transactions 
    WHERE date BETWEEN ? AND ?
  `).get(startDate, endDate);
  
  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count 
    FROM expenses 
    WHERE date BETWEEN ? AND ?
  `).get(startDate, endDate);
  
  res.json({
    period,
    income: { total: income.total, count: income.count },
    expenses: { total: expenses.total, count: expenses.count },
    profit: income.total - expenses.total
  });
});

// ─── ERROR HANDLING MIDDLEWARE ───────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────
app.get('/ping', (req, res) => {
  res.json({ 
    ok: true, 
    time: Date.now(), 
    server: 'ps3-rental-backend',
    db: 'sqlite',
    version: '2.0.0'
  });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ─── START ───────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  🎮  PS3 Rental Manager - Railway Production     ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Port: ${PORT}${' '.repeat(46 - PORT.toString().length)}║`);
  console.log(`║  DB:   ${DB_FILE.split('/').pop()}${' '.repeat(46 - DB_FILE.split('/').pop().length)}║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
});
