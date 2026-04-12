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

// Generate sequential transaction ID (PSMxxxxx for revenue)
function generateRevenueId() {
  const prefix = 'PSM';
  const stmt = db.prepare('INSERT INTO id_counters (prefix, last_number) VALUES (?, 1) ON CONFLICT(prefix) DO UPDATE SET last_number = last_number + 1 RETURNING last_number');
  const result = stmt.get(prefix);
  const seq = result.last_number;
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// Generate sequential expense ID (PSKxxxxx for expenses)
function generateExpenseId() {
  const prefix = 'PSK';
  const stmt = db.prepare('INSERT INTO id_counters (prefix, last_number) VALUES (?, 1) ON CONFLICT(prefix) DO UPDATE SET last_number = last_number + 1 RETURNING last_number');
  const result = stmt.get(prefix);
  const seq = result.last_number;
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// Generate sequential schedule ID (PSJxxxxx for schedules/jadwal)
function generateScheduleId() {
  const prefix = 'PSJ';
  const stmt = db.prepare('INSERT INTO id_counters (prefix, last_number) VALUES (?, 1) ON CONFLICT(prefix) DO UPDATE SET last_number = last_number + 1 RETURNING last_number');
  const result = stmt.get(prefix);
  const seq = result.last_number;
  return `${prefix}${String(seq).padStart(5, '0')}`;
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
db.pragma('mmap_size = 20971520');  // 20MB - safe for 256MB VM

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
    linkedScheduleId INTEGER,
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
    category TEXT,
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

  -- Counter table for sequential transaction IDs
  CREATE TABLE IF NOT EXISTS id_counters (
    prefix TEXT PRIMARY KEY,
    last_number INTEGER DEFAULT 0
  );

  -- Migration: Create edit_logs table for audit trail (supports both transactions and expenses)
  CREATE TABLE IF NOT EXISTS edit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transactionId TEXT,
    expenseId TEXT,
    fieldName TEXT NOT NULL,
    oldValue TEXT,
    newValue TEXT,
    editReason TEXT,
    editedAt INTEGER,
    editedBy TEXT,
    FOREIGN KEY (transactionId) REFERENCES transactions(id),
    FOREIGN KEY (expenseId) REFERENCES expenses(id)
  );

  -- Migration: Create deletion_logs table for tracking deleted records
  CREATE TABLE IF NOT EXISTS deletion_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recordType TEXT NOT NULL, -- 'transaction' or 'expense'
    recordId TEXT NOT NULL,
    recordData TEXT NOT NULL, -- JSON snapshot of the deleted record
    deleteReason TEXT NOT NULL,
    deletedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    deletedBy TEXT
  );

  -- Management: Schedules table for advance bookings
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheduleId TEXT UNIQUE,
    customer TEXT NOT NULL,
    phone TEXT,
    unitId INTEGER,
    unitName TEXT,
    scheduledDate TEXT NOT NULL,
    scheduledTime TEXT,
    scheduledEndDate TEXT,
    scheduledEndTime TEXT,
    duration INTEGER,
    note TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (unitId) REFERENCES units(id)
  );

  -- Note: scheduleId column is added via runtime migration below

  -- Management: Inventory table for equipment/assets
  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    quantity INTEGER DEFAULT 1,
    unit TEXT,
    condition TEXT DEFAULT 'good',
    purchaseDate TEXT,
    purchasePrice REAL,
    currentValue REAL,
    location TEXT,
    note TEXT,
    status TEXT DEFAULT 'active',
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  -- Management: Initial Capital table
  CREATE TABLE IF NOT EXISTS initial_capital (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    description TEXT,
    date TEXT,
    source TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  -- Management: Capital expenses (investments from initial capital)
  CREATE TABLE IF NOT EXISTS capital_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT NOT NULL,
    category TEXT,
    amount REAL NOT NULL,
    date TEXT,
    note TEXT,
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

// Runtime migration: Ensure edit_logs table exists with expense support (for existing databases)
try {
  // Check if old table exists with NOT NULL constraint issue
  const tableInfo = db.prepare(`PRAGMA table_info(edit_logs)`).all();
  const transactionIdCol = tableInfo.find(c => c.name === 'transactionId');
  const expenseIdCol = tableInfo.find(c => c.name === 'expenseId');
  
  // If table exists and transactionId has NOT NULL (notnull=1), we need to recreate
  if (tableInfo.length > 0 && transactionIdCol && transactionIdCol.notnull === 1) {
    console.log('[DB] Migration: Recreating edit_logs table to fix NOT NULL constraints');
    
    // Step 1: Create backup table with correct schema
    db.prepare(`CREATE TABLE edit_logs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transactionId TEXT,
      expenseId TEXT,
      fieldName TEXT NOT NULL,
      oldValue TEXT,
      newValue TEXT,
      editReason TEXT,
      editedAt INTEGER,
      editedBy TEXT
    )`).run();
    
    // Step 2: Copy existing data (convert transactionId to allow NULL)
    db.prepare(`INSERT INTO edit_logs_new (id, transactionId, fieldName, oldValue, newValue, editReason, editedAt, editedBy)
      SELECT id, transactionId, fieldName, oldValue, newValue, editReason, editedAt, editedBy 
      FROM edit_logs WHERE transactionId IS NOT NULL`).run();
    
    // Step 3: Drop old table
    db.prepare(`DROP TABLE edit_logs`).run();
    
    // Step 4: Rename new table
    db.prepare(`ALTER TABLE edit_logs_new RENAME TO edit_logs`).run();
    
    console.log('[DB] Migration: edit_logs table recreated with nullable transactionId');
  } else if (tableInfo.length === 0) {
    // Fresh database - create table with correct schema
    db.prepare(`CREATE TABLE IF NOT EXISTS edit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transactionId TEXT,
      expenseId TEXT,
      fieldName TEXT NOT NULL,
      oldValue TEXT,
      newValue TEXT,
      editReason TEXT,
      editedAt INTEGER,
      editedBy TEXT
    )`).run();
    console.log('[DB] Migration: edit_logs table created');
  }
  
  // For existing databases, try to add expenseId column if missing
  if (!expenseIdCol) {
    try {
      db.prepare(`ALTER TABLE edit_logs ADD COLUMN expenseId TEXT`).run();
      console.log('[DB] Migration: Added expenseId column to edit_logs');
    } catch (e) {
      // Column might already exist, ignore error
    }
  }
  
  // Add scheduleId column for schedule audit trail
  const scheduleIdCol = tableInfo.find(c => c.name === 'scheduleId');
  if (!scheduleIdCol) {
    try {
      db.prepare(`ALTER TABLE edit_logs ADD COLUMN scheduleId TEXT`).run();
      console.log('[DB] Migration: Added scheduleId column to edit_logs');
    } catch (e) {
      // Column might already exist, ignore error
    }
  }
} catch (e) {
  console.error('[DB] Migration error:', e.message);
}

// Runtime migration: Ensure deletion_logs table exists (for existing databases)
try {
  const deletionTableInfo = db.prepare(`PRAGMA table_info(deletion_logs)`).all();

  if (deletionTableInfo.length === 0) {
    // Table doesn't exist - create it
    db.prepare(`CREATE TABLE IF NOT EXISTS deletion_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recordType TEXT NOT NULL,
      recordId TEXT NOT NULL,
      recordData TEXT NOT NULL,
      deleteReason TEXT NOT NULL,
      deletedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      deletedBy TEXT
    )`).run();
    console.log('[DB] Migration: deletion_logs table created');
  }
} catch (e) {
  console.error('[DB] Migration error for deletion_logs:', e.message);
}

// For existing databases, try to add category column to expenses
if (db) {
  try {
    db.prepare(`ALTER TABLE expenses ADD COLUMN category TEXT`).run();
    console.log('[DB] Migration: Added category column to expenses');
  } catch (e) {
    // Column might already exist, ignore error
  }
}

// Runtime migration: Add scheduledEndDate and scheduledEndTime columns to schedules table
if (db) {
  try {
    const schedulesInfo = db.prepare(`PRAGMA table_info(schedules)`).all();
    const hasEndDate = schedulesInfo.find(c => c.name === 'scheduledEndDate');
    const hasEndTime = schedulesInfo.find(c => c.name === 'scheduledEndTime');
    
    if (!hasEndDate) {
      db.prepare(`ALTER TABLE schedules ADD COLUMN scheduledEndDate TEXT`).run();
      console.log('[DB] Migration: Added scheduledEndDate column to schedules');
    }
    if (!hasEndTime) {
      db.prepare(`ALTER TABLE schedules ADD COLUMN scheduledEndTime TEXT`).run();
      console.log('[DB] Migration: Added scheduledEndTime column to schedules');
    }
    
    // Migration: Add scheduleId column if not exists
    const hasScheduleId = schedulesInfo.find(c => c.name === 'scheduleId');
    if (!hasScheduleId) {
      // Add column without UNIQUE first (SQLite limitation)
      db.prepare(`ALTER TABLE schedules ADD COLUMN scheduleId TEXT`).run();
      console.log('[DB] Migration: Added scheduleId column to schedules');
      
      // Generate IDs for existing schedules immediately after adding column
      const existingSchedules = db.prepare(`SELECT id FROM schedules WHERE scheduleId IS NULL`).all();
      if (existingSchedules.length > 0) {
        console.log(`[DB] Migration: Generating scheduleId for ${existingSchedules.length} existing schedules`);
        for (const schedule of existingSchedules) {
          const newId = generateScheduleId();
          db.prepare(`UPDATE schedules SET scheduleId = ? WHERE id = ?`).run(newId, schedule.id);
        }
        console.log('[DB] Migration: Generated scheduleId for all existing schedules');
      }
    }
    
    // Ensure all schedules have scheduleId (catch any that might have been missed)
    const schedulesWithoutId = db.prepare(`SELECT id FROM schedules WHERE scheduleId IS NULL OR scheduleId = ''`).all();
    if (schedulesWithoutId.length > 0) {
      console.log(`[DB] Migration: Generating scheduleId for ${schedulesWithoutId.length} schedules without ID`);
      for (const schedule of schedulesWithoutId) {
        const newId = generateScheduleId();
        db.prepare(`UPDATE schedules SET scheduleId = ? WHERE id = ?`).run(newId, schedule.id);
      }
      console.log('[DB] Migration: All schedules now have scheduleId');
    }
    
    // Migration: Add linkedScheduleId column to units table if not exists
    const unitsInfo = db.prepare(`PRAGMA table_info(units)`).all();
    const hasLinkedScheduleId = unitsInfo.find(c => c.name === 'linkedScheduleId');
    if (!hasLinkedScheduleId) {
      db.prepare(`ALTER TABLE units ADD COLUMN linkedScheduleId INTEGER`).run();
      console.log('[DB] Migration: Added linkedScheduleId column to units');
    }
  } catch (e) {
    console.error('[DB] Migration error for schedules columns:', e.message);
  }
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
  
  const { customer = '', duration = 0, note = '', linkedScheduleId = null } = req.body;
  const startTime = Date.now();
  
  db.prepare('UPDATE units SET active = 1, startTime = ?, customer = ?, duration = ?, note = ?, linkedScheduleId = ? WHERE id = ?')
    .run(startTime, customer, duration, note, linkedScheduleId, id);
  
  // If linked to a schedule, update schedule status to 'running'
  if (linkedScheduleId) {
    try {
      db.prepare('UPDATE schedules SET status = ?, unitId = ?, unitName = ? WHERE id = ?')
        .run('running', id, unit.name, linkedScheduleId);
      console.log(`[Schedule] Linked schedule ${linkedScheduleId} started on unit ${id}`);
    } catch (e) {
      console.error('[Schedule] Error updating schedule status:', e.message);
    }
  }
  
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
    id: generateRevenueId(),
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
  
  // If linked to a schedule, update schedule status to 'completed'
  if (unit.linkedScheduleId) {
    try {
      db.prepare('UPDATE schedules SET status = ? WHERE id = ?')
        .run('completed', unit.linkedScheduleId);
      console.log(`[Schedule] Linked schedule ${unit.linkedScheduleId} marked as completed`);
    } catch (e) {
      console.error('[Schedule] Error updating schedule status on stop:', e.message);
    }
  }
  
  db.prepare("UPDATE units SET active = 0, startTime = NULL, customer = '', duration = 0, note = '', linkedScheduleId = NULL WHERE id = ?").run(id);
  
  res.json({ ok: true, tx });
});

