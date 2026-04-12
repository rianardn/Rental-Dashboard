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
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 20971520');  // 20MB - safe for 256MB VM

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
    timestamp INTEGER,
    note TEXT
  );
  
  -- Management: Schedules table for advance bookings
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer TEXT NOT NULL,
    phone TEXT,
    unitId INTEGER,
    unitName TEXT,
    scheduledDate TEXT NOT NULL,
    scheduledTime TEXT,
    duration INTEGER,
    note TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (unitId) REFERENCES units(id)
  );
  
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

// Migration: Add note column if not exists (for existing databases)
try {
  db.exec(`ALTER TABLE expenses ADD COLUMN note TEXT`);
  console.log('[DB] Migration: Added note column to expenses table');
} catch (e) {
  // Column already exists
}

// Migration: Add category column if not exists (for expense type tracking)
try {
  db.exec(`ALTER TABLE expenses ADD COLUMN category TEXT`);
  console.log('[DB] Migration: Added category column to expenses table');
} catch (e) {
  // Column already exists
}

// Migration: Add payment method column to transactions
try {
  db.exec(`ALTER TABLE transactions ADD COLUMN payment TEXT DEFAULT 'cash'`);
  console.log('[DB] Migration: Added payment column to transactions table');
} catch (e) {
  // Column already exists
}

// Migration: Create edit_logs table for audit trail
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS edit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transactionId INTEGER,
      fieldName TEXT,
      oldValue TEXT,
      newValue TEXT,
      editReason TEXT,
      editedAt INTEGER,
      editedBy TEXT
    )
  `);
  console.log('[DB] Migration: Created edit_logs table');
} catch (e) {
  console.error('[DB] Error creating edit_logs table:', e);
}


// Initialize default settings
const initSettings = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
initSettings.run('ratePerHour', '5000');
initSettings.run('warnBefore', '10');
initSettings.run('businessName', 'PS3 Rental');

// Initialize default units
const unitCount = db.prepare('SELECT COUNT(*) as count FROM units').get().count;
if (unitCount === 0) {
  const initUnits = db.prepare('INSERT INTO units (id, name, active, startTime, customer, duration, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
  initUnits.run(1, 'PS 1', 0, null, '', 0, '');
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
    INSERT INTO transactions (unitId, unitName, customer, duration, rate, total, timestamp, note, payment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(tx.unitId, tx.unitName, tx.customer, tx.duration, tx.rate, tx.total, tx.timestamp, tx.note || '', tx.payment || 'cash');
  return { ...tx, id: result.lastInsertRowid };
}

function updateTransaction(id, updates, editReason, editedBy) {
  // Get current transaction data
  const current = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!current) throw new Error('Transaction not found');

  const dbFields = [];
  const dbValues = [];
  const editLogs = [];

  // Map frontend field names to database columns
  const fieldMapping = {
    'customer': 'customer',
    'paid': 'total',  // paid maps to total
    'duration': 'duration',
    'payment': 'payment'
  };

  for (const [field, value] of Object.entries(updates)) {
    const dbField = fieldMapping[field];
    if (dbField && current[dbField] !== value) {
      dbFields.push(`${dbField} = ?`);
      dbValues.push(value);
      // Log the edit
      editLogs.push({
        transactionId: id,
        fieldName: field,
        oldValue: String(current[dbField] || ''),
        newValue: String(value),
        editReason,
        editedAt: Date.now(),
        editedBy: editedBy || 'admin'
      });
    }
  }

  if (dbFields.length === 0) {
    return { updated: false, message: 'No changes detected' };
  }

  // Update transaction
  dbValues.push(id);
  const stmt = db.prepare(`UPDATE transactions SET ${dbFields.join(', ')} WHERE id = ?`);
  stmt.run(...dbValues);

  // Insert edit logs
  const logStmt = db.prepare(`
    INSERT INTO edit_logs (transactionId, fieldName, oldValue, newValue, editReason, editedAt, editedBy)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const log of editLogs) {
    logStmt.run(log.transactionId, log.fieldName, log.oldValue, log.newValue, log.editReason, log.editedAt, log.editedBy);
  }

  return { updated: true, id, changes: editLogs.length, logs: editLogs };
}

