/**
 * PS3 Rental Manager — Backend Server (SQLite Version)
 * For Railway/Fly.io deployment
 * Database: SQLite (persistent file storage)
 */

const express = require('express');
const http    = require('http');
const ws      = require('ws');
const path    = require('path');
const cors    = require('cors');
const Database = require('better-sqlite3');

// ─── CONFIG ────────────────────────────────────────────────────
const PORT      = process.env.PORT || 3000;
const DB_PATH   = process.env.DB_PATH || path.join(__dirname, 'data', 'rental.db');
const FRONTEND  = path.join(__dirname, 'public');

// ─── INIT DATA DIR ─────────────────────────────────────────────
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ─── SQLITE SETUP ─────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  
  CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY,
    name TEXT,
    active INTEGER DEFAULT 0,
    startTime INTEGER,
    customer TEXT,
    duration INTEGER DEFAULT 0,
    note TEXT
  );
  
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unitId INTEGER,
    unitName TEXT,
    customer TEXT,
    duration INTEGER,
    rate INTEGER,
    total INTEGER,
    timestamp INTEGER,
    note TEXT
  );
  
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT,
    amount INTEGER,
    timestamp INTEGER
  );
`);

// Initialize default settings
const initSettings = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
initSettings.run('ratePerHour', '5000');
initSettings.run('warnBefore', '10');
initSettings.run('businessName', 'PS3 Rental');

// Initialize default units
const unitCount = db.prepare('SELECT COUNT(*) as count FROM units').get().count;
if (unitCount === 0) {
  const initUnits = db.prepare('INSERT INTO units (id, name, active, startTime, customer, duration, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
  initUnits.run(1, 'TV 1', 0, null, '', 0, '');
  initUnits.run(2, 'TV 2', 0, null, '', 0, '');
}

// ─── DB HELPERS ────────────────────────────────────────────────
function getDB() {
  const settings = {};
  db.prepare('SELECT * FROM settings').all().forEach(row => {
    settings[row.key] = row.key === 'ratePerHour' || row.key === 'warnBefore' 
      ? parseInt(row.value) 
      : row.value;
  });
  
  const units = db.prepare('SELECT * FROM units').all().map(u => ({
    ...u,
    active: !!u.active
  }));
  
  const transactions = db.prepare('SELECT * FROM transactions ORDER BY timestamp DESC').all();
  const expenses = db.prepare('SELECT * FROM expenses ORDER BY timestamp DESC').all();
  
  return { settings, units, transactions, expenses };
}

function saveSettings(settings) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  Object.entries(settings).forEach(([key, value]) => {
    stmt.run(key, String(value));
  });
}

function saveUnits(units) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO units (id, name, active, startTime, customer, duration, note) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  units.forEach(u => {
    stmt.run(u.id, u.name, u.active ? 1 : 0, u.startTime, u.customer, u.duration, u.note);
  });
}

function addUnit(unit) {
  const stmt = db.prepare(`
    INSERT INTO units (id, name, active, startTime, customer, duration, note) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(unit.id, unit.name, unit.active ? 1 : 0, unit.startTime, unit.customer, unit.duration, unit.note);
  return unit;
}

function addTransaction(tx) {
  const stmt = db.prepare(`
    INSERT INTO transactions (unitId, unitName, customer, duration, rate, total, timestamp, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(tx.unitId, tx.unitName, tx.customer, tx.duration, tx.rate, tx.total, tx.timestamp, tx.note || '');
  return { ...tx, id: result.lastInsertRowid };
}

function addExpense(expense) {
  const stmt = db.prepare(`
    INSERT INTO expenses (description, amount, timestamp)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(expense.description, expense.amount, expense.timestamp);
  return { ...expense, id: result.lastInsertRowid };
}

// ─── EXPRESS APP ───────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(FRONTEND));

// ── Health check ───────────────────────────────────────────────
app.get('/ping', (req, res) => {
  res.json({ ok: true, time: Date.now(), server: 'ps3-rental-sqlite' });
});

// ── GET full database ───────────────────────────────────────────
app.get('/api/db', (req, res) => {
  res.json(getDB());
});

// ── PUT settings ────────────────────────────────────────────────
app.put('/api/settings', (req, res) => {
  saveSettings(req.body);
  broadcast({ type: 'settings', data: req.body });
  res.json({ ok: true });
});

// ── GET / PUT units ─────────────────────────────────────────────
app.get('/api/units', (req, res) => {
  res.json(db.prepare('SELECT * FROM units').all().map(u => ({ ...u, active: !!u.active })));
});

app.put('/api/units', (req, res) => {
  saveUnits(req.body);
  broadcast({ type: 'units', data: req.body });
  res.json({ ok: true });
});

app.post('/api/units', (req, res) => {
  const unit = addUnit(req.body);
  broadcast({ type: 'units', data: db.prepare('SELECT * FROM units').all().map(u => ({ ...u, active: !!u.active })) });
  res.json({ ok: true, unit });
});

// ── Transactions ──────────────────────────────────────────────
app.get('/api/transactions', (req, res) => {
  res.json(db.prepare('SELECT * FROM transactions ORDER BY timestamp DESC').all());
});

app.post('/api/transactions', (req, res) => {
  const tx = addTransaction(req.body);
  broadcast({ type: 'transactions', data: db.prepare('SELECT * FROM transactions ORDER BY timestamp DESC').all() });
  res.json({ ok: true, transaction: tx });
});

// ── Expenses ───────────────────────────────────────────────────
app.get('/api/expenses', (req, res) => {
  res.json(db.prepare('SELECT * FROM expenses ORDER BY timestamp DESC').all());
});

app.post('/api/expenses', (req, res) => {
  const expense = addExpense(req.body);
  broadcast({ type: 'expenses', data: db.prepare('SELECT * FROM expenses ORDER BY timestamp DESC').all() });
  res.json({ ok: true, expense });
});

// ─── WEBSOCKET ────────────────────────────────────────────────
const wss = new ws.Server({ server, path: '/ws' });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === ws.OPEN) client.send(data);
  });
}

wss.on('connection', (socket, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Client connected: ${ip} (total: ${wss.clients.size})`);
  
  // Send full state to new client
  socket.send(JSON.stringify({ type: 'init', data: getDB() }));
  
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
    } catch(e) {}
  });
  
  socket.on('close', () => {
    console.log(`[WS] Client disconnect: ${ip} (total: ${wss.clients.size})`);
  });
});

// ─── START ───────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║     🎮  PS3 Rental Backend (SQLite)           ║');
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║  Port    : ${PORT}                                  ║`.substring(0, 50) + '║');
  ips.forEach(ip => {
    const line = `║  Network : http://${ip}:${PORT}`;
    console.log((line + ' '.repeat(50)).substring(0, 50) + '║');
  });
  console.log('║  Local   : http://localhost:' + PORT + '                   ║'.substring(0, 50) + '║');
  console.log('╚════════════════════════════════════════════════╝\n');
  console.log('  Database: ' + DB_PATH);
  console.log('  Ctrl+C to stop\n');
});