// ─── SCHEDULE-UNIT INTEGRATION ─────────────────────────────────
// Start a unit from a schedule (booking → active unit)
app.post('/api/schedules/:id/start-unit', requireAuth, (req, res) => {
  const scheduleId = parseInt(req.params.id);
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!schedule) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
  if (schedule.status === 'running') return res.status(400).json({ error: 'Jadwal sudah berjalan' });
  if (schedule.status === 'completed') return res.status(400).json({ error: 'Jadwal sudah selesai' });
  if (schedule.status === 'cancelled') return res.status(400).json({ error: 'Jadwal sudah dibatalkan' });
  
  // Use provided unitId or schedule's unitId
  const { unitId = schedule.unitId } = req.body;
  if (!unitId) return res.status(400).json({ error: 'Pilih unit terlebih dahulu' });
  
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId);
  if (!unit) return res.status(404).json({ error: 'Unit tidak ditemukan' });
  if (unit.active) return res.status(400).json({ error: 'Unit sudah aktif' });
  
  // Prepare note with [BOOKING] prefix
  const bookingNote = schedule.note ? `[BOOKING] - ${schedule.note}` : '[BOOKING]';
  const startTime = Date.now();
  
  // Start the unit with schedule data
  db.prepare('UPDATE units SET active = 1, startTime = ?, customer = ?, duration = ?, note = ?, linkedScheduleId = ? WHERE id = ?')
    .run(startTime, schedule.customer, schedule.duration || 0, bookingNote, scheduleId, unitId);
  
  // Update schedule status to running
  db.prepare('UPDATE schedules SET status = ?, unitId = ?, unitName = ? WHERE id = ?')
    .run('running', unitId, unit.name, scheduleId);
  
  res.json({ 
    ok: true, 
    message: 'Unit dimulai dari jadwal',
    unit: db.prepare('SELECT * FROM units WHERE id = ?').get(unitId),
    schedule: db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId)
  });
});

