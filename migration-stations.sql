-- ============================================
-- MIGRATION: Sistem Stasiun
-- Reset: Drop semua tabel existing, create schema baru
-- ============================================

-- ============================================
-- 1. DROP TABEL EXISTING (Fresh Start)
-- ============================================

-- Drop tabel lama
DROP TABLE IF EXISTS inventory_usage;
DROP TABLE IF EXISTS inventory_maintenance;
DROP TABLE IF EXISTS inventory_pairing_items;
DROP TABLE IF EXISTS inventory_pairings;
DROP TABLE IF EXISTS inventory_items;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS units;
DROP TABLE IF EXISTS ghost_schedules;
DROP TABLE IF EXISTS ghost_transactions;
DROP TABLE IF EXISTS ghost_expenses;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS deleted_units;

-- ============================================
-- 2. CREATE TABEL BARU
-- ============================================

-- Inventory Items (Master data barang)
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
);

-- Inventory Pairings (Stasiun/Home Setup)
CREATE TABLE inventory_pairings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    location TEXT DEFAULT 'Ruang Utama',
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Inventory Pairing Items (Komposisi item dalam stasiun)
CREATE TABLE inventory_pairing_items (
    station_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    role TEXT NOT NULL, -- konsol, tv, stik_1, stik_2, ..., hdmi, charger_1, charger_2, plug
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (station_id, item_id),
    FOREIGN KEY (station_id) REFERENCES inventory_pairings(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
);

-- Inventory Pairing History (Tracking perubahan komposisi)
CREATE TABLE inventory_pairing_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    old_station_id TEXT,
    new_station_id TEXT,
    change_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    reason TEXT,
    FOREIGN KEY (item_id) REFERENCES inventory_items(id),
    FOREIGN KEY (old_station_id) REFERENCES inventory_pairings(id),
    FOREIGN KEY (new_station_id) REFERENCES inventory_pairings(id)
);

-- Schedules (Jadwal rental - menggunakan station_id)
CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    station_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT,
    rental_date DATE NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration INTEGER NOT NULL, -- dalam menit
    price INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'completed', 'cancelled')),
    notes TEXT,
    tx_id TEXT UNIQUE,
    edit_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (station_id) REFERENCES inventory_pairings(id)
);

-- Transactions (Pendapatan & Pengeluaran)
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
    FOREIGN KEY (station_id) REFERENCES inventory_pairings(id),
    FOREIGN KEY (schedule_id) REFERENCES schedules(id)
);

-- Item Usage Logs (Tracking pemakaian otomatis)
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
    FOREIGN KEY (station_id) REFERENCES inventory_pairings(id)
);

-- Maintenance Logs (Riwayat perawatan)
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
);

-- Edit History (Audit trail)
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
);

-- Ghost Records (Soft deleted data)
CREATE TABLE ghost_schedules (
    id TEXT PRIMARY KEY,
    original_data TEXT NOT NULL,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_by TEXT
);

CREATE TABLE ghost_transactions (
    id TEXT PRIMARY KEY,
    original_data TEXT NOT NULL,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_by TEXT
);

-- ============================================
-- 3. INDEXES (Performance)
-- ============================================

CREATE INDEX idx_inventory_category ON inventory_items(category);
CREATE INDEX idx_inventory_condition ON inventory_items(condition);
CREATE INDEX idx_inventory_pairing_items_station ON inventory_pairing_items(station_id);
CREATE INDEX idx_inventory_pairing_items_item ON inventory_pairing_items(item_id);
CREATE INDEX idx_schedules_station ON schedules(station_id);
CREATE INDEX idx_schedules_date ON schedules(rental_date);
CREATE INDEX idx_schedules_status ON schedules(status);
CREATE INDEX idx_usage_logs_item ON item_usage_logs(item_id);
CREATE INDEX idx_usage_logs_station ON item_usage_logs(station_id);
CREATE INDEX idx_usage_logs_date ON item_usage_logs(usage_date);
CREATE INDEX idx_maintenance_item ON maintenance_logs(item_id);

-- ============================================
-- 4. RESET COUNTERS (ID Generator)
-- ============================================

DELETE FROM sqlite_sequence WHERE name IN ('item_usage_logs', 'maintenance_logs', 'edit_history', 'inventory_pairing_history');

-- ============================================
-- 5. SEED DATA (Contoh stasiun dan item)
-- ============================================

-- Contoh Item Inventory (bisa dihapus kalau mau truly clean)
-- INSERT INTO inventory_items (id, name, category, purchase_cost) VALUES
-- ('PS3-01', 'PlayStation 3 Slim 120GB', 'ps3', 1500000),
-- ('TV-01', 'Samsung 32 inch HD', 'tv', 2500000),
-- ('STK-01', 'Stik PS3 Original', 'stik', 300000),
-- ('STK-02', 'Stik PS3 Original', 'stik', 300000),
-- ('USB-01', 'Kabel Charger PS3 3m', 'usb', 50000),
-- ('HDMI-01', 'Kabel HDMI 2m', 'hdmi', 75000),
-- ('PLUG-01', 'Kabel Power PS3', 'plug', 35000);

-- Contoh Stasiun
-- INSERT INTO stations (id, name, description, location) VALUES
-- ('HOME-01', 'Stasiun Yamanaka', 'Setup utama di ruang depan', 'Ruang Depan'),
-- ('HOME-02', 'Stasiun Sasuke', 'Setup di ruang belakang', 'Ruang Belakang');

-- Komposisi Stasiun (valid: 1 konsol, 1 tv, 2 stik, 1 charger, 1 hdmi, 1 plug)
-- INSERT INTO station_items (station_id, item_id, role) VALUES
-- ('HOME-01', 'PS3-01', 'konsol'),
-- ('HOME-01', 'TV-01', 'tv'),
-- ('HOME-01', 'STK-01', 'stik_1'),
-- ('HOME-01', 'STK-02', 'stik_2'),
-- ('HOME-01', 'USB-01', 'charger_1'),
-- ('HOME-01', 'HDMI-01', 'hdmi'),
-- ('HOME-01', 'PLUG-01', 'plug');

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