function getTransactionEditLogs(transactionId) {
  return db.prepare(
    'SELECT * FROM edit_logs WHERE transactionId = ? ORDER BY editedAt DESC'
  ).all(transactionId);
}

function addExpense(expense) {
  const stmt = db.prepare(`
    INSERT INTO expenses (description, amount, timestamp, note, category)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    expense.description,
    expense.amount,
    expense.timestamp,
    expense.note || '',
    expense.category || ''
  );
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

app.put('/api/transactions/:id', (req, res) => {
  try {
    const { updates, reason } = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid updates object' });
    }
    const result = updateTransaction(req.params.id, updates, reason, req.body.editedBy);
    broadcast({ type: 'transactions', data: db.prepare('SELECT * FROM transactions ORDER BY timestamp DESC').all() });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/transactions/:id/edits', (req, res) => {
  try {
    const logs = getTransactionEditLogs(req.params.id);
    res.json({ ok: true, logs });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// ── Expenses ───────────────────────────────────────────────────
app.get('/api/expenses', (req, res) => {
  res.json(db.prepare('SELECT * FROM expenses ORDER BY timestamp DESC').all());
});

app.post('/api/expenses', (req, res) => {
  // Convert frontend fields to database fields
  const expense = addExpense({
    description: req.body.item || req.body.description,
    amount: req.body.amount,
    timestamp: req.body.timestamp || new Date(req.body.date).getTime() || Date.now(),
    note: req.body.note,
    category: req.body.category || ''
  });
  broadcast({ type: 'expenses', data: db.prepare('SELECT * FROM expenses ORDER BY timestamp DESC').all() });
  res.json({ ok: true, expense });
});

// ── Schedules ───────────────────────────────────────────────────
app.get('/api/schedules', (req, res) => {
  res.json(db.prepare('SELECT * FROM schedules ORDER BY scheduledDate DESC, scheduledTime ASC').all());
});

app.post('/api/schedules', (req, res) => {
  const stmt = db.prepare(`
    INSERT INTO schedules (customer, phone, unitId, unitName, scheduledDate, scheduledTime, duration, note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    req.body.customer,
    req.body.phone || '',
    req.body.unitId || null,
    req.body.unitName || '',
    req.body.scheduledDate,
    req.body.scheduledTime || '',
    req.body.duration || 0,
    req.body.note || '',
    req.body.status || 'pending'
  );
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(result.lastInsertRowid);
  broadcast({ type: 'schedules', data: db.prepare('SELECT * FROM schedules ORDER BY scheduledDate DESC').all() });
  res.json({ ok: true, schedule });
});