// Complete a schedule and stop its linked unit
app.post('/api/schedules/:id/complete', requireAuth, (req, res) => {
  const scheduleId = parseInt(req.params.id);
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!schedule) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
  
  // If schedule is running and has a linked unit, stop the unit first
  if (schedule.status === 'running' && schedule.unitId) {
    const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(schedule.unitId);
    if (unit && unit.active && unit.linkedScheduleId === scheduleId) {
      const settings = getSettings();
      const elMin = Math.floor((Date.now() - unit.startTime) / 60000);
      const cost = Math.round((elMin / 60) * settings.ratePerHour);
      const { paid = cost, payment = 'cash' } = req.body;
      const dateKey = getWIBDateISO();
      
      const tx = {
        id: generateRevenueId(),
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
      
      db.prepare("UPDATE units SET active = 0, startTime = NULL, customer = '', duration = 0, note = '', linkedScheduleId = NULL WHERE id = ?")
        .run(schedule.unitId);
    }
  }
  
  // Update schedule status
  db.prepare('UPDATE schedules SET status = ? WHERE id = ?').run('completed', scheduleId);
  
  res.json({ ok: true, message: 'Jadwal selesai' });
});

// ─── TRANSACTIONS ─────────────────────────────────────────────
// Enhanced GET with Discord-like search & filter capabilities
// Query params:
//   - search: partial TX ID match (e.g., "PSM0001")
//   - customer: exact customer name filter
//   - amountMin/amountMax: income amount range
//   - dateFrom/dateTo: date range (YYYY-MM-DD format, WIB timezone)
//   - payment: payment method filter
//   - sortBy: 'date' | 'amount' | 'customer' | 'created' (default: date)
//   - sortOrder: 'asc' | 'desc' (default: desc)
//   - limit/offset: pagination
app.get('/api/transactions', requireAuth, (req, res) => {
  const {
    search,
    customer,
    unit,
    amountMin,
    amountMax,
    dateFrom,
    dateTo,
    payment,
    sortBy = 'date',
    sortOrder = 'desc',
    limit = 100,
    offset = 0
  } = req.query;

  const conditions = [];
  const params = [];

  // TX ID partial search (Discord-like search by ID)
  if (search && search.trim()) {
    conditions.push("id LIKE ? COLLATE NOCASE");
    params.push(`%${search.trim()}%`);
  }

  // Customer name filter (partial match, case-insensitive)
  if (customer && customer.trim()) {
    conditions.push("customer LIKE ? COLLATE NOCASE");
    params.push(`%${customer.trim()}%`);
  }

  // Unit name filter (partial match, case-insensitive)
  if (unit && unit.trim()) {
    conditions.push("unitName LIKE ? COLLATE NOCASE");
    params.push(`%${unit.trim()}%`);
  }

  // Amount range filter
  if (amountMin !== undefined && amountMin !== '') {
    conditions.push("paid >= ?");
    params.push(parseFloat(amountMin));
  }
  if (amountMax !== undefined && amountMax !== '') {
    conditions.push("paid <= ?");
    params.push(parseFloat(amountMax));
  }

  // Date range filter (WIB dates stored as YYYY-MM-DD in DB)
  if (dateFrom && dateFrom.trim()) {
    conditions.push("date >= ?");
    params.push(dateFrom.trim());
  }
  if (dateTo && dateTo.trim()) {
    conditions.push("date <= ?");
    params.push(dateTo.trim());
  }

  // Payment method filter
  if (payment && payment.trim()) {
    conditions.push("payment = ? COLLATE NOCASE");
    params.push(payment.trim());
  }

  // Build WHERE clause
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build ORDER BY clause
  const sortColumnMap = {
    'date': 'date',
    'amount': 'paid',
    'customer': 'customer',
    'unit': 'unitName',
    'created': 'created_at',
    'id': 'id'
  };
  const sortColumn = sortColumnMap[sortBy] || 'endTime';
  const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Execute count query for pagination info
  const countQuery = `SELECT COUNT(*) as total FROM transactions ${whereClause}`;
  const countResult = db.prepare(countQuery).get(...params);
  const totalCount = countResult.total;

  // Execute main query
  const query = `SELECT * FROM transactions ${whereClause} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`;
  const transactions = db.prepare(query).all(...params, parseInt(limit), parseInt(offset));

  res.json({
    transactions,
    pagination: {
      total: totalCount,
      limit: parseInt(limit),
      offset: parseInt(offset),
      hasMore: totalCount > parseInt(offset) + transactions.length
    },
    filters: {
      search: search || null,
      customer: customer || null,
      unit: unit || null,
      amountMin: amountMin || null,
      amountMax: amountMax || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      payment: payment || null
    }
  });
});

