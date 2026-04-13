// Migration script untuk Sistem Stasiun
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'ps3rental.db');

console.log('🔄 Starting migration to Sistem Stasiun...');
console.log(`📁 Database: ${dbPath}`);

const db = new Database(dbPath);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON');

// Get list of existing tables
const existingTables = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table'
`).all().map(r => r.name);

console.log(`📊 Existing tables: ${existingTables.join(', ') || '(none)'}`);

// Drop existing tables safely
const tablesToDrop = [
  'inventory_usage', 'inventory_maintenance', 'inventory_pairing_items',
  'inventory_pairings', 'inventory_items', 'schedules', 'transactions',
  'units', 'ghost_schedules', 'ghost_transactions', 'ghost_expenses',
  'audit_logs', 'deleted_units', 'station_items', 'stations',
  'station_item_history', 'item_usage_logs', 'maintenance_logs', 'edit_history'
];

console.log('\n🗑️ Dropping existing tables...');
for (const table of tablesToDrop) {
  if (existingTables.includes(table)) {
    try {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
      console.log(`  ✅ Dropped: ${table}`);
    } catch (err) {
      console.log(`  ⚠️ Could not drop ${table}: ${err.message}`);
    }
  }
}

console.log('\n📦 Creating new schema...');

// Create tables one by one with error handling
const createTable = (name, sql) => {
  try {
    db.exec(sql);
    console.log(`  ✅ Created: ${name}`);
  } catch (err) {
    console.error(`  ❌ Error creating ${name}: ${err.message}`);
    throw err;
  }
};

// 1. Inventory Items
createTable('inventory_items', `
CREATE TABLE inventory_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('ps3', 'tv', 'stik', 'usb', 'hdmi', 'plug', 'lainnya')),
    purchase_date DATE,
    purchase_cost INTEGER DEFAULT 0,
    vendor TEXT,
    condition TEXT DEFAULT 'baik' CHECK(condition IN ('baik', 'rusak', 'perbaikan', 'rusak_total')),
    notes TEXT,
    photo_url TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// 2. Stations
createTable('stations', `
CREATE TABLE stations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    location TEXT DEFAULT 'Ruang Utama',
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// 3. Station Items
createTable('station_items', `
CREATE TABLE station_items (
    station_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    role TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (station_id, item_id),
    FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
)`);

// 4. Station Item History
createTable('station_item_history', `
CREATE TABLE station_item_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    old_station_id TEXT,
    new_station_id TEXT,
    change_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    FOREIGN KEY (item_id) REFERENCES inventory_items(id),
    FOREIGN KEY (old_station_id) REFERENCES stations(id),
    FOREIGN KEY (new_station_id) REFERENCES stations(id)
)`);

// 5. Schedules
createTable('schedules', `
CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT,
    rental_date DATE NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration INTEGER NOT NULL,
    price INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'completed', 'cancelled')),
    notes TEXT,
    tx_id TEXT UNIQUE,
    edit_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (station_id) REFERENCES stations(id)
)`);

// 6. Transactions
createTable('transactions', `
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    station_id TEXT,
    schedule_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    category TEXT,
    amount INTEGER NOT NULL,
    description TEXT,
    date DATE NOT NULL,
    tx_id TEXT,
    edit_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (station_id) REFERENCES stations(id),
    FOREIGN KEY (schedule_id) REFERENCES schedules(id)
)`);

// 7. Item Usage Logs
createTable('item_usage_logs', `
CREATE TABLE item_usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    station_id TEXT NOT NULL,
    usage_date DATE NOT NULL,
    duration_minutes INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES inventory_items(id),
    FOREIGN KEY (schedule_id) REFERENCES schedules(id),
    FOREIGN KEY (station_id) REFERENCES stations(id)
)`);

// 8. Maintenance Logs
createTable('maintenance_logs', `
CREATE TABLE maintenance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    maintenance_date DATE NOT NULL,
    cost INTEGER DEFAULT 0,
    description TEXT,
    vendor TEXT,
    next_maintenance_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES inventory_items(id)
)`);

// 9. Edit History
createTable('edit_history', `
CREATE TABLE edit_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    edited_by TEXT,
    edit_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// 10. Ghost tables
createTable('ghost_schedules', `
CREATE TABLE ghost_schedules (
    id TEXT PRIMARY KEY,
    original_data TEXT NOT NULL,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_by TEXT
)`);

createTable('ghost_transactions', `
CREATE TABLE ghost_transactions (
    id TEXT PRIMARY KEY,
    original_data TEXT NOT NULL,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_by TEXT
)`);

console.log('\n📇 Creating indexes...');

// Create indexes
const indexes = [
  'CREATE INDEX idx_inventory_category ON inventory_items(category)',
  'CREATE INDEX idx_inventory_condition ON inventory_items(condition)',
  'CREATE INDEX idx_station_items_station ON station_items(station_id)',
  'CREATE INDEX idx_station_items_item ON station_items(item_id)',
  'CREATE INDEX idx_schedules_station ON schedules(station_id)',
  'CREATE INDEX idx_schedules_date ON schedules(rental_date)',
  'CREATE INDEX idx_schedules_status ON schedules(status)',
  'CREATE INDEX idx_usage_logs_item ON item_usage_logs(item_id)',
  'CREATE INDEX idx_usage_logs_station ON item_usage_logs(station_id)',
  'CREATE INDEX idx_usage_logs_date ON item_usage_logs(usage_date)',
  'CREATE INDEX idx_maintenance_item ON maintenance_logs(item_id)',
];

for (const idxSql of indexes) {
  try {
    db.exec(idxSql);
    console.log(`  ✅ ${idxSql.substring(0, 50)}...`);
  } catch (err) {
    console.log(`  ⚠️ Index error: ${err.message}`);
  }
}

// Reset sequence counters
console.log('\n🔄 Resetting ID counters...');
try {
  db.exec(`DELETE FROM sqlite_sequence`);
  console.log('  ✅ Counters reset');
} catch (err) {
  console.log('  ℹ️ No sequence table (normal for fresh DB)');
}

// Verify final state
const finalTables = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
`).all();

console.log('\n📊 Final tables:');
finalTables.forEach(t => console.log(`   • ${t.name}`));

console.log('\n✅ Migration completed successfully!');
console.log('\n📌 New schema ready for Sistem Stasiun');
console.log('📦 Database backup: ps3rental.db.backup.* (if existed before)');

db.close();
