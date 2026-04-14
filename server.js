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

// Generate sequential transaction ID (PSM-xxxxx for revenue)
function generateRevenueId() {
  const prefix = 'PSM';
  const stmt = db.prepare('INSERT INTO id_counters (prefix, last_number) VALUES (?, 1) ON CONFLICT(prefix) DO UPDATE SET last_number = last_number + 1 RETURNING last_number');
  const result = stmt.get(prefix);
  const seq = result.last_number;
  return `${prefix}-${String(seq).padStart(5, '0')}`;
}

// Generate sequential expense ID (PSK-xxxxx for expenses)
function generateExpenseId() {
  const prefix = 'PSK';
  const stmt = db.prepare('INSERT INTO id_counters (prefix, last_number) VALUES (?, 1) ON CONFLICT(prefix) DO UPDATE SET last_number = last_number + 1 RETURNING last_number');
  const result = stmt.get(prefix);
  const seq = result.last_number;
  return `${prefix}-${String(seq).padStart(5, '0')}`;
}

// Generate sequential schedule ID (PSJ-xxxxx for schedules/jadwal)
function generateScheduleId() {
  const prefix = 'PSJ';
  const stmt = db.prepare('INSERT INTO id_counters (prefix, last_number) VALUES (?, 1) ON CONFLICT(prefix) DO UPDATE SET last_number = last_number + 1 RETURNING last_number');
  const result = stmt.get(prefix);
  const seq = result.last_number;
  return `${prefix}-${String(seq).padStart(5, '0')}`;
}

// Generate inventory item ID based on category
function generateInventoryId(category) {
  const prefixMap = {
    'konsol': 'PS3',
    'ps3': 'PS3',           // Alias
    'tv': 'TV',
    'stik': 'STK',
    'kabel_usb': 'USB',
    'charger': 'USB',       // Alias
    'kabel_charger': 'USB', // Alias
    'kabel_hdmi': 'HDMI',
    'hdmi': 'HDMI',         // Alias
    'kabel_power': 'PLUG',
    'plug': 'PLUG',         // Alias
    'kabel': 'USB',         // Generic cable fallback
    'furniture': 'FURN',
    'aksesoris': 'AKS',
    'lainnya': 'LAIN'
  };
  const prefix = prefixMap[category?.toLowerCase()] || 'LAIN';
  const counterKey = `INV_${prefix}`;
  const stmt = db.prepare('INSERT INTO id_counters (prefix, last_number) VALUES (?, 1) ON CONFLICT(prefix) DO UPDATE SET last_number = last_number + 1 RETURNING last_number');
  const result = stmt.get(counterKey);
  const seq = result.last_number;
  return `${prefix}-${String(seq).padStart(2, '0')}`;
}