app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { reason, deletedBy = 'admin' } = req.body;
  
  // Validate deletion reason
  if (!reason || reason.trim().length < 3) {
    return res.status(400).json({ error: 'Deletion reason is required (minimum 3 characters)' });
  }
  
  // Get the transaction before deleting (for audit log)
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }
  
  // Log the deletion before actually deleting
  const logStmt = db.prepare(`
    INSERT INTO deletion_logs (recordType, recordId, recordData, deleteReason, deletedAt, deletedBy)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  logStmt.run(
    'transaction',
    id,
    JSON.stringify(tx),
    reason.trim(),
    Date.now(),
    deletedBy
  );
  
  // Now delete the transaction
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  
  res.json({ ok: true, deletedId: id });
});

// GET deletion logs (for audit trail)
app.get('/api/deletion-logs', requireAuth, (req, res) => {
  const { recordType, limit = 50 } = req.query;
  let query = 'SELECT * FROM deletion_logs';
  const params = [];
  
  if (recordType) {
    query += ' WHERE recordType = ?';
    params.push(recordType);
  }
  
  query += ' ORDER BY deletedAt DESC LIMIT ?';
  params.push(limit);
  
  const logs = db.prepare(query).all(...params);
  
  // Parse JSON recordData for each log
  const parsedLogs = logs.map(log => ({
    ...log,
    recordData: JSON.parse(log.recordData)
  }));
  
  res.json({ ok: true, logs: parsedLogs });
});

app.put('/api/transactions/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  
  // Support both formats: {updates: {...}, reason: ...} or direct field updates
  const inputUpdates = req.body.updates || req.body;
  const editReason = req.body.reason || req.body.editReason || '-';
  const editedBy = req.body.editedBy || 'admin';
  
  // Map frontend field names to database columns
  const fieldMapping = {
    'customer': 'customer',
    'paid': 'paid',           // DB column is 'paid', not 'total'
    'duration': 'durationMin', // DB column is 'durationMin', not 'duration'
    'payment': 'payment'
  };
  
  // Build update fields with proper mapping + track changes for audit log
  const dbFields = [];
  const dbValues = [];
  const editLogs = [];
  
  for (const [field, value] of Object.entries(inputUpdates)) {
    if (field === 'id' || typeof value === 'object') continue;
    const dbField = fieldMapping[field] || field;
    // Only update if value actually changed
    if (tx[dbField] !== value) {
      dbFields.push(`${dbField} = ?`);
      dbValues.push(value);
      // Log the edit for audit trail
      editLogs.push({
        transactionId: id,
        fieldName: field,
        oldValue: String(tx[dbField] || ''),
        newValue: String(value),
        editReason,
        editedAt: Date.now(),
        editedBy
      });
    }
  }
  
  if (dbFields.length > 0) {
    const setClause = dbFields.join(', ');
    db.prepare(`UPDATE transactions SET ${setClause} WHERE id = ?`).run(...dbValues, id);
    
    // Insert edit logs to audit trail
    const logStmt = db.prepare(`
      INSERT INTO edit_logs (transactionId, fieldName, oldValue, newValue, editReason, editedAt, editedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const log of editLogs) {
      logStmt.run(log.transactionId, log.fieldName, log.oldValue, log.newValue, log.editReason, log.editedAt, log.editedBy);
    }
  }
  
  res.json({ 
    ok: true, 
    changes: editLogs.length,
    tx: db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) 
  });
});

// GET edit history for a transaction
app.get('/api/transactions/:id/edits', requireAuth, (req, res) => {
  const logs = db.prepare(
    'SELECT * FROM edit_logs WHERE transactionId = ? ORDER BY editedAt DESC'
  ).all(req.params.id);
  res.json({ ok: true, logs });
});