app.put('/api/schedules/:id', (req, res) => {
  const scheduleId = req.params.id;
  const { updates, reason, editedBy } = req.body;

  // Get old state before update
  const oldSchedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!oldSchedule) {
    return res.status(404).json({ ok: false, error: 'Schedule not found' });
  }

  // Track changes for audit log
  let changes = 0;
  const oldState = { ...oldSchedule };

  // Build dynamic update query based on provided updates
  const fields = [];
  const values = [];

  if (updates.customer !== undefined) {
    fields.push('customer = ?');
    values.push(updates.customer);
    changes++;
  }
  if (updates.phone !== undefined) {
    fields.push('phone = ?');
    values.push(updates.phone || '');
    changes++;
  }
  if (updates.unitId !== undefined) {
    fields.push('unitId = ?');
    values.push(updates.unitId || null);
    // Also update unitName if unitId changed
    const unit = db.prepare('SELECT name FROM units WHERE id = ?').get(updates.unitId);
    if (unit) {
      fields.push('unitName = ?');
      values.push(unit.name);
    }
    changes++;
  }
  if (updates.scheduledDate !== undefined) {
    fields.push('scheduledDate = ?');
    values.push(updates.scheduledDate);
    changes++;
  }
  if (updates.scheduledTime !== undefined) {
    fields.push('scheduledTime = ?');
    values.push(updates.scheduledTime || '');
    changes++;
  }
  if (updates.duration !== undefined) {
    fields.push('duration = ?');
    values.push(parseInt(updates.duration) || 0);
    changes++;
  }
  if (updates.note !== undefined) {
    fields.push('note = ?');
    values.push(updates.note || '');
    changes++;
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
    changes++;
  }

  if (fields.length === 0) {
    return res.status(400).json({ ok: false, error: 'No fields to update' });
  }

  // Execute update
  const updateStmt = db.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`);
  values.push(scheduleId);
  updateStmt.run(...values);

  // Get new state after update
  const newSchedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  const newState = { ...newSchedule };

  // Log each changed field to edit_logs
  const timestamp = new Date().toISOString();
  const editLogStmt = db.prepare(`
    INSERT INTO edit_logs (entityType, entityId, scheduleId, fieldName, oldValue, newValue, editReason, editedBy, editedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const entityFields = ['customer', 'phone', 'unitId', 'unitName', 'scheduledDate', 'scheduledTime', 'duration', 'note', 'status'];
  entityFields.forEach(field => {
    if (updates[field] !== undefined || (field === 'unitName' && updates.unitId !== undefined)) {
      const oldVal = oldState[field] !== null && oldState[field] !== undefined ? String(oldState[field]) : '';
      const newVal = newState[field] !== null && newState[field] !== undefined ? String(newState[field]) : '';
      if (oldVal !== newVal) {
        editLogStmt.run(
          'schedule',
          scheduleId,
          scheduleId,
          field,
          oldVal,
          newVal,
          reason || 'Perubahan data jadwal',
          editedBy || 'admin',
          timestamp
        );
      }
    }
  });

  broadcast({ type: 'schedules', data: db.prepare('SELECT * FROM schedules ORDER BY scheduledDate DESC').all() });
  res.json({ ok: true, schedule: newSchedule, changes });
});

app.delete('/api/schedules/:id', (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  broadcast({ type: 'schedules', data: db.prepare('SELECT * FROM schedules ORDER BY scheduledDate DESC').all() });
  res.json({ ok: true });
});

app.get('/api/schedules/:id', (req, res) => {
  try {
    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
    if (!schedule) {
      return res.status(404).json({ ok: false, error: 'Schedule not found' });
    }
    res.json({ ok: true, schedule });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/schedules/:id/edits', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT * FROM edit_logs
      WHERE entityType = 'schedule' AND (entityId = ? OR scheduleId = ?)
      ORDER BY editedAt DESC
    `).all(req.params.id, req.params.id);
    res.json({ ok: true, logs });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// ── Inventory ───────────────────────────────────────────────────
app.get('/api/inventory', (req, res) => {
  res.json(db.prepare('SELECT * FROM inventory ORDER BY created_at DESC').all());
});

app.post('/api/inventory', (req, res) => {
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
  broadcast({ type: 'inventory', data: db.prepare('SELECT * FROM inventory ORDER BY created_at DESC').all() });
  res.json({ ok: true, item });
});

app.put('/api/inventory/:id', (req, res) => {
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
  broadcast({ type: 'inventory', data: db.prepare('SELECT * FROM inventory ORDER BY created_at DESC').all() });
  res.json({ ok: true, item });
});

app.delete('/api/inventory/:id', (req, res) => {
  db.prepare('DELETE FROM inventory WHERE id = ?').run(req.params.id);
  broadcast({ type: 'inventory', data: db.prepare('SELECT * FROM inventory ORDER BY created_at DESC').all() });
  res.json({ ok: true });
});

// ── Initial Capital ─────────────────────────────────────────────
app.get('/api/capital', (req, res) => {
  const capital = db.prepare('SELECT * FROM initial_capital ORDER BY created_at DESC').all();
  const expenses = db.prepare('SELECT * FROM capital_expenses ORDER BY created_at DESC').all();
  const totalCapital = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM initial_capital').get().total;
  const totalSpent = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM capital_expenses').get().total;
  res.json({
    ok: true,
    capital,
    expenses,
    summary: {
      totalCapital,
      totalSpent,
      remaining: totalCapital - totalSpent
    }
  });
});

app.post('/api/capital', (req, res) => {
  const stmt = db.prepare(`
    INSERT INTO initial_capital (amount, description, date, source)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    req.body.amount,
    req.body.description || '',
    req.body.date || new Date().toISOString().split('T')[0],
    req.body.source || ''
  );
  const capital = db.prepare('SELECT * FROM initial_capital WHERE id = ?').get(result.lastInsertRowid);
  broadcast({ type: 'capital', data: db.prepare('SELECT * FROM initial_capital ORDER BY created_at DESC').all() });
  res.json({ ok: true, capital });
});