// Generate station/pairing ID
function generateStationId() {
  const prefix = 'HOME';
  const stmt = db.prepare('INSERT INTO id_counters (prefix, last_number) VALUES (?, 1) ON CONFLICT(prefix) DO UPDATE SET last_number = last_number + 1 RETURNING last_number');
  const result = stmt.get(prefix);
  const seq = result.last_number;
  return `${prefix}-${String(seq).padStart(2, '0')}`;
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
    unitId TEXT,
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
  -- NOTE: unitId changed to TEXT to support station IDs (HOME-01, etc.)
  -- FK constraint removed since station system uses different ID space than units table
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheduleId TEXT UNIQUE,
    customer TEXT NOT NULL,
    phone TEXT,
    unitId TEXT,
    unitName TEXT,
    scheduledDate TEXT NOT NULL,
    scheduledTime TEXT,
    scheduledEndDate TEXT,
    scheduledEndTime TEXT,
    duration INTEGER,
    note TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  -- Note: scheduleId column is added via runtime migration below

  -- Management: Completed schedules history
  CREATE TABLE IF NOT EXISTS completed_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheduleId TEXT NOT NULL,
    scheduledDate TEXT NOT NULL,
    scheduledTime TEXT,
    duration INTEGER,
    completedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (scheduleId) REFERENCES schedules(id)
  );

  -- Management: Deleted schedules log
  CREATE TABLE IF NOT EXISTS deleted_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheduleId TEXT NOT NULL,
    scheduledDate TEXT NOT NULL,
    scheduledTime TEXT,
    duration INTEGER,
    reason TEXT,
    deletedAt INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (scheduleId) REFERENCES schedules(id)
  );

  -- INVENTORY SYSTEM: Master items table
  CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY, -- PS3-01, TV-01, STK-01, etc.
    name TEXT NOT NULL,
    category TEXT NOT NULL, -- ps3, tv, stik, usb, hdmi, plug, lainnya
    subcategory TEXT, -- model/variant
    purchase_date TEXT,
    purchase_cost REAL DEFAULT 0,
    vendor TEXT,
    warranty_info TEXT,
    condition TEXT DEFAULT 'baik', -- baik, rusak, perbaikan, rusak_total
    current_location TEXT,
    notes TEXT,
    photo_url TEXT,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  -- INVENTORY SYSTEM: Pairings/Stations
  CREATE TABLE IF NOT EXISTS inventory_pairings (
    id TEXT PRIMARY KEY, -- HOME-01, HOME-02, etc.
    name TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );

  -- INVENTORY SYSTEM: Items in pairings (many-to-many)
  CREATE TABLE IF NOT EXISTS inventory_pairing_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pairing_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    role TEXT NOT NULL, -- konsol, tv, stik1, stik2, hdmi, charger1, charger2, plug, dll
    added_date TEXT,
    notes TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (pairing_id) REFERENCES inventory_pairings(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
  );

  -- INVENTORY SYSTEM: Pairing change history
  CREATE TABLE IF NOT EXISTS inventory_pairing_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    old_pairing_id TEXT,
    new_pairing_id TEXT,
    change_date INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    reason TEXT,
    changed_by TEXT,
    FOREIGN KEY (item_id) REFERENCES inventory_items(id),
    FOREIGN KEY (old_pairing_id) REFERENCES inventory_pairings(id),
    FOREIGN KEY (new_pairing_id) REFERENCES inventory_pairings(id)
  );

  -- INVENTORY SYSTEM: Maintenance records
  CREATE TABLE IF NOT EXISTS inventory_maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    maintenance_date TEXT,
    cost REAL DEFAULT 0,
    description TEXT,
    vendor TEXT,
    next_scheduled_maintenance TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
  );

  -- INVENTORY SYSTEM: Usage tracking (hours per day)
  CREATE TABLE IF NOT EXISTS inventory_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    date TEXT NOT NULL,
    hours_used REAL DEFAULT 0,
    source TEXT DEFAULT 'auto', -- auto (from schedules) or manual
    pairing_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
    FOREIGN KEY (pairing_id) REFERENCES inventory_pairings(id) ON DELETE SET NULL
  );

  -- INVENTORY SYSTEM: Depreciation tracking
  CREATE TABLE IF NOT EXISTS inventory_depreciation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    depreciation_date TEXT,
    book_value REAL,
    depreciation_method TEXT DEFAULT 'straight_line',
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
  );

  -- INVENTORY SYSTEM: Link to rental units (optional)
  CREATE TABLE IF NOT EXISTS unit_pairings (
    unit_id INTEGER NOT NULL,
    pairing_id TEXT NOT NULL,
    assigned_date TEXT,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    PRIMARY KEY (unit_id, pairing_id),
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
    FOREIGN KEY (pairing_id) REFERENCES inventory_pairings(id) ON DELETE CASCADE
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

// Runtime migration: Add unitId column to schedules table if not exists
if (db) {
  try {
    const schedulesInfo = db.prepare(`PRAGMA table_info(schedules)`).all();
    const hasUnitId = schedulesInfo.find(c => c.name === 'unitId');
    if (!hasUnitId) {
      db.prepare(`ALTER TABLE schedules ADD COLUMN unitId TEXT`).run();
      console.log('[DB] Migration: Added unitId column to schedules');
    }
  } catch (e) {
    console.error('[DB] Migration error for unitId column:', e.message);
  }
}

// Runtime migration: Fix unitId type from INTEGER to TEXT if needed (for existing databases)
if (db) {
  try {
    const schedulesInfo = db.prepare(`PRAGMA table_info(schedules)`).all();
    const unitIdCol = schedulesInfo.find(c => c.name === 'unitId');
    // If unitId exists but is INTEGER type, we need to migrate
    if (unitIdCol && unitIdCol.type === 'INTEGER') {
      console.log('[DB] Migration: Changing schedules.unitId from INTEGER to TEXT...');
      // SQLite doesn't support ALTER COLUMN, so we use a workaround
      db.prepare(`UPDATE schedules SET unitId = CAST(unitId AS TEXT)`).run();
      console.log('[DB] Migration: schedules.unitId cast to TEXT');
    }
  } catch (e) {
    console.error('[DB] Migration error for unitId type fix:', e.message);
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

// Migration: Fix schedules unitId column type from INTEGER to TEXT
// This is needed for station system compatibility (HOME-01, etc.)
if (db) {
  try {
    const scheduleInfo = db.prepare(`PRAGMA table_info(schedules)`).all();
    const unitIdCol = scheduleInfo.find(c => c.name === 'unitId');
    
    // If unitId exists and has type INTEGER, we need to migrate
    if (unitIdCol && unitIdCol.type === 'INTEGER') {
      console.log('[DB] Migration: Converting schedules.unitId from INTEGER to TEXT for station system');
      
      // SQLite doesn't support ALTER COLUMN, so we use the recreate approach
      db.exec(`
        BEGIN TRANSACTION;
        
        -- Create new schedules table with TEXT unitId
        CREATE TABLE schedules_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scheduleId TEXT UNIQUE,
          customer TEXT NOT NULL,
          phone TEXT,
          unitId TEXT,
          unitName TEXT,
          scheduledDate TEXT NOT NULL,
          scheduledTime TEXT,
          scheduledEndDate TEXT,
          scheduledEndTime TEXT,
          duration INTEGER,
          note TEXT,
          status TEXT DEFAULT 'pending',
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
        
        -- Copy data, converting INTEGER unitId to TEXT
        INSERT INTO schedules_new 
        SELECT id, scheduleId, customer, phone, 
               CASE WHEN unitId IS NOT NULL THEN CAST(unitId AS TEXT) ELSE NULL END,
               unitName, scheduledDate, scheduledTime, scheduledEndDate, scheduledEndTime,
               duration, note, status, created_at
        FROM schedules;
        
        -- Drop old table
        DROP TABLE schedules;
        
        -- Rename new table
        ALTER TABLE schedules_new RENAME TO schedules;
        
        COMMIT;
      `);
      
      console.log('[DB] Migration: schedules.unitId converted to TEXT successfully');
    }
  } catch (e) {
    console.error('[DB] Migration error for schedules unitId column:', e.message);
  }
}

// NOTE: Removed station_id/station_name migration - using camelCase unitId/unitName consistently

// Migration: Add phone column to transactions table if not exists
if (db) {
  try {
    const txInfo = db.prepare(`PRAGMA table_info(transactions)`).all();
    const hasPhone = txInfo.find(c => c.name === 'phone');
    if (!hasPhone) {
      db.prepare(`ALTER TABLE transactions ADD COLUMN phone TEXT`).run();
      console.log('[DB] Migration: Added phone column to transactions');
    }
  } catch (e) {
    console.error('[DB] Migration error for transactions phone column:', e.message);
  }
}

// Migration: Add runtime tracking columns to inventory_pairings for Dashboard integration
if (db) {
  try {
    const pairingsInfo = db.prepare(`PRAGMA table_info(inventory_pairings)`).all();
    
    // Add active column if not exists
    const hasActive = pairingsInfo.find(c => c.name === 'active');
    if (!hasActive) {
      db.prepare(`ALTER TABLE inventory_pairings ADD COLUMN active INTEGER DEFAULT 0`).run();
      console.log('[DB] Migration: Added active column to inventory_pairings');
    }
    
    // Add start_time column if not exists
    const hasStartTime = pairingsInfo.find(c => c.name === 'start_time');
    if (!hasStartTime) {
      db.prepare(`ALTER TABLE inventory_pairings ADD COLUMN start_time INTEGER`).run();
      console.log('[DB] Migration: Added start_time column to inventory_pairings');
    }
    
    // Add current_customer column if not exists
    const hasCustomer = pairingsInfo.find(c => c.name === 'current_customer');
    if (!hasCustomer) {
      db.prepare(`ALTER TABLE inventory_pairings ADD COLUMN current_customer TEXT`).run();
      console.log('[DB] Migration: Added current_customer column to inventory_pairings');
    }
    
    // Add current_duration column if not exists
    const hasDuration = pairingsInfo.find(c => c.name === 'current_duration');
    if (!hasDuration) {
      db.prepare(`ALTER TABLE inventory_pairings ADD COLUMN current_duration INTEGER DEFAULT 0`).run();
      console.log('[DB] Migration: Added current_duration column to inventory_pairings');
    }
    
    // Add current_note column if not exists
    const hasNote = pairingsInfo.find(c => c.name === 'current_note');
    if (!hasNote) {
      db.prepare(`ALTER TABLE inventory_pairings ADD COLUMN current_note TEXT`).run();
      console.log('[DB] Migration: Added current_note column to inventory_pairings');
    }
    
    // Add linked_schedule_id column if not exists
    const hasLinkedSchedule = pairingsInfo.find(c => c.name === 'linked_schedule_id');
    if (!hasLinkedSchedule) {
      db.prepare(`ALTER TABLE inventory_pairings ADD COLUMN linked_schedule_id INTEGER`).run();
      console.log('[DB] Migration: Added linked_schedule_id column to inventory_pairings');
    }
    
    console.log('[DB] Migration: Station runtime tracking columns ready');
  } catch (e) {
    console.error('[DB] Migration error for station runtime columns:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO CLEANUP: Midnight cleanup system for Fly.io
// 1. Delete completed schedules
// 2. Delete cancelled schedules from trash after 7 days
// 3. Delete transactions & expenses from trash after 7 days
// Handles Fly.io auto-off: cleanup runs on startup if missed
// ═══════════════════════════════════════════════════════════════
const CLEANUP_SETTINGS_KEY = 'lastCompletedCleanup';
const TRASH_CLEANUP_SETTINGS_KEY = 'lastTrashCleanup';

function getWIBDate(date = new Date()) {
  const wibOffset = 7 * 60 * 60 * 1000;
  return new Date(date.getTime() + wibOffset);
}

function formatWIBDate(date) {
  return date.toISOString().split('T')[0];
}

function cleanupCompletedSchedules() {
  try {
    const today = formatWIBDate(getWIBDate());

    // Delete completed schedules
    const result = db.prepare(`
      DELETE FROM schedules 
      WHERE status = 'completed'
    `).run();

    // Save last cleanup timestamp
    updateSetting(CLEANUP_SETTINGS_KEY, Date.now());

    if (result.changes > 0) {
      console.log(`[Cleanup] Deleted ${result.changes} completed schedule(s) at ${today} WIB`);
    } else {
      console.log(`[Cleanup] No completed schedules to delete at ${today} WIB`);
    }
  } catch (error) {
    console.error('[Cleanup] Error deleting completed schedules:', error.message);
  }
}

function cleanupTrashSchedules() {
  try {
    const today = formatWIBDate(getWIBDate());
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days in milliseconds

    // Delete cancelled schedules older than 7 days from deletion_logs
    // Note: Schedules are stored in deletion_logs when deleted
    const result = db.prepare(`
      DELETE FROM deletion_logs 
      WHERE recordType = 'schedule'
      AND deletedAt < ?
    `).run(sevenDaysAgo);

    // Save last trash cleanup timestamp
    updateSetting(TRASH_CLEANUP_SETTINGS_KEY, Date.now());

    if (result.changes > 0) {
      console.log(`[Trash Cleanup] Deleted ${result.changes} cancelled schedule(s) older than 7 days at ${today} WIB`);
    } else {
      console.log(`[Trash Cleanup] No old cancelled schedules to delete at ${today} WIB`);
    }
  } catch (error) {
    console.error('[Trash Cleanup] Error deleting old cancelled schedules:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO CLEANUP: Delete old transaction and expense trash after 7 days
// ═══════════════════════════════════════════════════════════════
const TRASH_TX_EXPENSE_CLEANUP_KEY = 'lastTrashTxExpenseCleanup';

function cleanupTrashTransactionsAndExpenses() {
  try {
    const today = formatWIBDate(getWIBDate());
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days in milliseconds

    // Delete old transaction trash (recordType = 'transaction')
    const txResult = db.prepare(`
      DELETE FROM deletion_logs 
      WHERE recordType = 'transaction'
      AND deletedAt < ?
    `).run(sevenDaysAgo);

    // Delete old expense trash (recordType = 'expense')
    const expResult = db.prepare(`
      DELETE FROM deletion_logs 
      WHERE recordType = 'expense'
      AND deletedAt < ?
    `).run(sevenDaysAgo);

    const totalDeleted = (txResult.changes || 0) + (expResult.changes || 0);

    // Save last cleanup timestamp
    updateSetting(TRASH_TX_EXPENSE_CLEANUP_KEY, Date.now());

    if (totalDeleted > 0) {
      console.log(`[Trash Cleanup] Deleted ${txResult.changes || 0} transaction(s) and ${expResult.changes || 0} expense(s) older than 7 days at ${today} WIB`);
    } else {
      console.log(`[Trash Cleanup] No old transactions or expenses to delete at ${today} WIB`);
    }
  } catch (error) {
    console.error('[Trash Cleanup] Error deleting old transactions/expenses:', error.message);
  }
}

function shouldRunTrashTxExpenseCleanup() {
  const settings = getSettings();
  const lastCleanup = settings[TRASH_TX_EXPENSE_CLEANUP_KEY] || 0;
  const now = Date.now();
  const wibNow = getWIBDate(new Date(now));
  const wibLast = getWIBDate(new Date(lastCleanup));

  // Get midnight timestamps for comparison
  const todayMidnight = new Date(wibNow);
  todayMidnight.setHours(0, 0, 0, 0);

  const lastCleanupDay = new Date(wibLast);
  lastCleanupDay.setHours(0, 0, 0, 0);

  // Run cleanup if:
  // 1. Never run before (lastCleanup === 0)
  // 2. Last cleanup was on a different day
  return lastCleanup === 0 || todayMidnight > lastCleanupDay;
}

function shouldRunCleanup() {
  const settings = getSettings();
  const lastCleanup = settings[CLEANUP_SETTINGS_KEY] || 0;
  const now = Date.now();
  const wibNow = getWIBDate(new Date(now));
  const wibLast = getWIBDate(new Date(lastCleanup));

  // Get midnight timestamps for comparison
  const todayMidnight = new Date(wibNow);
  todayMidnight.setHours(0, 0, 0, 0);

  const lastCleanupDay = new Date(wibLast);
  lastCleanupDay.setHours(0, 0, 0, 0);

  // Run cleanup if:
  // 1. Never run before (lastCleanup === 0)
  // 2. Last cleanup was on a different day
  return lastCleanup === 0 || todayMidnight > lastCleanupDay;
}

function shouldRunTrashCleanup() {
  const settings = getSettings();
  const lastTrashCleanup = settings[TRASH_CLEANUP_SETTINGS_KEY] || 0;
  const now = Date.now();
  const wibNow = getWIBDate(new Date(now));
  const wibLast = getWIBDate(new Date(lastTrashCleanup));

  // Get midnight timestamps for comparison
  const todayMidnight = new Date(wibNow);
  todayMidnight.setHours(0, 0, 0, 0);

  const lastCleanupDay = new Date(wibLast);
  lastCleanupDay.setHours(0, 0, 0, 0);

  // Run cleanup if:
  // 1. Never run before (lastTrashCleanup === 0)
  // 2. Last cleanup was on a different day
  return lastTrashCleanup === 0 || todayMidnight > lastCleanupDay;
}

// ════════════════════════════════════════════════════════════════
// INVENTORY USAGE CALCULATION (Auto from schedules)
// ════════════════════════════════════════════════════════════════
function calculateInventoryUsage() {
  try {
    const today = getWIBDateISO();
    
    // Get all pairings with their linked units
    const pairings = db.prepare(`
      SELECT p.id as pairing_id, u.id as unit_id
      FROM inventory_pairings p
      LEFT JOIN unit_pairings up ON p.id = up.pairing_id AND up.is_active = 1
      LEFT JOIN units u ON up.unit_id = u.id
    `).all();
    
    // For each pairing, get the konsol item and calculate usage
    for (const pairing of pairings) {
      if (!pairing.unit_id) continue;
      
      // Get the konsol item in this pairing
      const konsolItem = db.prepare(`
        SELECT item_id FROM inventory_pairing_items 
        WHERE pairing_id = ? AND role = 'konsol' AND item_id IN (SELECT id FROM inventory_items WHERE is_active = 1)
        LIMIT 1
      `).get(pairing.pairing_id);
      
      if (!konsolItem) continue;
      
      // Get all completed schedules for this unit today
      const schedules = db.prepare(`
        SELECT s.duration, s.scheduledDate
        FROM completed_schedules c
        JOIN schedules s ON c.scheduleId = s.scheduleId
        WHERE s.unitId = ? AND s.scheduledDate = ?
      `).all(pairing.unit_id, today);
      
      // Also get active sessions (rentals) for today
      const activeSession = db.prepare(`
        SELECT duration FROM units WHERE id = ? AND active = 1
      `).get(pairing.unit_id);
      
      let totalHours = 0;
      
      // Sum completed schedules
      for (const sched of schedules) {
        if (sched.duration) {
          totalHours += sched.duration / 60; // Convert minutes to hours
        }
      }
      
      // Add active session time (convert minutes to hours)
      if (activeSession && activeSession.duration) {
        totalHours += activeSession.duration / 60;
      }
      
      // Upsert usage record
      const existing = db.prepare(`
        SELECT id FROM inventory_usage 
        WHERE item_id = ? AND date = ? AND source = 'auto'
      `).get(konsolItem.item_id, today);
      
      if (existing) {
        db.prepare(`
          UPDATE inventory_usage 
          SET hours_used = ?, pairing_id = ?, created_at = ?
          WHERE id = ?
        `).run(totalHours, pairing.pairing_id, Date.now(), existing.id);
      } else {
        db.prepare(`
          INSERT INTO inventory_usage (item_id, date, hours_used, source, pairing_id, created_at)
          VALUES (?, ?, ?, 'auto', ?, ?)
        `).run(konsolItem.item_id, today, totalHours, pairing.pairing_id, Date.now());
      }
      
      // Also update usage for paired accessories (same hours as konsol)
      const accessories = db.prepare(`
        SELECT item_id, role FROM inventory_pairing_items 
        WHERE pairing_id = ? AND role != 'konsol' AND item_id IN (SELECT id FROM inventory_items WHERE is_active = 1)
      `).all(pairing.pairing_id);
      
      for (const acc of accessories) {
        const existingAcc = db.prepare(`
          SELECT id FROM inventory_usage 
          WHERE item_id = ? AND date = ? AND source = 'auto'
        `).get(acc.item_id, today);
        
        if (existingAcc) {
          db.prepare(`
            UPDATE inventory_usage 
            SET hours_used = ?, pairing_id = ?, created_at = ?
            WHERE id = ?
          `).run(totalHours, pairing.pairing_id, Date.now(), existingAcc.id);
        } else {
          db.prepare(`
            INSERT INTO inventory_usage (item_id, date, hours_used, source, pairing_id, created_at)
            VALUES (?, ?, ?, 'auto', ?, ?)
          `).run(acc.item_id, today, totalHours, pairing.pairing_id, Date.now());
        }
      }
    }
    
    console.log(`[Inventory] Usage calculated for ${today}`);
  } catch (error) {
    console.error('[Inventory] Error calculating usage:', error.message);
  }
}

function runAllCleanups() {
  // Run all cleanup functions
  cleanupCompletedSchedules();
  cleanupTrashSchedules();
  cleanupTrashTransactionsAndExpenses();
  // Calculate inventory usage daily
  calculateInventoryUsage();
}

function scheduleMidnightCleanup() {
  // Check if we missed cleanup while machine was off (Fly.io auto-off resilience)
  const missedCompleted = shouldRunCleanup();
  const missedTrash = shouldRunTrashCleanup();
  const missedTrashTxExpense = shouldRunTrashTxExpenseCleanup();

  if (missedCompleted || missedTrash || missedTrashTxExpense) {
    console.log('[Cleanup] Running missed cleanup on startup...');
    runAllCleanups();
  }

  const wibNow = getWIBDate();

  // Calculate time until next midnight (00:00:00) in WIB
  const tomorrow = new Date(wibNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const msUntilMidnight = tomorrow - wibNow;

  console.log(`[Cleanup] Next scheduled cleanup in ${Math.floor(msUntilMidnight / 1000 / 60)} minutes (${formatWIBDate(tomorrow)} WIB)`);

  // Schedule cleanup at midnight
  setTimeout(() => {
    runAllCleanups();
    // Then schedule daily cleanup every 24 hours
    setInterval(runAllCleanups, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

// Start cleanup scheduler if database is ready
if (db) {
  scheduleMidnightCleanup();
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
  // ═══════════════════════════════════════════════════════════════
  // FULL BACKUP EXPORT - SEMUA DATA DI DATABASE SELALU DI-INCLUDE
  // ═══════════════════════════════════════════════════════════════
  
  const data = {
    settings: getSettings(),
    units: db.prepare('SELECT * FROM units ORDER BY id').all(),
    exportMetadata: {
      exportedAt: new Date().toISOString(),
      timezone: 'WIB (UTC+7)',
      type: 'full-backup',
      description: 'Seluruh data di database aplikasi'
    }
  };

  // Include schedules (jadwal) - always included in backup
  data.schedules = db.prepare(`
    SELECT s.*, u.name as unitName
    FROM schedules s
    LEFT JOIN units u ON s.unitId = u.id
    ORDER BY s.scheduledDate DESC, s.scheduledTime DESC
  `).all();

  // Include completed schedules
  data.completedSchedules = db.prepare(`
    SELECT c.*, s.customer, s.phone, s.unitId, u.name as unitName
    FROM completed_schedules c
    LEFT JOIN schedules s ON c.scheduleId = s.id
    LEFT JOIN units u ON s.unitId = u.id
    ORDER BY c.completedAt DESC
  `).all();

  // Include deleted/cancelled schedules
  data.deletedSchedules = db.prepare(`
    SELECT d.*, s.customer, s.phone, s.unitId, u.name as unitName
    FROM deleted_schedules d
    LEFT JOIN schedules s ON d.scheduleId = s.id
    LEFT JOIN units u ON s.unitId = u.id
    ORDER BY d.deletedAt DESC
  `).all();

  // ═══════════════════════════════════════════════════════════════
  // DATA UTAMA - SELALU DI-INCLUDE
  // ═══════════════════════════════════════════════════════════════
  
  // Include transactions
  data.transactions = db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM edit_logs WHERE transactionId = t.id) as editCount 
    FROM transactions t 
    ORDER BY t.created_at DESC
  `).all();

  // Include expenses
  data.expenses = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM edit_logs WHERE expenseId = e.id) as editCount 
    FROM expenses e 
    ORDER BY e.created_at DESC
  `).all();

  // ═══════════════════════════════════════════════════════════════
  // EDIT HISTORY - SELALU DI-INCLUDE DALAM BACKUP
  // ═══════════════════════════════════════════════════════════════
  
  // Edit history untuk transaksi pendapatan (selalu include)
  data.transactionsEditHistory = db.prepare(`
    SELECT el.*, t.id as transactionId, t.unitName, t.customer
    FROM edit_logs el
    LEFT JOIN transactions t ON el.transactionId = t.id
    WHERE el.transactionId IS NOT NULL
    ORDER BY el.editedAt DESC
  `).all();

  // Edit history untuk transaksi pengeluaran (selalu include)
  data.expensesEditHistory = db.prepare(`
    SELECT el.*, e.id as expenseId, e.item, e.amount
    FROM edit_logs el
    LEFT JOIN expenses e ON el.expenseId = e.id
    WHERE el.expenseId IS NOT NULL
    ORDER BY el.editedAt DESC
  `).all();

  // Edit history untuk jadwal (selalu include)
  data.schedulesEditHistory = db.prepare(`
    SELECT el.*, s.id as scheduleId, s.customer, s.unitId
    FROM edit_logs el
    LEFT JOIN schedules s ON el.scheduleId = s.id
    WHERE el.scheduleId IS NOT NULL
    ORDER BY el.editedAt DESC
  `).all();

  // ═══════════════════════════════════════════════════════════════
  // GHOST RECORDS - SELALU DI-INCLUDE DALAM BACKUP (Minimal Data)
  // Hanya TX ID, waktu dihapus/dibatalkan, dan alasan
  // ═══════════════════════════════════════════════════════════════
  
  // Ghost records untuk data yang sudah auto clean-up
  // Data sudah dihapus = transaksi pendapatan & pengeluaran
  // Data dibatalkan = jadwal
  data.deletedRecords = db.prepare(`
    SELECT 
      recordType,
      recordId as txId,
      deletedAt as waktuDihapus,
      deleteReason as alasan
    FROM deletion_logs
    WHERE recordType IN ('transaction', 'expense', 'schedule')
    ORDER BY deletedAt DESC
  `).all();

  res.json(data);
});

app.put('/api/db', requireAuth, (req, res) => {
  const { settings: newSettings, units: newUnits, transactions: newTx, expenses: newExp, schedules: newSchedules, completedSchedules: newCompleted, deletedSchedules: newDeleted } = req.body;
  
  // Validate
  if (!newSettings || !Array.isArray(newUnits) || !Array.isArray(newTx)) {
    return res.status(400).json({ error: 'Invalid data format' });
  }
  
  // Transaction for atomic update
  const insertUnits = db.prepare('INSERT OR REPLACE INTO units (id, name, active, startTime, customer, duration, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertTx = db.prepare('INSERT OR REPLACE INTO transactions (id, unitId, unitName, customer, startTime, endTime, durationMin, paid, payment, note, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertExp = db.prepare('INSERT OR REPLACE INTO expenses (id, item, amount, date, note) VALUES (?, ?, ?, ?, ?)');
  const insertSchedule = db.prepare('INSERT OR REPLACE INTO schedules (id, unitId, customerName, phone, scheduledDate, scheduledTime, duration, scheduledEndDate, scheduledEndTime, note, active, createdAt, editCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertCompleted = db.prepare('INSERT OR REPLACE INTO completed_schedules (id, scheduleId, scheduledDate, scheduledTime, duration, completedAt) VALUES (?, ?, ?, ?, ?, ?)');
  const insertDeleted = db.prepare('INSERT OR REPLACE INTO deleted_schedules (id, scheduleId, scheduledDate, scheduledTime, duration, reason, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  
  db.transaction(() => {
    // Clear and re-insert
    db.prepare('DELETE FROM units').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM expenses').run();
    db.prepare('DELETE FROM schedules').run();
    db.prepare('DELETE FROM completed_schedules').run();
    db.prepare('DELETE FROM deleted_schedules').run();
    
    newUnits.forEach(u => insertUnits.run(u.id, u.name, u.active ? 1 : 0, u.startTime, u.customer, u.duration, u.note));
    newTx.forEach(t => insertTx.run(t.id, t.unitId, t.unitName, t.customer, t.startTime, t.endTime, t.durationMin, t.paid, t.payment, t.note, t.date));
    (newExp || []).forEach(e => insertExp.run(e.id, e.item, e.amount, e.date, e.note));
    
    // Restore schedules data if present in backup
    if (newSchedules && Array.isArray(newSchedules)) {
      newSchedules.forEach(s => insertSchedule.run(s.id, s.unitId, s.customer || s.customerName, s.phone, s.scheduledDate, s.scheduledTime, s.duration, s.scheduledEndDate, s.scheduledEndTime, s.note, s.active ? 1 : 0, s.createdAt, s.editCount || 0));
    }
    if (newCompleted && Array.isArray(newCompleted)) {
      newCompleted.forEach(c => insertCompleted.run(c.id, c.scheduleId, c.scheduledDate, c.scheduledTime, c.duration, c.completedAt));
    }
    if (newDeleted && Array.isArray(newDeleted)) {
      newDeleted.forEach(d => insertDeleted.run(d.id, d.scheduleId, d.scheduledDate, d.scheduledTime, d.duration, d.reason, d.deletedAt));
    }
    
    // Update settings
    Object.entries(newSettings).forEach(([key, value]) => updateSetting(key, value));
  })();
  
  res.json({ 
    ok: true, 
    counts: {
      units: newUnits.length,
      transactions: newTx.length,
      expenses: (newExp || []).length,
      schedules: (newSchedules || []).length,
      completedSchedules: (newCompleted || []).length,
      deletedSchedules: (newDeleted || []).length
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
  const durationMinutes = parseInt(duration) || 0;

  // Conflict detection: Check if there are pending schedules that overlap with this rental
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  // Calculate end time of this new rental
  const rentalEndTime = new Date(startTime + durationMinutes * 60000);
  const rentalEndDate = rentalEndTime.toISOString().split('T')[0];
  const rentalEndTimeStr = String(rentalEndTime.getHours()).padStart(2, '0') + ':' + String(rentalEndTime.getMinutes()).padStart(2, '0');

  // Find pending schedules for this unit that would overlap
  const pendingSchedules = db.prepare(
    `SELECT * FROM schedules
     WHERE unitId = ? AND status = 'pending'
     AND scheduledDate >= ?`
  ).all(id, today);

  for (const schedule of pendingSchedules) {
    if (!schedule.scheduledTime) continue;

    // Parse schedule datetime range with explicit timezone +07:00 (WIB)
    let scheduleStart = new Date(`${schedule.scheduledDate}T${schedule.scheduledTime}:00+07:00`);
    let scheduleEnd;

    if (schedule.scheduledEndDate && schedule.scheduledEndTime) {
      scheduleEnd = new Date(`${schedule.scheduledEndDate}T${schedule.scheduledEndTime}:00+07:00`);
    } else if (schedule.duration) {
      scheduleEnd = new Date(scheduleStart.getTime() + schedule.duration * 60000);
    } else {
      continue;
    }

    // Check overlap: (StartA < EndB) && (EndA > StartB)
    // startTime is Date.now() (UTC timestamp), convert schedule times to UTC for comparison
    const newRentalEnd = startTime + (durationMinutes * 60000);
    const scheduleStartUTC = scheduleStart.getTime();
    const scheduleEndUTC = scheduleEnd.getTime();
    const overlap = (startTime < scheduleEndUTC) && (newRentalEnd > scheduleStartUTC);

    if (overlap) {
      const scheduleEndStr = schedule.scheduledEndTime ||
        String(scheduleEnd.getHours()).padStart(2, '0') + ':' +
        String(scheduleEnd.getMinutes()).padStart(2, '0');
      
      // Cek apakah booking sudah masuk waktunya (sekarang berada dalam rentang booking)
      const nowTimestamp = Date.now();
      const isCurrentTimeInBooking = (nowTimestamp >= scheduleStartUTC) && (nowTimestamp <= scheduleEndUTC);
      
      if (isCurrentTimeInBooking) {
        // Booking sudah masuk waktu - user bisa membatalkan untuk walk-in customer
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
        const bookingStartStr = new Date(scheduleStartUTC).toLocaleTimeString('id-ID', timeOptions);
        const bookingEndStr = new Date(scheduleEndUTC).toLocaleTimeString('id-ID', timeOptions);
        
        return res.status(409).json({
          ok: false,
          requiresCancellation: true,
          conflictType: 'active_booking',
          schedule: {
            id: schedule.id,
            scheduleId: schedule.scheduleId,
            customer: schedule.customer,
            phone: schedule.phone,
            scheduledDate: schedule.scheduledDate,
            scheduledTime: schedule.scheduledTime,
            scheduledEndDate: schedule.scheduledEndDate || schedule.scheduledDate,
            scheduledEndTime: scheduleEndStr,
            date: schedule.scheduledDate,
            startTime: schedule.scheduledTime,
            endTime: scheduleEndStr,
            startTimestamp: scheduleStartUTC,
            endTimestamp: scheduleEndUTC,
            unitName: schedule.unitName,
            note: schedule.note,
            status: schedule.status || 'pending',
            duration: schedule.duration
          },
          message: `Unit memiliki booking aktif dari <strong>${schedule.customer}</strong> (<strong>${bookingStartStr}-${bookingEndStr}</strong>). Aktifkan unit akan membatalkan booking ini.`,
          error: `Unit memiliki booking aktif dari ${schedule.customer} pada ${schedule.scheduledDate} pukul ${schedule.scheduledTime}-${scheduleEndStr}. Aktifkan unit akan membatalkan booking ini.`
        });
      } else {
        // Booking di masa depan - tidak bisa aktivasi
        return res.status(409).json({
          ok: false,
          error: `Tidak dapat mengaktifkan unit. Ada booking dari ${schedule.customer} pada ${schedule.scheduledDate} pukul ${schedule.scheduledTime}-${scheduleEndStr}. Silakan pilih waktu lain atau batalkan booking terlebih dahulu.`
        });
      }
    }
  }
  
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
  
  // ═══ INVENTORY USAGE TRACKING ═══
  // Track usage hours for paired inventory items
  const hoursUsed = elMin / 60;
  if (hoursUsed > 0) {
    try {
      // Find active pairing for this unit
      const unitPairing = db.prepare(`
        SELECT pairing_id FROM unit_pairings 
        WHERE unit_id = ? AND is_active = 1 
        ORDER BY assigned_date DESC LIMIT 1
      `).get(id);
      
      if (unitPairing) {
        // Get all items in this pairing
        const pairingItems = db.prepare(`
          SELECT pi.item_id, pi.role
          FROM inventory_pairing_items pi
          JOIN inventory_items i ON pi.item_id = i.id
          WHERE pi.pairing_id = ? AND i.is_active = 1
        `).all(unitPairing.pairing_id);
        
        // Record usage for each item
        const today = getWIBDateISO();
        pairingItems.forEach(item => {
          // Check if usage record exists for today
          const existing = db.prepare(`
            SELECT id, hours_used FROM inventory_usage 
            WHERE item_id = ? AND date = ? AND pairing_id = ?
          `).get(item.item_id, today, unitPairing.pairing_id);
          
          if (existing) {
            // Update existing record
            db.prepare(`
              UPDATE inventory_usage 
              SET hours_used = hours_used + ? 
              WHERE id = ?
            `).run(hoursUsed, existing.id);
          } else {
            // Create new record
            db.prepare(`
              INSERT INTO inventory_usage (item_id, date, hours_used, source, pairing_id)
              VALUES (?, ?, ?, 'auto', ?)
            `).run(item.item_id, today, hoursUsed, unitPairing.pairing_id);
          }
        });
        
        console.log(`[Inventory] Tracked ${hoursUsed.toFixed(2)} hours for ${pairingItems.length} items in pairing ${unitPairing.pairing_id}`);
      }
    } catch (e) {
      console.error('[Inventory] Error tracking usage:', e.message);
      // Don't fail the transaction if usage tracking fails
    }
  }
  
  res.json({ ok: true, tx });
});

// ═══════════════════════════════════════════════════════════════
// STATION OPERATIONS (Dashboard Integration)
// These endpoints mirror the unit operations but work with inventory_pairings
// ═══════════════════════════════════════════════════════════════

// Start a station session (similar to starting a unit)
app.post('/api/stations/:id/start', requireAuth, (req, res) => {
  const id = req.params.id;
  const station = db.prepare('SELECT * FROM inventory_pairings WHERE id = ?').get(id);
  if (!station) return res.status(404).json({ error: 'Stasiun tidak ditemukan' });
  if (station.active) return res.status(400).json({ error: 'Stasiun sudah aktif' });

  // Validate station has all required items
  const stationItems = db.prepare(`
    SELECT i.category, pi.role FROM inventory_pairing_items pi
    JOIN inventory_items i ON pi.item_id = i.id
    WHERE pi.pairing_id = ?
  `).all(id);
  
  const itemCounts = {
    ps3: stationItems.filter(i => i.category === 'ps3' || i.category === 'konsol').length,
    tv: stationItems.filter(i => i.category === 'tv').length,
    stik: stationItems.filter(i => i.category === 'stik').length,
    usb: stationItems.filter(i => i.category === 'usb' || i.category === 'charger' || i.category === 'kabel_usb' ||
                          (i.category === 'kabel_power' && i.role && i.role.startsWith('charger'))).length,
    hdmi: stationItems.filter(i => i.category === 'hdmi' || i.category === 'kabel_hdmi').length,
    plug: stationItems.filter(i => i.category === 'plug' || 
                          (i.category === 'kabel_power' && (!i.role || i.role === 'power'))).length
  };
  
  const validationErrors = [];
  if (itemCounts.ps3 !== 1) validationErrors.push(`Konsol PS3: ${itemCounts.ps3}/1 (wajib tepat 1)`);
  if (itemCounts.tv !== 1) validationErrors.push(`TV: ${itemCounts.tv}/1 (wajib tepat 1)`);
  if (itemCounts.stik < 1) validationErrors.push(`Stik: ${itemCounts.stik}/1 (minimal 1)`);
  if (itemCounts.usb < 1) validationErrors.push(`Kabel Charger: ${itemCounts.usb}/1 (minimal 1)`);
  if (itemCounts.hdmi !== 1) validationErrors.push(`Kabel HDMI: ${itemCounts.hdmi}/1 (wajib tepat 1)`);
  if (itemCounts.plug !== 1) validationErrors.push(`Kabel Power: ${itemCounts.plug}/1 (wajib tepat 1)`);
  
  if (validationErrors.length > 0) {
    return res.status(400).json({
      ok: false,
      error: 'Stasiun belum siap digunakan',
      validationErrors: validationErrors,
      message: 'Stasiun tidak dapat digunakan karena item belum lengkap: ' + validationErrors.join(', ')
    });
  }

  const { customer = '', duration = 0, note = '', linkedScheduleId = null } = req.body;
  const startTime = Date.now();
  const durationMinutes = parseInt(duration) || 0;

  // Conflict detection: Check if there are pending schedules for this station
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Calculate end time of this new rental
  const rentalEndTime = new Date(startTime + durationMinutes * 60000);
  const rentalEndDate = rentalEndTime.toISOString().split('T')[0];

  // Find pending schedules for this station that would overlap
  const pendingSchedules = db.prepare(
    `SELECT * FROM schedules
     WHERE unitId = ? AND status = 'pending'
     AND scheduledDate >= ?`
  ).all(id, today);

  for (const schedule of pendingSchedules) {
    if (!schedule.scheduledTime) continue;

    // Parse schedule datetime range with explicit timezone +07:00 (WIB)
    let scheduleStart = new Date(`${schedule.scheduledDate}T${schedule.scheduledTime}:00+07:00`);
    let scheduleEnd;

    if (schedule.scheduledEndDate && schedule.scheduledEndTime) {
      scheduleEnd = new Date(`${schedule.scheduledEndDate}T${schedule.scheduledEndTime}:00+07:00`);
    } else if (schedule.duration) {
      scheduleEnd = new Date(scheduleStart.getTime() + schedule.duration * 60000);
    } else {
      continue;
    }

    // Check overlap: (StartA < EndB) && (EndA > StartB)
    const newRentalEnd = startTime + (durationMinutes * 60000);
    const scheduleStartUTC = scheduleStart.getTime();
    const scheduleEndUTC = scheduleEnd.getTime();
    const overlap = (startTime < scheduleEndUTC) && (newRentalEnd > scheduleStartUTC);

    if (overlap) {
      const scheduleEndStr = schedule.scheduledEndTime ||
        String(scheduleEnd.getHours()).padStart(2, '0') + ':' +
        String(scheduleEnd.getMinutes()).padStart(2, '0');

      // Cek apakah booking sudah masuk waktunya
      const nowTimestamp = Date.now();
      const isCurrentTimeInBooking = (nowTimestamp >= scheduleStartUTC) && (nowTimestamp <= scheduleEndUTC);

      if (isCurrentTimeInBooking) {
        // Booking sudah masuk waktu - user bisa membatalkan untuk walk-in customer
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
        const bookingStartStr = new Date(scheduleStartUTC).toLocaleTimeString('id-ID', timeOptions);
        const bookingEndStr = new Date(scheduleEndUTC).toLocaleTimeString('id-ID', timeOptions);

        return res.status(409).json({
          ok: false,
          requiresCancellation: true,
          conflictType: 'active_booking',
          schedule: {
            id: schedule.id,
            scheduleId: schedule.scheduleId,
            customer: schedule.customer,
            phone: schedule.phone,
            scheduledDate: schedule.scheduledDate,
            scheduledTime: schedule.scheduledTime,
            scheduledEndDate: schedule.scheduledEndDate || schedule.scheduledDate,
            scheduledEndTime: scheduleEndStr,
            date: schedule.scheduledDate,
            startTime: schedule.scheduledTime,
            endTime: scheduleEndStr,
            startTimestamp: scheduleStartUTC,
            endTimestamp: scheduleEndUTC,
            unitId: schedule.unitId,
            unitName: schedule.unitName,
            note: schedule.note,
            status: schedule.status || 'pending',
            duration: schedule.duration
          },
          message: `Stasiun memiliki booking aktif dari <strong>${schedule.customer}</strong> (<strong>${bookingStartStr}-${bookingEndStr}</strong>). Aktifkan stasiun akan membatalkan booking ini.`,
          error: `Stasiun memiliki booking aktif dari ${schedule.customer} pada ${schedule.scheduledDate} pukul ${schedule.scheduledTime}-${scheduleEndStr}. Aktifkan stasiun akan membatalkan booking ini.`
        });
      } else {
        // Booking di masa depan - tidak bisa aktivasi
        return res.status(409).json({
          ok: false,
          error: `Tidak dapat mengaktifkan stasiun. Ada booking dari ${schedule.customer} pada ${schedule.scheduledDate} pukul ${schedule.scheduledTime}-${scheduleEndStr}. Silakan pilih waktu lain atau batalkan booking terlebih dahulu.`
        });
      }
    }
  }

  // Update station with active session data
  db.prepare(`UPDATE inventory_pairings 
    SET active = 1, start_time = ?, current_customer = ?, current_duration = ?, current_note = ?, linked_schedule_id = ? 
    WHERE id = ?`)
    .run(startTime, customer, duration, note, linkedScheduleId, id);

  // If linked to a schedule, update schedule status to 'running'
  if (linkedScheduleId) {
    try {
      db.prepare('UPDATE schedules SET status = ?, unitId = ?, unitName = ? WHERE id = ?')
        .run('running', id, station.name, linkedScheduleId);
      console.log(`[Schedule] Linked schedule ${linkedScheduleId} started on station ${id}`);
    } catch (e) {
      console.error('[Schedule] Error updating schedule status:', e.message);
    }
  }

  res.json({ 
    ok: true, 
    station: db.prepare('SELECT *, active as active, start_time as startTime, current_customer as customer, current_duration as duration, current_note as note, linked_schedule_id as linkedScheduleId FROM inventory_pairings WHERE id = ?').get(id)
  });
});

// Stop a station session (similar to stopping a unit)
app.post('/api/stations/:id/stop', requireAuth, (req, res) => {
  const id = req.params.id;
  const station = db.prepare('SELECT * FROM inventory_pairings WHERE id = ?').get(id);
  if (!station) return res.status(404).json({ error: 'Stasiun tidak ditemukan' });
  if (!station.active) return res.status(400).json({ error: 'Stasiun tidak aktif' });

  const settings = getSettings();
  const elMin = Math.floor((Date.now() - station.start_time) / 60000);
  const cost = Math.round((elMin / 60) * settings.ratePerHour);
  const { paid = cost, payment = 'cash' } = req.body;

  const dateKey = getWIBDateISO();

  const tx = {
    id: generateRevenueId(),
    unitId: id,
    unitName: station.name,
    customer: station.current_customer,
    startTime: station.start_time,
    endTime: Date.now(),
    durationMin: elMin,
    paid: paid,
    payment: payment,
    note: station.current_note,
    date: dateKey
  };

  // Insert transaction - using unitId/unitName consistently for station data
  db.prepare(`INSERT INTO transactions 
    (id, unitId, unitName, customer, startTime, endTime, durationMin, paid, payment, note, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(tx.id, tx.unitId, tx.unitName, tx.customer, tx.startTime, tx.endTime, tx.durationMin, tx.paid, tx.payment, tx.note, tx.date);

  // If linked to a schedule, update schedule status to 'completed'
  if (station.linked_schedule_id) {
    try {
      db.prepare('UPDATE schedules SET status = ? WHERE id = ?')
        .run('completed', station.linked_schedule_id);
      console.log(`[Schedule] Linked schedule ${station.linked_schedule_id} marked as completed`);
    } catch (e) {
      console.error('[Schedule] Error updating schedule status on stop:', e.message);
    }
  }

  // Reset station to inactive
  db.prepare(`UPDATE inventory_pairings 
    SET active = 0, start_time = NULL, current_customer = '', current_duration = 0, current_note = '', linked_schedule_id = NULL 
    WHERE id = ?`).run(id);

  // ═══ INVENTORY USAGE TRACKING ═══
  const hoursUsed = elMin / 60;
  if (hoursUsed > 0) {
    try {
      // Get all items in this pairing
      const pairingItems = db.prepare(`
        SELECT pi.item_id, pi.role
        FROM inventory_pairing_items pi
        JOIN inventory_items i ON pi.item_id = i.id
        WHERE pi.pairing_id = ? AND i.is_active = 1
      `).all(id);

      // Record usage for each item
      const today = getWIBDateISO();
      pairingItems.forEach(item => {
        const existing = db.prepare(`
          SELECT id, hours_used FROM inventory_usage 
          WHERE item_id = ? AND date = ? AND pairing_id = ?
        `).get(item.item_id, today, id);

        if (existing) {
          db.prepare(`UPDATE inventory_usage SET hours_used = hours_used + ? WHERE id = ?`).run(hoursUsed, existing.id);
        } else {
          db.prepare(`INSERT INTO inventory_usage (item_id, date, hours_used, source, pairing_id) VALUES (?, ?, ?, 'auto', ?)`)
            .run(item.item_id, today, hoursUsed, id);
        }
      });

      console.log(`[Inventory] Tracked ${hoursUsed.toFixed(2)} hours for ${pairingItems.length} items in station ${id}`);
    } catch (e) {
      console.error('[Inventory] Error tracking usage:', e.message);
    }
  }

  res.json({ ok: true, tx });
});

// ─── SCHEDULE-UNIT INTEGRATION ─────────────────────────────────
// Start a session from a schedule (booking → active transaction)
app.post('/api/schedules/:id/start-unit', requireAuth, (req, res) => {
  const scheduleId = parseInt(req.params.id);
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!schedule) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
  if (schedule.status === 'running') return res.status(400).json({ error: 'Jadwal sudah berjalan' });
  if (schedule.status === 'completed') return res.status(400).json({ error: 'Jadwal sudah selesai' });
  if (schedule.status === 'cancelled') return res.status(400).json({ error: 'Jadwal sudah dibatalkan' });
  
  // Use provided unitId or schedule's unitId
  const { unitId = schedule.unitId } = req.body;
  if (!unitId) return res.status(400).json({ error: 'Pilih stasiun terlebih dahulu' });
  
  // Get station name
  const station = db.prepare('SELECT * FROM inventory_pairings WHERE id = ?').get(unitId);
  const unitName = station ? station.name : schedule.unitName || unitId;
  
  // Prepare note with [TX_ID] prefix (e.g., [PSJ00018])
  const txId = schedule.scheduleId || scheduleId;
  const bookingNote = schedule.note ? `[${txId}] - ${schedule.note}` : `[${txId}]`;
  const startTime = Date.now();
  
  // Create a transaction record for the active session
  const txStmt = db.prepare(`
    INSERT INTO transactions (unitId, unitName, customer, startTime, durationMin, paid, payment, note, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const txResult = txStmt.run(
    unitId,
    unitName,
    schedule.customer,
    startTime,
    schedule.duration || 0,
    0, // paid - will be set when completing
    'cash',
    bookingNote,
    new Date().toISOString().split('T')[0]
  );
  
  // Update schedule status to running with unit info
  db.prepare('UPDATE schedules SET status = ?, unitId = ?, unitName = ? WHERE id = ?')
    .run('running', unitId, unitName, scheduleId);
  
  // Also activate the station in Dashboard (update inventory_pairings)
  try {
    db.prepare(`UPDATE inventory_pairings 
      SET active = 1, start_time = ?, current_customer = ?, current_duration = ?, current_note = ?, linked_schedule_id = ? 
      WHERE id = ?`)
      .run(startTime, schedule.customer, schedule.duration || 0, bookingNote, scheduleId, unitId);
    console.log(`[Schedule-Station] Activated station ${unitId} for schedule ${scheduleId}`);
  } catch (e) {
    console.error('[Schedule-Station] Error activating station:', e.message);
    // Non-fatal: schedule is still running even if station activation fails
  }
  
  res.json({ 
    ok: true, 
    message: 'Sesi dimulai dari jadwal',
    station: { id: unitId, name: unitName },
    schedule: db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId)
  });
});

// Complete a schedule and stop its linked unit
app.post('/api/schedules/:id/complete', requireAuth, (req, res) => {
  const scheduleId = parseInt(req.params.id);
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!schedule) return res.status(404).json({ error: 'Jadwal tidak ditemukan' });
  
  // If schedule is running and has a linked station, stop the station first
  if (schedule.status === 'running' && schedule.unitId) {
    // Get station data from inventory_pairings
    const station = db.prepare('SELECT * FROM inventory_pairings WHERE id = ?').get(schedule.unitId);
    if (station && station.active && station.linked_schedule_id === scheduleId) {
      const settings = getSettings();
      const elMin = Math.floor((Date.now() - station.start_time) / 60000);
      const cost = Math.round((elMin / 60) * settings.ratePerHour);
      const { paid = cost, payment = 'cash' } = req.body;
      const dateKey = getWIBDateISO();
      
      const tx = {
        id: generateRevenueId(),
        unitId: station.id,
        unitName: station.name,
        customer: station.current_customer,
        startTime: station.start_time,
        endTime: Date.now(),
        durationMin: elMin,
        paid: paid,
        payment: payment,
        note: station.current_note,
        date: dateKey
      };
      
      db.prepare(`INSERT INTO transactions 
        (id, unitId, unitName, customer, startTime, endTime, durationMin, paid, payment, note, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(tx.id, tx.unitId, tx.unitName, tx.customer, tx.startTime, tx.endTime, tx.durationMin, tx.paid, tx.payment, tx.note, tx.date);
      
      // Reset station in inventory_pairings
      db.prepare(`UPDATE inventory_pairings 
        SET active = 0, start_time = NULL, current_customer = NULL, current_duration = 0, current_note = NULL, linked_schedule_id = NULL 
        WHERE id = ?`)
        .run(schedule.unitId);
      
      console.log(`[Schedule-Station] Deactivated station ${schedule.unitId} for schedule ${scheduleId}`);
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
    note,
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

  // Note filter (partial match, case-insensitive)
  if (note && note.trim()) {
    conditions.push("note LIKE ? COLLATE NOCASE");
    params.push(`%${note.trim()}%`);
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

  // Execute main query with editCount
  const query = `SELECT t.*, (SELECT COUNT(*) FROM edit_logs WHERE transactionId = t.id) as editCount FROM transactions t ${whereClause} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`;
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

// POST restore from deletion_logs (trash) - restores with same ID
app.post('/api/deletion-logs/:id/restore', requireAuth, (req, res) => {
  const logId = req.params.id;
  
  // Get the deletion log entry
  const logEntry = db.prepare('SELECT * FROM deletion_logs WHERE id = ?').get(logId);
  if (!logEntry) {
    return res.status(404).json({ error: 'Data tidak ditemukan di tempat sampah' });
  }
  
  // Parse the record data
  let recordData;
  try {
    recordData = JSON.parse(logEntry.recordData);
  } catch (e) {
    return res.status(500).json({ error: 'Gagal memparse data yang dihapus' });
  }
  
  const { recordType, recordId } = logEntry;
  
  try {
    if (recordType === 'transaction') {
      // Check if transaction with same ID already exists
      const existing = db.prepare('SELECT id FROM transactions WHERE id = ?').get(recordId);
      if (existing) {
        return res.status(409).json({ error: 'Transaksi dengan ID ini sudah ada' });
      }
      
      // Restore transaction with same ID
      db.prepare(`INSERT INTO transactions 
        (id, unitId, unitName, customer, phone, startTime, endTime, durationMin, paid, payment, note, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          recordId,
          recordData.unitId,
          recordData.unitName,
          recordData.customer,
          recordData.phone || null,
          recordData.startTime,
          recordData.endTime,
          recordData.durationMin,
          recordData.paid,
          recordData.payment,
          recordData.note,
          recordData.date
        );
        
    } else if (recordType === 'expense') {
      // Check if expense with same ID already exists
      const existing = db.prepare('SELECT id FROM expenses WHERE id = ?').get(recordId);
      if (existing) {
        return res.status(409).json({ error: 'Pengeluaran dengan ID ini sudah ada' });
      }
      
      // Restore expense with same ID
      db.prepare(`INSERT INTO expenses 
        (id, item, category, amount, date, note)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          recordId,
          recordData.item,
          recordData.category || '',
          recordData.amount,
          recordData.date,
          recordData.note
        );
    } else {
      return res.status(400).json({ error: 'Tipe data tidak didukung untuk restore' });
    }
    
    // Delete from deletion_logs after successful restore
    db.prepare('DELETE FROM deletion_logs WHERE id = ?').run(logId);
    
    res.json({ 
      ok: true, 
      message: `${recordType === 'transaction' ? 'Transaksi' : 'Pengeluaran'} berhasil dikembalikan dengan ID yang sama`,
      restoredId: recordId,
      recordType
    });
    
  } catch (error) {
    console.error('[Restore Error]', error.message);
    res.status(500).json({ error: 'Gagal mengembalikan data: ' + error.message });
  }
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
    'phone': 'phone',
    'paid': 'paid',           // DB column is 'paid', not 'total'
    'duration': 'durationMin', // DB column is 'durationMin', not 'duration'
    'payment': 'payment',
    'note': 'note',
    'unitId': 'unitId',
    'unitName': 'unitName',
    'timestamp': 'startTime',  // Maps to startTime
    'startTime': 'startTime',
    'endTime': 'endTime'
  };

  // Build update fields with proper mapping + track changes for audit log
  const dbFields = [];
  const dbValues = [];
  const editLogs = [];

  // Helper to track changes
  const trackChange = (field, dbField, value) => {
    const oldVal = tx[dbField];
    // Convert for comparison (handle numbers vs strings)
    const oldValStr = oldVal !== null && oldVal !== undefined ? String(oldVal) : '';
    const newValStr = value !== null && value !== undefined ? String(value) : '';
    if (oldValStr !== newValStr) {
      dbFields.push(`${dbField} = ?`);
      dbValues.push(value);
      editLogs.push({
        transactionId: id,
        fieldName: field,
        oldValue: oldValStr,
        newValue: newValStr,
        editReason,
        editedAt: Date.now(),
        editedBy
      });
    }
  };

  // Process each field from input
  for (const [field, value] of Object.entries(inputUpdates)) {
    if (field === 'id' || field === 'reason' || field === 'editReason' || field === 'editedBy' || typeof value === 'object') continue;

    const dbField = fieldMapping[field];
    if (!dbField) continue; // Skip unknown fields

    // Handle special cases
    if (field === 'timestamp' && value) {
      const ts = parseInt(value);
      if (!isNaN(ts)) {
        trackChange('timestamp', 'startTime', ts);
        trackChange('date', 'date', new Date(ts).toISOString().split('T')[0]);
      }
    } else if (field === 'duration' && value !== undefined) {
      const duration = parseInt(value);
      if (!isNaN(duration)) {
        trackChange('duration', 'durationMin', duration);
        // Recalculate endTime if we have startTime
        if (inputUpdates.startTime || inputUpdates.timestamp || tx.startTime) {
          const startTs = parseInt(inputUpdates.startTime || inputUpdates.timestamp || tx.startTime);
          if (!isNaN(startTs)) {
            const endTs = startTs + (duration * 60000);
            trackChange('endTime', 'endTime', endTs);
          }
        }
      }
    } else if (field === 'unitId' && value !== undefined) {
      const newUnitId = value; // unitId can be TEXT (station ID like "HOME-01")
      if (newUnitId !== tx.unitId) {
        trackChange('unitId', 'unitId', newUnitId);
        // Lookup unit name from inventory_pairings (for stations)
        const station = db.prepare('SELECT name FROM inventory_pairings WHERE id = ?').get(newUnitId);
        const newUnitName = station ? station.name : (inputUpdates.unitName || tx.unitName || newUnitId);
        if (newUnitName !== tx.unitName) {
          trackChange('unitName', 'unitName', newUnitName);
        }
      }
    } else {
      // Standard field mapping
      trackChange(field, dbField, value);
    }
  }

  // Handle endTime if explicitly provided (and not already set via duration calculation)
  if (inputUpdates.endTime !== undefined && !dbFields.find(f => f.includes('endTime'))) {
    const endTs = parseInt(inputUpdates.endTime);
    if (!isNaN(endTs)) {
      trackChange('endTime', 'endTime', endTs);
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

  // Execute main query with editCount
  const query = `SELECT e.*, (SELECT COUNT(*) FROM edit_logs WHERE expenseId = e.id) as editCount FROM expenses e ${whereClause} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`;
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
  const schedules = db.prepare(`
    SELECT s.*, COUNT(el.id) as editCount 
    FROM schedules s 
    LEFT JOIN edit_logs el ON el.scheduleId = s.scheduleId 
    GROUP BY s.id 
    ORDER BY s.scheduledDate DESC, s.scheduledTime ASC
  `).all();
  res.json({ ok: true, schedules });
});

app.post('/api/schedules', requireAuth, (req, res) => {
  const { customer, phone, unitId, unitName, scheduledDate, scheduledTime, scheduledEndDate, scheduledEndTime, duration, note, status } = req.body;
  const durationMinutes = parseInt(duration) || 0;
  
  // Conflict detection: Check if station is already booked for overlapping time
  // Uses scheduledEndDate and scheduledEndTime if available, otherwise fall back to calculation
  if (unitId && scheduledDate && scheduledTime) {
    let newStartDateTime, newEndDateTime;

    // Parse new booking dates/times with explicit timezone handling
    // Use explicit timezone +07:00 (WIB/Indonesia) to ensure consistent parsing
    newStartDateTime = new Date(`${scheduledDate}T${scheduledTime}:00+07:00`);
    if (scheduledEndDate && scheduledEndTime) {
      newEndDateTime = new Date(`${scheduledEndDate}T${scheduledEndTime}:00+07:00`);
    } else if (durationMinutes > 0) {
      newEndDateTime = new Date(newStartDateTime.getTime() + durationMinutes * 60000);
    }

    // Must have end time to calculate overlap
    if (!newEndDateTime) {
      return res.status(400).json({
        ok: false,
        error: 'Waktu berakhir atau durasi wajib diisi untuk pengecekan konflik.'
      });
    }

    // ===== CHECK 1: Conflict with existing pending/running schedules =====
    const existingSchedules = db.prepare(
      `SELECT * FROM schedules
       WHERE unitId = ? AND status NOT IN ('cancelled', 'completed')
       AND (
         (scheduledDate <= ? AND (scheduledEndDate >= ? OR scheduledDate = ?))
         OR
         (scheduledEndDate IS NULL AND scheduledDate >= ? AND scheduledDate <= ?)
       )`
    ).all(unitId, scheduledEndDate || scheduledDate, scheduledDate, scheduledDate, scheduledDate, scheduledEndDate || scheduledDate);

    for (const existing of existingSchedules) {
      if (!existing.scheduledTime) continue;

      // Calculate existing booking datetime range with explicit timezone +07:00
      let existStartDateTime = new Date(`${existing.scheduledDate}T${existing.scheduledTime}:00+07:00`);
      let existEndDateTime;

      if (existing.scheduledEndDate && existing.scheduledEndTime) {
        existEndDateTime = new Date(`${existing.scheduledEndDate}T${existing.scheduledEndTime}:00+07:00`);
      } else if (existing.duration) {
        existEndDateTime = new Date(existStartDateTime.getTime() + existing.duration * 60000);
      } else {
        continue; // Skip if no end time info
      }

      // Check for overlap: (StartA < EndB) && (EndA > StartB)
      const overlap = (newStartDateTime.getTime() < existEndDateTime.getTime()) && (newEndDateTime.getTime() > existStartDateTime.getTime());

      if (overlap) {
        const existEndTimeStr = existing.scheduledEndTime ||
          String(existEndDateTime.getHours()).padStart(2, '0') + ':' +
          String(existEndDateTime.getMinutes()).padStart(2, '0');
        return res.status(409).json({
          ok: false,
          error: `Stasiun sudah dibooking oleh ${existing.customer} pukul ${existing.scheduledTime}-${existEndTimeStr}. Silakan pilih stasiun lain atau waktu berbeda.`
        });
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
  
  // SPECIAL CASE: If status is being changed to 'cancelled', move to trash instead of updating
  if (status === 'cancelled') {
    const cancelReason = reason || editReason || 'Dibatalkan';

    // Update status to 'cancelled' before saving to deletion_logs
    // so trash modal can display correct "❌ Dibatalkan" badge
    existing.status = 'cancelled';

    // Log cancellation to deletion_logs (trash)
    try {
      db.prepare(`
        INSERT INTO deletion_logs (recordType, recordId, recordData, deleteReason, deletedAt, deletedBy)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'schedule',
        existing.scheduleId || scheduleId,
        JSON.stringify(existing),
        cancelReason,
        Date.now(),
        editedBy || 'admin'
      );
    } catch (e) {
      console.error('[Audit] Failed to log schedule cancellation:', e.message);
    }

    // Delete from schedules table
    db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);

    return res.json({
      ok: true,
      message: 'Jadwal dibatalkan dan dipindahkan ke sampah',
      cancelled: true
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
  
  // Conflict detection for updates: Check if station is already booked for overlapping time (excluding current schedule)
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
         WHERE unitId = ? AND status NOT IN ('cancelled', 'completed') AND id != ?
         AND (
           (scheduledDate <= ? AND (scheduledEndDate >= ? OR scheduledDate = ?))
           OR 
           (scheduledEndDate IS NULL AND scheduledDate >= ? AND scheduledDate <= ?)
         )`
      ).all(updateUnitId, scheduleId, updateScheduledEndDate || updateScheduledDate, updateScheduledDate, updateScheduledDate, updateScheduledDate, updateScheduledEndDate || updateScheduledDate);
      
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
            error: `Stasiun sudah dibooking oleh ${exist.customer} pukul ${exist.scheduledTime}-${existEndTimeStr}. Silakan pilih stasiun lain atau waktu berbeda.`
          });
        }
      }
    }
  }
  
  // Execute update with all fields
  db.prepare(`
    UPDATE schedules 
    SET customer = ?, phone = ?, unitId = ?, unitName = ?, scheduledDate = ?, scheduledTime = ?,
        scheduledEndDate = ?, scheduledEndTime = ?, duration = ?, note = ?, status = ?
    WHERE id = ?
  `).run(
    updateCustomer, updatePhone, updateUnitId, updateUnitName, updateScheduledDate, updateScheduledTime,
    updateScheduledEndDate, updateScheduledEndTime, updateDuration, updateNote, updateStatus, scheduleId
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

// GET deleted schedules (trash) - MUST be before /:id route
app.get('/api/schedules/deleted', requireAuth, (req, res) => {
  try {
    const deleted = db.prepare(`
      SELECT
        id,
        recordId as originalId,
        json_extract(recordData, '$.customer') as customer,
        json_extract(recordData, '$.phone') as phone,
        json_extract(recordData, '$.unitId') as unitId,
        json_extract(recordData, '$.unitName') as unitName,
        json_extract(recordData, '$.scheduledDate') as scheduledDate,
        json_extract(recordData, '$.scheduledTime') as scheduledTime,
        json_extract(recordData, '$.scheduledEndDate') as scheduledEndDate,
        json_extract(recordData, '$.scheduledEndTime') as scheduledEndTime,
        json_extract(recordData, '$.duration') as duration,
        json_extract(recordData, '$.note') as note,
        json_extract(recordData, '$.status') as status,
        json_extract(recordData, '$.scheduleId') as scheduleId,
        deleteReason,
        deletedAt,
        deletedBy
      FROM deletion_logs
      WHERE recordType = 'schedule'
      ORDER BY deletedAt DESC
    `).all();
    res.json({ ok: true, deleted });
  } catch (error) {
    console.error('[API] Error fetching deleted schedules:', error.message);
    res.status(400).json({ ok: false, error: error.message });
  }
});

// GET completed schedules (history)
app.get('/api/schedules/completed', requireAuth, (req, res) => {
  try {
    const completed = db.prepare(`
      SELECT * FROM schedules
      WHERE status = 'completed'
      ORDER BY scheduledDate DESC, scheduledTime ASC
    `).all();
    res.json({ ok: true, completed });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
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
  
  // Update status to 'cancelled' before logging deletion
  // This ensures deleted schedules show correct status in trash
  schedule.status = 'cancelled';
  
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

// ─── ROI STATS ──────────────────────────────────────────────────
app.get('/api/stats/roi', requireAuth, (req, res) => {
  try {
    // Get daily revenue data
    const dailyRevenue = db.prepare(`
      SELECT 
        date(endTime) as day,
        SUM(paid) as revenue
      FROM transactions
      WHERE endTime IS NOT NULL
      GROUP BY date(endTime)
      ORDER BY day DESC
      LIMIT 30
    `).all();

    // Get capital data
    const capital = db.prepare('SELECT SUM(amount) as total FROM initial_capital').get();
    const capitalExpenses = db.prepare('SELECT SUM(amount) as total FROM capital_expenses').get();
    
    const totalCapital = capital?.total || 0;
    const totalSpent = capitalExpenses?.total || 0;
    const remaining = totalCapital - totalSpent;

    // Calculate projections
    const revenues = dailyRevenue.map(d => d.revenue).filter(r => r > 0);
    const avgDailyRevenue = revenues.length > 0 
      ? revenues.reduce((a, b) => a + b, 0) / revenues.length 
      : 0;
    
    // Median calculation
    const sortedRevenues = [...revenues].sort((a, b) => a - b);
    const medianDailyRevenue = sortedRevenues.length > 0
      ? sortedRevenues.length % 2 === 0
        ? (sortedRevenues[sortedRevenues.length / 2 - 1] + sortedRevenues[sortedRevenues.length / 2]) / 2
        : sortedRevenues[Math.floor(sortedRevenues.length / 2)]
      : 0;

    // Days to break even
    const daysToBreakEvenAvg = avgDailyRevenue > 0 
      ? Math.ceil(totalSpent / avgDailyRevenue) 
      : 0;
    const daysToBreakEvenMedian = medianDailyRevenue > 0 
      ? Math.ceil(totalSpent / medianDailyRevenue) 
      : 0;

    // Monthly projections (30 days)
    const monthlyProfitAvg = (avgDailyRevenue * 30) - (remaining > 0 ? 0 : Math.abs(remaining) / 12);
    const monthlyProfitMedian = (medianDailyRevenue * 30) - (remaining > 0 ? 0 : Math.abs(remaining) / 12);

    res.json({
      projections: {
        avgDailyRevenue,
        medianDailyRevenue,
        daysToBreakEvenAvg,
        daysToBreakEvenMedian,
        monthlyProfitAvg,
        monthlyProfitMedian,
        totalCapital,
        totalSpent,
        remaining
      },
      dailyHistory: dailyRevenue.slice(0, 7) // Last 7 days
    });
  } catch (err) {
    console.error('ROI stats error:', err);
    res.status(500).json({ error: err.message });
  }
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

// ════════════════════════════════════════════════════════════════
// INVENTORY SYSTEM API
// ════════════════════════════════════════════════════════════════

// Get all inventory items with filters
app.get('/api/inventory', requireAuth, (req, res) => {
  const { category, condition, location, search, includeInactive, limit = 100, offset = 0 } = req.query;
  let sql = 'SELECT * FROM inventory_items WHERE 1=1';
  const params = [];
  
  // Default: only show active items (soft delete support)
  if (!includeInactive) {
    sql += ' AND is_active = 1';
  }
  
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (condition) {
    sql += ' AND condition = ?';
    params.push(condition);
  }
  if (location) {
    sql += ' AND current_location = ?';
    params.push(location);
  }
  if (search) {
    sql += ' AND (name LIKE ? OR id LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  
  sql += ' ORDER BY category, id LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  
  const items = db.prepare(sql).all(...params);
  res.json(items);
});

// Get all paired item IDs (for filtering dropdowns) - MUST be before /api/inventory/:id
app.get('/api/inventory/paired-items', requireAuth, (req, res) => {
  try {
    const pairedItems = db.prepare(`
      SELECT DISTINCT item_id, pairing_id
      FROM inventory_pairing_items
    `).all();
    
    console.log(`[API] /api/inventory/paired-items - Found ${pairedItems.length} paired items`);
    
    res.json({
      paired_items: pairedItems.map(p => p.item_id),
      pairings: pairedItems.reduce((acc, p) => {
        acc[p.item_id] = p.pairing_id;
        return acc;
      }, {}),
      count: pairedItems.length
    });
  } catch (e) {
    console.error('[API] Error fetching paired items:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get single inventory item with details
app.get('/api/inventory/:id', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  
  // Get maintenance history
  const maintenance = db.prepare(
    'SELECT * FROM inventory_maintenance WHERE item_id = ? ORDER BY maintenance_date DESC'
  ).all(req.params.id);
  
  // Get pairing history
  const pairingHistory = db.prepare(`
    SELECT h.*, p1.name as old_pairing_name, p2.name as new_pairing_name
    FROM inventory_pairing_history h
    LEFT JOIN inventory_pairings p1 ON h.old_pairing_id = p1.id
    LEFT JOIN inventory_pairings p2 ON h.new_pairing_id = p2.id
    WHERE h.item_id = ?
    ORDER BY h.change_date DESC
  `).all(req.params.id);
  
  // Get usage stats (last 30 days)
  const usage = db.prepare(`
    SELECT date, hours_used, source, pairing_id
    FROM inventory_usage
    WHERE item_id = ? AND date >= date('now', '-30 days')
    ORDER BY date DESC
  `).all(req.params.id);
  
  // Get current pairing
  const currentPairing = db.prepare(`
    SELECT p.*, pi.role
    FROM inventory_pairings p
    JOIN inventory_pairing_items pi ON p.id = pi.pairing_id
    WHERE pi.item_id = ?
    LIMIT 1
  `).get(req.params.id);
  
  // Calculate total usage hours
  const totalHours = db.prepare(
    'SELECT COALESCE(SUM(hours_used), 0) as total FROM inventory_usage WHERE item_id = ?'
  ).get(req.params.id);
  
  // Calculate total maintenance cost
  const totalMaintenance = db.prepare(
    'SELECT COALESCE(SUM(cost), 0) as total FROM inventory_maintenance WHERE item_id = ?'
  ).get(req.params.id);
  
  // Get book value (latest depreciation or purchase cost)
  const depreciation = db.prepare(
    'SELECT book_value FROM inventory_depreciation WHERE item_id = ? ORDER BY depreciation_date DESC LIMIT 1'
  ).get(req.params.id);
  
  res.json({
    id: item.id,
    name: item.name,
    category: item.category,
    subcategory: item.subcategory,
    purchase_date: item.purchase_date,
    purchase_cost: item.purchase_cost,
    vendor: item.vendor,
    warranty_info: item.warranty_info,
    condition: item.condition,
    current_location: item.current_location,
    notes: item.notes,
    photo_url: item.photo_url,
    created_at: item.created_at,
    updated_at: item.updated_at,
    maintenance_history: maintenance,
    pairing_history: pairingHistory,
    usage_30d: usage,
    current_pairing: currentPairing ? {
      id: currentPairing.id,
      name: currentPairing.name,
      role: currentPairing.role,
      assigned_at: currentPairing.added_date || item.created_at
    } : null,
    total_usage_hours: totalHours.total,
    total_maintenance_cost: totalMaintenance.total,
    current_book_value: depreciation?.book_value || item.purchase_cost
  });
});

// Create new inventory item
app.post('/api/inventory', requireAuth, (req, res) => {
  const { name, category, subcategory, purchase_date, purchase_cost, vendor, 
          warranty_info, condition, current_location, notes, photo_url } = req.body;
  
  if (!name || !category) {
    return res.status(400).json({ error: 'Name and category are required' });
  }
  
  const id = generateInventoryId(category);
  const now = Date.now();
  
  db.prepare(`
    INSERT INTO inventory_items 
    (id, name, category, subcategory, purchase_date, purchase_cost, vendor, 
     warranty_info, condition, current_location, notes, photo_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, category, subcategory || null, purchase_date || null, 
         purchase_cost || 0, vendor || null, warranty_info || null, 
         condition || 'baik', current_location || null, notes || null, photo_url || null, now, now);
  
  // Add initial depreciation record
  if (purchase_cost > 0) {
    db.prepare(`
      INSERT INTO inventory_depreciation (item_id, depreciation_date, book_value, depreciation_method)
      VALUES (?, date('now'), ?, 'straight_line')
    `).run(id, purchase_cost);
  }
  
  res.json({ ok: true, id, message: 'Item created successfully' });
});

// Update inventory item
app.put('/api/inventory/:id', requireAuth, (req, res) => {
  const { name, subcategory, condition, current_location, notes, photo_url } = req.body;
  const now = Date.now();
  
  db.prepare(`
    UPDATE inventory_items 
    SET name = ?, subcategory = ?, condition = ?, current_location = ?, notes = ?, photo_url = ?, updated_at = ?
    WHERE id = ?
  `).run(name, subcategory || null, condition, current_location || null, 
         notes || null, photo_url || null, now, req.params.id);
  
  res.json({ ok: true, message: 'Item updated successfully' });
});

// Delete inventory item (soft delete)
app.delete('/api/inventory/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE inventory_items SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true, message: 'Item deleted successfully' });
});

// Add maintenance record
app.post('/api/inventory/:id/maintenance', requireAuth, (req, res) => {
  const { maintenance_date, cost, description, vendor, next_scheduled_maintenance } = req.body;
  
  db.prepare(`
    INSERT INTO inventory_maintenance 
    (item_id, maintenance_date, cost, description, vendor, next_scheduled_maintenance)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, maintenance_date, cost || 0, description || null, 
         vendor || null, next_scheduled_maintenance || null);
  
  res.json({ ok: true, message: 'Maintenance record added' });
});

// ════════════════════════════════════════════════════════════════
// INVENTORY PAIRINGS/STATIONS API
// ════════════════════════════════════════════════════════════════

// Get all pairings/stations
app.get('/api/pairings', requireAuth, (req, res) => {
  const { is_active } = req.query;
  let sql = 'SELECT * FROM inventory_pairings';
  const params = [];

  if (is_active !== undefined) {
    sql += ' WHERE is_active = ?';
    params.push(is_active === 'true' ? 1 : 0);
  }

  sql += ' ORDER BY id';

  const pairings = db.prepare(sql).all(...params);

  // Helper function to validate station requirements
  function validateStationItems(items) {
    const counts = {
      ps3: items.filter(i => i.category === 'ps3' || i.category === 'konsol').length,
      tv: items.filter(i => i.category === 'tv').length,
      stik: items.filter(i => i.category === 'stik').length,
      usb: items.filter(i => i.category === 'usb' || i.category === 'charger' || i.category === 'kabel_usb' ||
                          (i.category === 'kabel_power' && i.role && i.role.startsWith('charger'))).length,
      hdmi: items.filter(i => i.category === 'hdmi' || i.category === 'kabel_hdmi').length,
      plug: items.filter(i => i.category === 'plug' || 
                          (i.category === 'kabel_power' && (!i.role || i.role === 'power'))).length,
      lainnya: items.filter(i => i.category === 'lainnya' || i.category === 'kabel').length
    };

    const errors = [];

    // Konsol (PS3) = 1 (wajib tepat 1)
    if (counts.ps3 === 0) errors.push('Konsol PS3 belum terpasang (wajib 1)');
    else if (counts.ps3 > 1) errors.push(`Konsol PS3 terpasang ${counts.ps3} (wajib tepat 1, lepas ${counts.ps3 - 1} konsol)`);

    // TV = 1 (wajib tepat 1)
    if (counts.tv === 0) errors.push('TV belum terpasang (wajib 1)');
    else if (counts.tv > 1) errors.push(`TV terpasang ${counts.tv} (wajib tepat 1, lepas ${counts.tv - 1} TV)`);

    // Stik >= 1 (minimal 1)
    if (counts.stik === 0) errors.push('Stik belum terpasang (minimal 1)');

    // Kabel Charger (USB) >= 1
    if (counts.usb === 0) errors.push('Kabel Charger USB belum terpasang (minimal 1)');

    // Kabel Plug = 1
    if (counts.plug === 0) errors.push('Kabel Power/Plug belum terpasang (wajib 1)');
    else if (counts.plug > 1) errors.push(`Kabel Power/Plug terpasang ${counts.plug} (wajib tepat 1, lepas ${counts.plug - 1})`);

    // Kabel HDMI = 1
    if (counts.hdmi === 0) errors.push('Kabel HDMI belum terpasang (wajib 1)');
    else if (counts.hdmi > 1) errors.push(`Kabel HDMI terpasang ${counts.hdmi} (wajib tepat 1, lepas ${counts.hdmi - 1})`);

    return {
      isValid: errors.length === 0,
      errors: errors,
      counts: counts
    };
  }

  // Get items for each pairing
  const result = pairings.map(p => {
    const items = db.prepare(`
      SELECT pi.*, i.name, i.category, i.condition, i.purchase_cost
      FROM inventory_pairing_items pi
      JOIN inventory_items i ON pi.item_id = i.id
      WHERE pi.pairing_id = ?
      ORDER BY pi.role
    `).all(p.id);

    const totalValue = items.reduce((sum, i) => sum + (i.purchase_cost || 0), 0);
    const validation = validateStationItems(items);

    return {
      ...p,
      item_count: items.length,
      total_value: totalValue,
      // Runtime tracking fields for Dashboard integration
      active: p.active || 0,
      startTime: p.start_time,
      customer: p.current_customer,
      duration: p.current_duration,
      note: p.current_note,
      linkedScheduleId: p.linked_schedule_id,
      // Validation status
      is_valid: validation.isValid,
      validation_errors: validation.errors,
      item_counts: validation.counts,
      items: items.map(i => ({
        item_id: i.item_id,
        item_name: i.name,
        category: i.category,
        condition: i.condition,
        role: i.role
      }))
    };
  });

  res.json(result);
});

// Get single pairing with full details
app.get('/api/pairings/:id', requireAuth, (req, res) => {
  const pairing = db.prepare('SELECT * FROM inventory_pairings WHERE id = ?').get(req.params.id);
  if (!pairing) return res.status(404).json({ error: 'Pairing not found' });
  
  // Helper function to validate station requirements
  function validateStationItems(items) {
    const counts = {
      ps3: items.filter(i => i.category === 'ps3' || i.category === 'konsol').length,
      tv: items.filter(i => i.category === 'tv').length,
      stik: items.filter(i => i.category === 'stik').length,
      usb: items.filter(i => i.category === 'usb' || i.category === 'charger' || i.category === 'kabel_usb' ||
                          (i.category === 'kabel_power' && i.role && i.role.startsWith('charger'))).length,
      hdmi: items.filter(i => i.category === 'hdmi' || i.category === 'kabel_hdmi').length,
      plug: items.filter(i => i.category === 'plug' || 
                          (i.category === 'kabel_power' && (!i.role || i.role === 'power'))).length,
      lainnya: items.filter(i => i.category === 'lainnya' || i.category === 'kabel').length
    };

    const errors = [];

    // Konsol (PS3) = 1 (wajib tepat 1)
    if (counts.ps3 === 0) errors.push('Konsol PS3 belum terpasang (wajib 1)');
    else if (counts.ps3 > 1) errors.push(`Konsol PS3 terpasang ${counts.ps3} (wajib tepat 1, lepas ${counts.ps3 - 1} konsol)`);

    // TV = 1 (wajib tepat 1)
    if (counts.tv === 0) errors.push('TV belum terpasang (wajib 1)');
    else if (counts.tv > 1) errors.push(`TV terpasang ${counts.tv} (wajib tepat 1, lepas ${counts.tv - 1} TV)`);

    // Stik >= 1 (minimal 1)
    if (counts.stik === 0) errors.push('Stik belum terpasang (minimal 1)');

    // Kabel Charger (USB) >= 1
    if (counts.usb === 0) errors.push('Kabel Charger USB belum terpasang (minimal 1)');

    // Kabel Plug = 1
    if (counts.plug === 0) errors.push('Kabel Power/Plug belum terpasang (wajib 1)');
    else if (counts.plug > 1) errors.push(`Kabel Power/Plug terpasang ${counts.plug} (wajib tepat 1, lepas ${counts.plug - 1})`);

    // Kabel HDMI = 1
    if (counts.hdmi === 0) errors.push('Kabel HDMI belum terpasang (wajib 1)');
    else if (counts.hdmi > 1) errors.push(`Kabel HDMI terpasang ${counts.hdmi} (wajib tepat 1, lepas ${counts.hdmi - 1})`);

    return {
      isValid: errors.length === 0,
      errors: errors,
      counts: counts
    };
  }
  
  // Get all items with their roles
  const items = db.prepare(`
    SELECT pi.*, i.name, i.category, i.condition, i.purchase_cost,
           (SELECT COALESCE(SUM(hours_used), 0) FROM inventory_usage WHERE item_id = i.id AND date >= date('now', '-30 days')) as usage_30d,
           (SELECT COALESCE(SUM(cost), 0) FROM inventory_maintenance WHERE item_id = i.id) as total_maintenance
    FROM inventory_pairing_items pi
    JOIN inventory_items i ON pi.item_id = i.id
    WHERE pi.pairing_id = ?
    ORDER BY pi.role
  `).all(req.params.id);
  
  // Calculate total usage for pairing (from konsol usage)
  const konsolItem = items.find(i => i.role === 'konsol');
  const usageStats = { last30d: 0, total: 0 };
  
  if (konsolItem) {
    const stats = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN date >= date('now', '-30 days') THEN hours_used ELSE 0 END), 0) as last30d,
        COALESCE(SUM(hours_used), 0) as total
      FROM inventory_usage WHERE item_id = ?
    `).get(konsolItem.item_id);
    usageStats.last30d = stats.last30d;
    usageStats.total = stats.total;
  }
  
  // Get revenue from this pairing (if linked to rental unit)
  const unitLink = db.prepare('SELECT unit_id FROM unit_pairings WHERE pairing_id = ? AND is_active = 1').get(req.params.id);
  
  // Validation check
  const validation = validateStationItems(items);
  
  res.json({
    id: pairing.id,
    name: pairing.name,
    description: pairing.description,
    is_active: pairing.is_active,
    created_at: pairing.created_at,
    updated_at: pairing.updated_at,
    item_count: items.length,
    total_value: items.reduce((sum, i) => sum + (i.purchase_cost || 0), 0),
    total_maintenance: items.reduce((sum, i) => sum + (i.total_maintenance || 0), 0),
    is_valid: validation.isValid,
    validation_errors: validation.errors,
    item_counts: validation.counts,
    items: items.map(i => ({
      item_id: i.item_id,
      item_name: i.name,
      category: i.category,
      condition: i.condition,
      role: i.role,
      purchase_cost: i.purchase_cost,
      added_date: i.added_date,
      usage_30d: i.usage_30d,
      total_maintenance: i.total_maintenance
    })),
    usage_stats: usageStats,
    unit_link: unitLink
  });
});

// Create new pairing/station
app.post('/api/pairings', requireAuth, (req, res) => {
  const { name, description } = req.body;
  const id = generateStationId();
  const now = Date.now();
  
  db.prepare('INSERT INTO inventory_pairings (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name || `Station ${id}`, description || null, now, now);
  
  res.json({ ok: true, id, message: 'Pairing created successfully' });
});

// Update pairing
app.put('/api/pairings/:id', requireAuth, (req, res) => {
  const { name, description, is_active } = req.body;
  const now = Date.now();
  
  db.prepare('UPDATE inventory_pairings SET name = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?')
    .run(name, description || null, is_active !== undefined ? (is_active ? 1 : 0) : 1, now, req.params.id);
  
  res.json({ ok: true, message: 'Pairing updated successfully' });
});

// Add item to pairing
app.post('/api/pairings/:id/items', requireAuth, (req, res) => {
  const { item_id, role, notes } = req.body;
  const pairingId = req.params.id;
  const now = Date.now();
  
  // Get the item's category
  const item = db.prepare('SELECT id, category FROM inventory_items WHERE id = ?').get(item_id);
  if (!item) {
    return res.status(404).json({ ok: false, error: 'Item tidak ditemukan' });
  }
  
  // Check if this category already exists in the target pairing (prevents duplicates like 2 konsol)
  // Stik, Charger, and Lainnya can have multiple; others (konsol, tv, hdmi, plug) can only have 1
  const singleItemCategories = ['ps3', 'konsol', 'tv', 'hdmi', 'plug', 'kabel_hdmi', 'kabel_power'];
  if (singleItemCategories.includes(item.category)) {
    const existingInPairing = db.prepare(`
      SELECT pi.item_id, i.category 
      FROM inventory_pairing_items pi
      JOIN inventory_items i ON pi.item_id = i.id
      WHERE pi.pairing_id = ? AND i.category = ?
    `).get(pairingId, item.category);
    
    if (existingInPairing) {
      return res.status(400).json({ 
        ok: false, 
        error: `Kategori ${item.category} sudah ada di stasiun ini (item: ${existingInPairing.item_id}). Hapus yang lama dulu untuk mengganti.` 
      });
    }
  }
  
  // Check if item already in another pairing
  const existing = db.prepare('SELECT pairing_id FROM inventory_pairing_items WHERE item_id = ?').get(item_id);
  if (existing) {
    // Log the change
    db.prepare('INSERT INTO inventory_pairing_history (item_id, old_pairing_id, new_pairing_id, change_date, reason) VALUES (?, ?, ?, ?, ?)')
      .run(item_id, existing.pairing_id, pairingId, now, 'Moved to different pairing');
    
    // Remove from old pairing
    db.prepare('DELETE FROM inventory_pairing_items WHERE item_id = ?').run(item_id);
  }
  
  // Add to new pairing
  db.prepare('INSERT INTO inventory_pairing_items (pairing_id, item_id, role, added_date, notes) VALUES (?, ?, ?, date(\'now\'), ?)')
    .run(pairingId, item_id, role, notes || null);
  
  res.json({ ok: true, message: 'Item added to pairing' });
});

// Remove item from pairing
app.delete('/api/pairings/:id/items/:item_id', requireAuth, (req, res) => {
  const now = Date.now();
  
  // Log the removal
  db.prepare('INSERT INTO inventory_pairing_history (item_id, old_pairing_id, change_date, reason) VALUES (?, ?, ?, ?)')
    .run(req.params.item_id, req.params.id, now, 'Removed from pairing');
  
  db.prepare('DELETE FROM inventory_pairing_items WHERE pairing_id = ? AND item_id = ?')
    .run(req.params.id, req.params.item_id);
  
  res.json({ ok: true, message: 'Item removed from pairing' });
});

// Quick swap items between pairings
app.post('/api/pairings/swap', requireAuth, (req, res) => {
  const { from_pairing_id, to_pairing_id, item_id } = req.body;
  const now = Date.now();
  
  // Get current item details
  const item = db.prepare('SELECT * FROM inventory_pairing_items WHERE pairing_id = ? AND item_id = ?').get(from_pairing_id, item_id);
  if (!item) return res.status(404).json({ error: 'Item not found in source pairing' });
  
  // Log the change
  db.prepare('INSERT INTO inventory_pairing_history (item_id, old_pairing_id, new_pairing_id, change_date, reason) VALUES (?, ?, ?, ?, ?)')
    .run(item_id, from_pairing_id, to_pairing_id, now, 'Quick swap');
  
  // Remove from old
  db.prepare('DELETE FROM inventory_pairing_items WHERE pairing_id = ? AND item_id = ?').run(from_pairing_id, item_id);
  
  // Add to new
  db.prepare('INSERT INTO inventory_pairing_items (pairing_id, item_id, role, added_date, notes) VALUES (?, ?, ?, date(\'now\'), ?)')
    .run(to_pairing_id, item_id, item.role, item.notes || null);
  
  res.json({ ok: true, message: 'Item swapped successfully' });
});

// Cleanup orphaned pairing items (items that reference non-existent inventory items)
app.post('/api/pairings/cleanup-orphans', requireAuth, (req, res) => {
  try {
    // Find all orphaned records (pairing items where item_id doesn't exist in inventory_items)
    const orphaned = db.prepare(`
      SELECT pi.id, pi.pairing_id, pi.item_id, p.name as pairing_name
      FROM inventory_pairing_items pi
      JOIN inventory_pairings p ON pi.pairing_id = p.id
      LEFT JOIN inventory_items i ON pi.item_id = i.id
      WHERE i.id IS NULL
    `).all();
    
    if (orphaned.length === 0) {
      return res.json({ ok: true, message: 'No orphaned records found', deleted: 0 });
    }
    
    // Delete orphaned records
    const deleteStmt = db.prepare('DELETE FROM inventory_pairing_items WHERE id = ?');
    let deletedCount = 0;
    
    for (const record of orphaned) {
      deleteStmt.run(record.id);
      deletedCount++;
      
      // Log the cleanup
      db.prepare('INSERT INTO inventory_pairing_history (item_id, old_pairing_id, change_date, reason) VALUES (?, ?, ?, ?)')
        .run(record.item_id, record.pairing_id, Date.now(), 'Cleanup: Removed orphaned item reference (item does not exist)');
    }
    
    res.json({ 
      ok: true, 
      message: `Cleaned up ${deletedCount} orphaned record(s)`, 
      deleted: deletedCount,
      details: orphaned.map(o => ({ pairing: o.pairing_name, item_id: o.item_id }))
    });
  } catch (error) {
    console.error('[Cleanup Orphans] Error:', error);
    res.status(500).json({ error: 'Failed to cleanup orphaned records' });
  }
});

// ════════════════════════════════════════════════════════════════
// INVENTORY ANALYTICS API
// ════════════════════════════════════════════════════════════════

// Get inventory analytics summary
app.get('/api/inventory-analytics', requireAuth, (req, res) => {
  // Total assets by category
  const assetsByCategory = db.prepare(`
    SELECT category, COUNT(*) as count, COALESCE(SUM(purchase_cost), 0) as total_value
    FROM inventory_items WHERE is_active = 1
    GROUP BY category
  `).all();
  
  // Top performers (pairings with most usage)
  const topPerformers = db.prepare(`
    SELECT p.id, p.name, COALESCE(SUM(u.hours_used), 0) as total_hours
    FROM inventory_pairings p
    LEFT JOIN inventory_pairing_items pi ON p.id = pi.pairing_id
    LEFT JOIN inventory_usage u ON pi.item_id = u.item_id AND u.date >= date('now', '-30 days')
    WHERE pi.role = 'konsol'
    GROUP BY p.id
    ORDER BY total_hours DESC
    LIMIT 5
  `).all();
  
  // Need attention (items in bad condition or with upcoming maintenance)
  const needAttention = db.prepare(`
    SELECT i.*, 
      (SELECT MAX(next_scheduled_maintenance) FROM inventory_maintenance WHERE item_id = i.id) as next_maintenance
    FROM inventory_items i
    WHERE i.condition IN ('rusak', 'perbaikan', 'rusak_total')
    OR i.id IN (
      SELECT item_id FROM inventory_maintenance 
      WHERE next_scheduled_maintenance <= date('now', '+7 days')
    )
    ORDER BY i.condition DESC
  `).all();
  
  // Recent maintenance costs
  const maintenanceStats = db.prepare(`
    SELECT 
      COALESCE(SUM(cost), 0) as total_cost,
      COUNT(*) as count,
      strftime('%Y-%m', maintenance_date) as month
    FROM inventory_maintenance
    WHERE maintenance_date >= date('now', '-6 months')
    GROUP BY month
    ORDER BY month DESC
  `).all();
  
  res.json({
    assets_by_category: assetsByCategory,
    top_performers: topPerformers,
    need_attention: needAttention,
    maintenance_stats: maintenanceStats,
    total_items: db.prepare('SELECT COUNT(*) as c FROM inventory_items WHERE is_active = 1').get().c,
    total_value: db.prepare('SELECT COALESCE(SUM(purchase_cost), 0) as v FROM inventory_items WHERE is_active = 1').get().v,
    total_maintenance_cost: db.prepare('SELECT COALESCE(SUM(cost), 0) as c FROM inventory_maintenance').get().c,
    items_need_attention: needAttention.length,
    total_stations: db.prepare('SELECT COUNT(*) as c FROM inventory_pairings WHERE is_active = 1').get().c,
    active_stations: db.prepare('SELECT COUNT(*) as c FROM inventory_pairings WHERE is_active = 1').get().c,
    paired_items: db.prepare('SELECT COUNT(DISTINCT item_id) as c FROM inventory_pairing_items').get().c
  });
});

// Link pairing to rental unit
app.post('/api/units/:unit_id/pairing', requireAuth, (req, res) => {
  const { pairing_id } = req.body;
  
  // Deactivate any existing pairing for this unit
  db.prepare('UPDATE unit_pairings SET is_active = 0 WHERE unit_id = ?').run(req.params.unit_id);
  
  // Add new pairing
  db.prepare('INSERT OR REPLACE INTO unit_pairings (unit_id, pairing_id, assigned_date, is_active) VALUES (?, ?, date(\'now\'), 1)')
    .run(req.params.unit_id, pairing_id);
  
  res.json({ ok: true, message: 'Pairing linked to unit' });
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