// ─── EXPENSES ─────────────────────────────────────────────────
// Enhanced GET with Discord-like search & filter capabilities
// Query params:
//   - search: partial TX ID match (e.g., "PSK0001")
//   - category: expense category filter (partial match, case-insensitive)
//   - item: expense item filter (partial match, case-insensitive)
//   - amountMin/amountMax: expense amount range
//   - dateFrom/dateTo: date range (YYYY-MM-DD format, WIB timezone)
//   - note: note text filter (partial match)
//   - sortBy: 'date' | 'amount' | 'category' | 'item' | 'created' (default: date)
//   - sortOrder: 'asc' | 'desc' (default: desc)
//   - limit/offset: pagination
app.get('/api/expenses', requireAuth, (req, res) => {
  const {
    search,
    category,
    item,
    amountMin,
    amountMax,
    dateFrom,
    dateTo,
    note,
    sortBy = 'date',
    sortOrder = 'desc',
    limit = 100,
    offset = 0
  } = req.query;

  const conditions = [];
  const params = [];

  // TX ID partial search
  if (search && search.trim()) {
    conditions.push("id LIKE ? COLLATE NOCASE");
    params.push(`%${search.trim()}%`);
  }

  // Category filter (partial match, case-insensitive)
  if (category && category.trim()) {
    conditions.push("category LIKE ? COLLATE NOCASE");
    params.push(`%${category.trim()}%`);
  }

  // Item filter (partial match, case-insensitive)
  if (item && item.trim()) {
    conditions.push("item LIKE ? COLLATE NOCASE");
    params.push(`%${item.trim()}%`);
  }

  // Amount range filter
  if (amountMin !== undefined && amountMin !== '') {
    conditions.push("amount >= ?");
    params.push(parseFloat(amountMin));
  }
  if (amountMax !== undefined && amountMax !== '') {
    conditions.push("amount <= ?");
    params.push(parseFloat(amountMax));
  }

  // Date range filter (WIB dates stored as YYYY-MM-DD in DB)
  if (dateFrom && dateFrom.trim()) {
    conditions.push("date >= ?");
    params.push(dateFrom.trim());
  }
  if (dateTo && dateTo.trim()) {
    conditions.push("date <= ?");
    params.push(dateTo.trim());
  }

  // Note filter (partial match)
  if (note && note.trim()) {
    conditions.push("note LIKE ? COLLATE NOCASE");
    params.push(`%${note.trim()}%`);
  }

  // Build WHERE clause
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build ORDER BY clause
  const sortColumnMap = {
    'date': 'date',
    'amount': 'amount',
    'category': 'category',
    'item': 'item',
    'created': 'created_at',
    'id': 'id'
  };
  const sortColumn = sortColumnMap[sortBy] || 'date';
  const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Execute count query for pagination info
  const countQuery = `SELECT COUNT(*) as total FROM expenses ${whereClause}`;
  const countResult = db.prepare(countQuery).get(...params);
  const totalCount = countResult.total;

  // Execute main query
  const query = `SELECT * FROM expenses ${whereClause} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`;
  const expenses = db.prepare(query).all(...params, parseInt(limit), parseInt(offset));

  res.json({
    expenses,
    pagination: {
      total: totalCount,
      limit: parseInt(limit),
      offset: parseInt(offset),
      hasMore: totalCount > parseInt(offset) + expenses.length
    },
    filters: {
      search: search || null,
      category: category || null,
      item: item || null,
      amountMin: amountMin || null,
      amountMax: amountMax || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      note: note || null
    }
  });
});

// GET expense categories for autocomplete
app.get('/api/expense-categories', requireAuth, (req, res) => {
  const { search, limit = 10 } = req.query;
  
  let query = "SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL AND category != ''";
  const params = [];
  
  if (search && search.trim()) {
    query += " AND category LIKE ? COLLATE NOCASE";
    params.push(`%${search.trim()}%`);
  }
  
  query += " ORDER BY category ASC LIMIT ?";
  params.push(parseInt(limit));
  
  const categories = db.prepare(query).all(...params);
  res.json(categories.map(c => c.category));
});

// GET expense items for autocomplete
app.get('/api/expense-items', requireAuth, (req, res) => {
  const { search, limit = 10 } = req.query;
  
  let query = "SELECT DISTINCT item FROM expenses WHERE item IS NOT NULL AND item != ''";
  const params = [];
  
  if (search && search.trim()) {
    query += " AND item LIKE ? COLLATE NOCASE";
    params.push(`%${search.trim()}%`);
  }
  
  query += " ORDER BY item ASC LIMIT ?";
  params.push(parseInt(limit));
  
  const items = db.prepare(query).all(...params);
  res.json(items.map(i => i.item));
});