app.post('/api/capital/expenses', (req, res) => {
  const stmt = db.prepare(`
    INSERT INTO capital_expenses (item, category, amount, date, note)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    req.body.item,
    req.body.category || '',
    req.body.amount,
    req.body.date || new Date().toISOString().split('T')[0],
    req.body.note || ''
  );
  const expense = db.prepare('SELECT * FROM capital_expenses WHERE id = ?').get(result.lastInsertRowid);
  broadcast({ type: 'capital_expenses', data: db.prepare('SELECT * FROM capital_expenses ORDER BY created_at DESC').all() });
  res.json({ ok: true, expense });
});

app.delete('/api/capital/expenses/:id', (req, res) => {
  db.prepare('DELETE FROM capital_expenses WHERE id = ?').run(req.params.id);
  broadcast({ type: 'capital_expenses', data: db.prepare('SELECT * FROM capital_expenses ORDER BY created_at DESC').all() });
  res.json({ ok: true });
});

// ── ROI Statistics ─────────────────────────────────────────────
app.get('/api/stats/roi', (req, res) => {
  // Get revenue data for projections
  const revenues = db.prepare('SELECT total FROM transactions').all().map(t => t.total);
  const totalRevenue = revenues.reduce((a, b) => a + b, 0);
  const avgRevenue = revenues.length > 0 ? totalRevenue / revenues.length : 0;
  
  // Calculate average daily revenue (based on unique days with transactions)
  const dailyRevenues = db.prepare(`
    SELECT DATE(timestamp/1000, 'unixepoch', 'localtime') as date, SUM(total) as daily_total
    FROM transactions
    GROUP BY date
  `).all();
  
  const avgDailyRevenue = dailyRevenues.length > 0 
    ? dailyRevenues.reduce((a, b) => a + b.daily_total, 0) / dailyRevenues.length 
    : 0;
  
  // Calculate median daily revenue
  const sortedDaily = dailyRevenues.map(d => d.daily_total).sort((a, b) => a - b);
  const medianDailyRevenue = sortedDaily.length > 0 
    ? (sortedDaily.length % 2 === 0 
      ? (sortedDaily[sortedDaily.length/2 - 1] + sortedDaily[sortedDaily.length/2]) / 2
      : sortedDaily[Math.floor(sortedDaily.length/2)])
    : 0;
  
  // Get capital data
  const totalCapital = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM initial_capital').get().total;
  const totalCapitalSpent = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM capital_expenses').get().total;
  
  // Calculate break-even projections
  const remainingCapital = totalCapital - totalCapitalSpent;
  const daysToBreakEvenAvg = avgDailyRevenue > 0 ? Math.ceil(remainingCapital / avgDailyRevenue) : 0;
  const daysToBreakEvenMedian = medianDailyRevenue > 0 ? Math.ceil(remainingCapital / medianDailyRevenue) : 0;
  
  // Calculate profit after break-even
  const monthlyProfitAvg = avgDailyRevenue * 30;
  const monthlyProfitMedian = medianDailyRevenue * 30;
  
  res.json({
    ok: true,
    projections: {
      avgDailyRevenue,
      medianDailyRevenue,
      totalCapital,
      totalCapitalSpent,
      remainingCapital,
      daysToBreakEvenAvg,
      daysToBreakEvenMedian,
      monthlyProfitAvg,
      monthlyProfitMedian,
      breakEvenDateAvg: daysToBreakEvenAvg > 0 ? new Date(Date.now() + daysToBreakEvenAvg * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
      breakEvenDateMedian: daysToBreakEvenMedian > 0 ? new Date(Date.now() + daysToBreakEvenMedian * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null
    }
  });
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