app.post('/api/expenses', requireAuth, (req, res) => {
  // Auto-generate date in WIB timezone (UTC+7) - no user input needed
  const wibDate = new Date(Date.now() + (7 * 60 * 60 * 1000)).toISOString().split('T')[0];
  const exp = { id: generateExpenseId(), ...req.body, date: wibDate };
  db.prepare('INSERT INTO expenses (id, item, category, amount, date, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(exp.id, exp.item, exp.category || '', exp.amount, exp.date, exp.note);
  res.json({ ok: true, exp });
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { reason, deletedBy = 'admin' } = req.body;
  
  // Validate deletion reason
  if (!reason || reason.trim().length < 3) {
    return res.status(400).json({ error: 'Deletion reason is required (minimum 3 characters)' });
  }
  
  // Get the expense before deleting (for audit log)
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  if (!exp) {
    return res.status(404).json({ error: 'Expense not found' });
  }
  
  // Log the deletion before actually deleting
  const logStmt = db.prepare(`
    INSERT INTO deletion_logs (recordType, recordId, recordData, deleteReason, deletedAt, deletedBy)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  logStmt.run(
    'expense',
    id,
    JSON.stringify(exp),
    reason.trim(),
    Date.now(),
    deletedBy
  );
  
  // Now delete the expense
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  
  res.json({ ok: true, deletedId: id });
});

// PUT update expense with audit trail logging
app.put('/api/expenses/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  if (!exp) return res.status(404).json({ error: 'Expense not found' });
  
  const inputUpdates = req.body.updates || req.body;
  const editReason = req.body.reason || req.body.editReason || '-';
  const editedBy = req.body.editedBy || 'admin';
  
  // Map frontend field names to database columns
  const fieldMapping = {
    'category': 'category',
    'item': 'item',
    'amount': 'amount',
    'date': 'date',
    'note': 'note',
    'created_at': 'created_at'  // For editing timestamp
  };
  
  const dbFields = [];
  const dbValues = [];
  const editLogs = [];
  
  for (const [field, value] of Object.entries(inputUpdates)) {
    if (field === 'id' || typeof value === 'object') continue;
    const dbField = fieldMapping[field] || field;
    if (exp[dbField] !== value) {
      dbFields.push(`${dbField} = ?`);
      dbValues.push(value);
      editLogs.push({
        expenseId: id,
        fieldName: field,
        oldValue: String(exp[dbField] || ''),
        newValue: String(value),
        editReason,
        editedAt: Date.now(),
        editedBy
      });
    }
  }
  
  if (dbFields.length > 0) {
    const setClause = dbFields.join(', ');
    db.prepare(`UPDATE expenses SET ${setClause} WHERE id = ?`).run(...dbValues, id);
    
    const logStmt = db.prepare(`
      INSERT INTO edit_logs (expenseId, fieldName, oldValue, newValue, editReason, editedAt, editedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const log of editLogs) {
      logStmt.run(log.expenseId, log.fieldName, log.oldValue, log.newValue, log.editReason, log.editedAt, log.editedBy);
    }
  }
  
  res.json({ 
    ok: true, 
    changes: editLogs.length,
    exp: db.prepare('SELECT * FROM expenses WHERE id = ?').get(id)
  });
});

// GET edit history for an expense
app.get('/api/expenses/:id/edits', requireAuth, (req, res) => {
  const logs = db.prepare(
    'SELECT * FROM edit_logs WHERE expenseId = ? ORDER BY editedAt DESC'
  ).all(req.params.id);
  res.json({ ok: true, logs });
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

// ═══════════════════════════════════════════════════════════════
// MANAGEMENT APIs (Schedules, Inventory, Capital)
// ═══════════════════════════════════════════════════════════════

// ─── SCHEDULES ───────────────────────────────────────────────────
app.get('/api/schedules', requireAuth, (req, res) => {
  const schedules = db.prepare('SELECT * FROM schedules ORDER BY scheduledDate DESC, scheduledTime ASC').all();
  res.json({ ok: true, schedules });
});

app.post('/api/schedules', requireAuth, (req, res) => {
  const { customer, phone, unitId, unitName, scheduledDate, scheduledTime, scheduledEndDate, scheduledEndTime, duration, note, status } = req.body;
  const durationMinutes = parseInt(duration) || 0;
  
  // Conflict detection: Check if unit is already booked for overlapping time
  // Uses scheduledEndDate and scheduledEndTime if available, otherwise fall back to calculation
  if (unitId && scheduledDate && scheduledTime) {
    let newStartDateTime, newEndDateTime;
    
    // Parse new booking dates/times
    newStartDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
    if (scheduledEndDate && scheduledEndTime) {
      newEndDateTime = new Date(`${scheduledEndDate}T${scheduledEndTime}`);
    } else if (durationMinutes > 0) {
      newEndDateTime = new Date(newStartDateTime.getTime() + durationMinutes * 60000);
    }
    
    if (newEndDateTime) {
      // Get existing schedules for overlapping dates and unit
      // Check schedules where the date range overlaps
      const existingSchedules = db.prepare(
        `SELECT * FROM schedules 
         WHERE unitId = ? AND status != ? 
         AND (
           (scheduledDate <= ? AND (scheduledEndDate >= ? OR scheduledDate = ?))
           OR 
           (scheduledEndDate IS NULL AND scheduledDate >= ? AND scheduledDate <= ?)
         )`
      ).all(unitId, 'cancelled', scheduledEndDate || scheduledDate, scheduledDate, scheduledDate, scheduledDate, scheduledEndDate || scheduledDate);
      
      for (const existing of existingSchedules) {
        if (!existing.scheduledTime) continue;
        
        // Calculate existing booking datetime range
        let existStartDateTime = new Date(`${existing.scheduledDate}T${existing.scheduledTime}`);
        let existEndDateTime;
        
        if (existing.scheduledEndDate && existing.scheduledEndTime) {
          existEndDateTime = new Date(`${existing.scheduledEndDate}T${existing.scheduledEndTime}`);
        } else if (existing.duration) {
          existEndDateTime = new Date(existStartDateTime.getTime() + existing.duration * 60000);
        } else {
          continue; // Skip if no end time info
        }
        
        // Check for overlap: (StartA < EndB) && (EndA > StartB)
        const overlap = (newStartDateTime < existEndDateTime) && (newEndDateTime > existStartDateTime);
        
        if (overlap) {
          const existEndTimeStr = existing.scheduledEndTime || 
            String(existEndDateTime.getHours()).padStart(2, '0') + ':' + 
            String(existEndDateTime.getMinutes()).padStart(2, '0');
          return res.status(409).json({
            ok: false,
            error: `Unit sudah dibooking oleh ${existing.customer} pukul ${existing.scheduledTime}-${existEndTimeStr}. Silakan pilih unit lain atau waktu berbeda.`
          });
        }
      }
    }
  }
  
  // Generate schedule ID (PSJxxxxx)
  const scheduleId = generateScheduleId();

  const stmt = db.prepare(`
    INSERT INTO schedules (scheduleId, customer, phone, unitId, unitName, scheduledDate, scheduledTime, scheduledEndDate, scheduledEndTime, duration, note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    scheduleId,
    customer,
    phone || '',
    unitId || null,
    unitName || '',
    scheduledDate,
    scheduledTime || '',
    scheduledEndDate || scheduledDate,
    scheduledEndTime || '',
    durationMinutes,
    note || '',
    status || 'pending'
  );
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ok: true, schedule });
});

app.put('/api/schedules/:id', requireAuth, (req, res) => {
  const scheduleId = req.params.id;
  const { customer, phone, unitId, unitName, scheduledDate, scheduledTime, scheduledEndDate, scheduledEndTime, duration, note, status, reason, editReason, editedBy } = req.body;
  const durationMinutes = parseInt(duration) || 0;
  const editReasonText = reason || editReason || '-';
  const editor = editedBy || 'admin';

  // Get existing schedule first for partial updates
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Jadwal tidak ditemukan' });
  }

  // Prevent editing completed or cancelled schedules
  if (existing.status === 'completed' || existing.status === 'cancelled') {
    return res.status(400).json({
      ok: false,
      error: `Jadwal dengan status "${existing.status === 'completed' ? 'Selesai' : 'Dibatalkan'}" tidak dapat diedit.`
    });
  }
  
  // Use existing values if not provided (partial update support)
  const updateCustomer = customer !== undefined ? customer : existing.customer;
  const updatePhone = phone !== undefined ? phone : existing.phone;
  const updateUnitId = unitId !== undefined ? (unitId || null) : existing.unitId;
  const updateUnitName = unitName !== undefined ? unitName : existing.unitName;
  const updateScheduledDate = scheduledDate !== undefined ? scheduledDate : existing.scheduledDate;
  const updateScheduledTime = scheduledTime !== undefined ? scheduledTime : existing.scheduledTime;
  const updateScheduledEndDate = scheduledEndDate !== undefined ? scheduledEndDate : existing.scheduledEndDate;
  const updateScheduledEndTime = scheduledEndTime !== undefined ? scheduledEndTime : existing.scheduledEndTime;
  const updateDuration = duration !== undefined ? durationMinutes : existing.duration;
  const updateNote = note !== undefined ? note : existing.note;
  const updateStatus = status !== undefined ? status : existing.status;
  
  // Track changes for audit trail
  const editLogs = [];
  const trackChange = (fieldName, oldVal, newVal) => {
    if (String(oldVal || '') !== String(newVal || '')) {
      editLogs.push({
        scheduleId: existing.scheduleId || scheduleId,
        fieldName,
        oldValue: String(oldVal || ''),
        newValue: String(newVal || '')
      });
    }
  };
  
  // Track all field changes
  trackChange('customer', existing.customer, updateCustomer);
  trackChange('phone', existing.phone, updatePhone);
  trackChange('unitId', existing.unitId, updateUnitId);
  trackChange('unitName', existing.unitName, updateUnitName);
  trackChange('scheduledDate', existing.scheduledDate, updateScheduledDate);
  trackChange('scheduledTime', existing.scheduledTime, updateScheduledTime);
  trackChange('scheduledEndDate', existing.scheduledEndDate, updateScheduledEndDate);
  trackChange('scheduledEndTime', existing.scheduledEndTime, updateScheduledEndTime);
  trackChange('duration', existing.duration, updateDuration);
  trackChange('note', existing.note, updateNote);
  trackChange('status', existing.status, updateStatus);
  
  // Conflict detection for updates: Check if unit is already booked for overlapping time (excluding current schedule)
  if (updateUnitId && updateScheduledDate && updateScheduledTime) {
    let newStartDateTime = new Date(`${updateScheduledDate}T${updateScheduledTime}`);
    let newEndDateTime;
    
    if (updateScheduledEndDate && updateScheduledEndTime) {
      newEndDateTime = new Date(`${updateScheduledEndDate}T${updateScheduledEndTime}`);
    } else if (updateDuration > 0) {
      newEndDateTime = new Date(newStartDateTime.getTime() + updateDuration * 60000);
    }
    
    if (newEndDateTime) {
      const existingSchedules = db.prepare(
        `SELECT * FROM schedules 
         WHERE unitId = ? AND status != ? AND id != ?
         AND (
           (scheduledDate <= ? AND (scheduledEndDate >= ? OR scheduledDate = ?))
           OR 
           (scheduledEndDate IS NULL AND scheduledDate >= ? AND scheduledDate <= ?)
         )`
      ).all(updateUnitId, 'cancelled', scheduleId, updateScheduledEndDate || updateScheduledDate, updateScheduledDate, updateScheduledDate, updateScheduledDate, updateScheduledEndDate || updateScheduledDate);
      
      for (const exist of existingSchedules) {
        if (!exist.scheduledTime) continue;
        
        let existStartDateTime = new Date(`${exist.scheduledDate}T${exist.scheduledTime}`);
        let existEndDateTime;
        
        if (exist.scheduledEndDate && exist.scheduledEndTime) {
          existEndDateTime = new Date(`${exist.scheduledEndDate}T${exist.scheduledEndTime}`);
        } else if (exist.duration) {
          existEndDateTime = new Date(existStartDateTime.getTime() + exist.duration * 60000);
        } else {
          continue;
        }
        
        const overlap = (newStartDateTime < existEndDateTime) && (newEndDateTime > existStartDateTime);
        
        if (overlap) {
          const existEndTimeStr = exist.scheduledEndTime || 
            String(existEndDateTime.getHours()).padStart(2, '0') + ':' + 
            String(existEndDateTime.getMinutes()).padStart(2, '0');
          return res.status(409).json({
            ok: false,
            error: `Unit sudah dibooking oleh ${exist.customer} pukul ${exist.scheduledTime}-${existEndTimeStr}. Silakan pilih unit lain atau waktu berbeda.`
          });
        }
      }
    }
  }
  
  const stmt = db.prepare(`
    UPDATE schedules SET
      customer = ?, phone = ?, unitId = ?, unitName = ?, scheduledDate = ?, scheduledTime = ?,
      scheduledEndDate = ?, scheduledEndTime = ?, duration = ?, note = ?, status = ?
    WHERE id = ?
  `);
  stmt.run(
    updateCustomer,
    updatePhone || '',
    updateUnitId,
    updateUnitName || '',
    updateScheduledDate,
    updateScheduledTime || '',
    updateScheduledEndDate || updateScheduledDate,
    updateScheduledEndTime || '',
    updateDuration,
    updateNote || '',
    updateStatus || 'pending',
    scheduleId
  );
  
  // Insert edit logs to audit trail
  if (editLogs.length > 0) {
    const logStmt = db.prepare(`
      INSERT INTO edit_logs (scheduleId, fieldName, oldValue, newValue, editReason, editedAt, editedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    for (const log of editLogs) {
      logStmt.run(log.scheduleId, log.fieldName, log.oldValue, log.newValue, editReasonText, now, editor);
    }
  }
  
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  res.json({ ok: true, schedule, changes: editLogs.length });
});

// GET edit history for a schedule
app.get('/api/schedules/:id/edits', requireAuth, (req, res) => {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!schedule) {
    return res.status(404).json({ ok: false, error: 'Jadwal tidak ditemukan' });
  }
  const logs = db.prepare(
    'SELECT * FROM edit_logs WHERE scheduleId = ? ORDER BY editedAt DESC'
  ).all(schedule.scheduleId || req.params.id);
  res.json({ ok: true, logs });
});

app.delete('/api/schedules/:id', requireAuth, (req, res) => {
  const scheduleId = req.params.id;
  const { reason, deleteReason, deletedBy } = req.body || {};
  
  // Get schedule data before deletion for audit trail
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!schedule) {
    return res.status(404).json({ ok: false, error: 'Jadwal tidak ditemukan' });
  }
  
  // Log deletion to deletion_logs
  try {
    db.prepare(`
      INSERT INTO deletion_logs (recordType, recordId, recordData, deleteReason, deletedAt, deletedBy)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'schedule',
      schedule.scheduleId || scheduleId,
      JSON.stringify(schedule),
      reason || deleteReason || '-',
      Date.now(),
      deletedBy || 'admin'
    );
  } catch (e) {
    console.error('[Audit] Failed to log schedule deletion:', e.message);
  }
  
  db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
  res.json({ ok: true });
});

app.get('/api/schedules/:id', requireAuth, (req, res) => {
  try {
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
    if (!schedule) {
      return res.status(404).json({ ok: false, error: 'Jadwal tidak ditemukan' });
    }
    res.json({ ok: true, schedule });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// ─── INVENTORY ───────────────────────────────────────────────────
app.get('/api/inventory', requireAuth, (req, res) => {
  const items = db.prepare('SELECT * FROM inventory ORDER BY created_at DESC').all();
  res.json({ ok: true, items });
});

app.post('/api/inventory', requireAuth, (req, res) => {
  const stmt = db.prepare(`
    INSERT INTO inventory (name, category, quantity, unit, condition, purchaseDate, purchasePrice, currentValue, location, note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    req.body.name,
    req.body.category || '',
    req.body.quantity || 1,
    req.body.unit || 'pcs',
    req.body.condition || 'good',
    req.body.purchaseDate || '',
    req.body.purchasePrice || 0,
    req.body.currentValue || req.body.purchasePrice || 0,
    req.body.location || '',
    req.body.note || '',
    req.body.status || 'active'
  );
  const item = db.prepare('SELECT * FROM inventory WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ok: true, item });
});

app.put('/api/inventory/:id', requireAuth, (req, res) => {
  const stmt = db.prepare(`
    UPDATE inventory SET
      name = ?, category = ?, quantity = ?, unit = ?, condition = ?, purchaseDate = ?,
      purchasePrice = ?, currentValue = ?, location = ?, note = ?, status = ?
    WHERE id = ?
  `);
  stmt.run(
    req.body.name,
    req.body.category || '',
    req.body.quantity || 1,
    req.body.unit || 'pcs',
    req.body.condition || 'good',
    req.body.purchaseDate || '',
    req.body.purchasePrice || 0,
    req.body.currentValue || req.body.purchasePrice || 0,
    req.body.location || '',
    req.body.note || '',
    req.body.status || 'active',
    req.params.id
  );
  const item = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
  res.json({ ok: true, item });
});

app.delete('/api/inventory/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM inventory WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── INITIAL CAPITAL ─────────────────────────────────────────────
app.get('/api/capital', requireAuth, (req, res) => {
  const capital = db.prepare('SELECT * FROM initial_capital ORDER BY created_at DESC').all();
  const expenses = db.prepare('SELECT * FROM capital_expenses ORDER BY created_at DESC').all();
  const totalCapital = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM initial_capital').get().total;
  const totalSpent = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM capital_expenses').get().total;
  
  // Calculate ROI metrics based on income data
  const incomeStats = db.prepare(`
    SELECT 
      COALESCE(AVG(paid), 0) as avgDaily,
      COALESCE(MIN(paid), 0) as minDaily,
      COUNT(*) as txCount
    FROM transactions 
    WHERE date >= date('now', '-30 days')
  `).get();
  
  const avgMonthly = incomeStats.avgDaily * 30;
  const minMonthly = db.prepare(`
    SELECT COALESCE(SUM(paid), 0) as total 
    FROM transactions 
    WHERE date >= date('now', '-30 days')
  `).get().total;
  
  res.json({
    ok: true,
    capital,
    expenses,
    summary: {
      totalCapital,
      totalSpent,
      remaining: totalCapital - totalSpent
    },
    roi: {
      avgMonthly,
      minMonthly,
      breakEvenMonths: avgMonthly > 0 ? Math.ceil((totalCapital - totalSpent) / avgMonthly) : null,
      projectedProfit6m: avgMonthly > 0 ? (avgMonthly * 6) - (totalCapital - totalSpent) : 0,
      projectedProfit12m: avgMonthly > 0 ? (avgMonthly * 12) - (totalCapital - totalSpent) : 0
    }
  });
});

app.post('/api/capital', requireAuth, (req, res) => {
  const stmt = db.prepare(`
    INSERT INTO initial_capital (amount, description, date, source)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    req.body.amount,
    req.body.description || '',
    req.body.date || getWIBDateISO(),
    req.body.source || ''
  );
  const capital = db.prepare('SELECT * FROM initial_capital WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ok: true, capital });
});

app.post('/api/capital/expenses', requireAuth, (req, res) => {
  const stmt = db.prepare(`
    INSERT INTO capital_expenses (item, category, amount, date, note)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    req.body.item,
    req.body.category || '',
    req.body.amount,
    req.body.date || getWIBDateISO(),
    req.body.note || ''
  );
  const expense = db.prepare('SELECT * FROM capital_expenses WHERE id = ?').get(result.lastInsertRowid);
  res.json({ ok: true, expense });
});

app.delete('/api/capital/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM initial_capital WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/capital/expenses/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM capital_expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
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
    version: '2.0.1'
  });
});

// ─── RESET DATABASE ───────────────────────────────────────────
// DANGER: This endpoint resets ALL data - use with extreme caution
app.post('/api/admin/reset-database', requireAuth, (req, res) => {
  try {
    // Delete all data from main tables
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM expenses').run();
    db.prepare('DELETE FROM edit_logs').run();
    db.prepare('DELETE FROM deletion_logs').run();
    
    // Reset units to default (inactive, no customers)
    db.prepare("UPDATE units SET active = 0, startTime = NULL, customer = NULL, duration = 0, note = NULL").run();
    
    res.json({ 
      ok: true, 
      message: 'Database reset successfully. All data cleared.',
      cleared: ['transactions', 'expenses', 'edit_logs', 'deletion_logs', 'unit_sessions']
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
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
