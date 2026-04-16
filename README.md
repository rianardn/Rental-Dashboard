# 🎮 PS3 Rental Dashboard - Full Stack Management System

A complete rental management solution for PlayStation 3 rental businesses, featuring authentic PS3 2006-2007 aesthetic design, real-time operations, comprehensive business analytics, and multi-theme support.

![Version](https://img.shields.io/badge/version-3.5.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Fly.io-orange)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)

---

## ✨ Core Features

### 🕹️ **Rental Operations**
- **Real-time Dashboard**: Live countdown/count-up timers with 1-second polling
- **Station Management**: Support unlimited PS3 stations with individual tracking
- **Flexible Duration**: 1-5 hour presets, custom minutes, or unlimited sessions
- **WIB Timezone**: Indonesia Western Time (UTC+7) throughout the application
- **Audio Alert System**: 4 unique chill jingles for final 30-second warnings
- **Draggable Warning Bubbles**: Floating orange/red bubbles for stations with <5 minutes remaining (drag to reposition)

### 🎨 **Multi-Theme System**
- **PS3 Classic**: Authentic black/silver/red PS3 2006-2007 aesthetic
- **Dark Night**: Deep blue midnight theme for low-light environments
- **Dynamic Switching**: Instant theme changes with smooth CSS transitions
- **Persistent Preference**: Theme selection saved to localStorage

### 💳 **Payment Methods Management**
- **Custom Payment Methods**: Add/remove payment types (Cash, QRIS, Transfer, etc.)
- **Balance Tracking**: Real-time balance calculation per payment method
- **Transaction Linking**: All income/expense records linked to payment methods
- **Icon Support**: Emoji icons for visual identification

### 📊 **Financial Management**
- **Transaction IDs**: Auto-generated sequential IDs (PSM-0001, PSM-0002...)
- **Payment Methods**: Cash, QRIS, Bank Transfer, and custom methods tracking
- **Expense Tracking**: Categorized expenses with sub-categories (PSK-0001, PSK-0002...)
- **Daily Reports**: Income, expense, and profit analysis with date range filtering
- **CSV Export**: One-click export for accounting purposes
- **Full Backup/Restore**: JSON export/import with "I AGREE" safety confirmation

### 📅 **Booking & Scheduling**
- **Schedule IDs**: Auto-generated booking IDs (PSJ-0001, PSJ-0002...)
- **Advance Bookings**: Record customer reservations with phone, date, time, duration
- **Conflict Detection**: Automatic overlap detection for station reservations
- **Status Tracking**: Pending, Active, Completed, Cancelled states
- **Mobile-first Design**: Optimized for phone-based booking management

### 📦 **Asset & Inventory Management**
- **Inventory Tracking**: Full equipment lifecycle management with unique IDs
- **Item ID Format**: 
  - Konsol PS3: `PS3-01`, `PS3-02`...
  - TV/Monitor: `TV-01`, `TV-02`...
  - Stik Controller: `STK-01`, `STK-02`...
  - Kabel USB: `USB-01`, `USB-02`...
  - Kabel HDMI: `HDMI-01`, `HDMI-02`...
  - Kabel Power: `PLUG-01`, `PLUG-02`...
  - Lainnya: `LAIN-01`, `LAIN-02`...
- **Categories**: 🎮 Konsol, 📺 TV, 🕹️ Stik, 🔌 Kabel USB, 🔌 Kabel HDMI, 🔌 Kabel Power, 📦 Lainnya
- **Condition States**: 🟢 Baik, 🔴 Rusak, 🟡 Dalam Perbaikan, ⚫ Rusak Total
- **Purchase Logging**: Date, price, vendor tracking for all assets
- **Storage Locations**: Track where each item is stored
- **Usage Tracking**: Auto-track usage hours from rental data (for Konsol/TV)
- **Depreciation**: Automatic book value calculation

### 🔗 **Inventory Pairing (Station) System**
- **Station IDs**: `HOME-01`, `HOME-02`...
- **Flexible Pairing**: Bundle Konsol + TV + Stik + Kabel into a Station
- **Dynamic Assignment**: One item can belong to multiple pairings over time
- **Pairing History**: Track when items were added/removed from stations
- **Quick Swap**: One-click move all accessories to a different Konsol
- **Cost Analysis**: Per-station revenue vs operational cost
- **Performance Ranking**: Which station generates most revenue
- **Break-even Analysis**: ROI per station based on usage

### 💰 **Capital & ROI Analysis**
- **Initial Capital Recording**: Log startup investments
- **Capital Expenses**: Track equipment purchases and setup costs
- **ROI Projections**: 
  - Average and median daily revenue calculation
  - Break-even point estimation (days to recover investment)
  - Monthly profit projections post break-even
- **Visual Flow**: Green for capital in, Red for expenses

### 🔒 **Audit & Compliance**
- **Soft-delete System**: Nothing is permanently deleted
- **Deletion Audit Trail**: Full JSON snapshots with reasons and timestamps
- **Edit History**: Complete change tracking (old value → new value)
- **Deletion Reasons**: Required 3+ character reason for all deletions
- **History Viewer**: View edit and deletion logs per transaction

### 🔍 **Discord-style Search & Filter**
- **Transaction Search**: TX ID, Customer name, Unit name (partial match with highlight)
- **Expense Search**: TX ID, Category, Sub-category, Item name, Notes
- **Advanced Filters**: Amount range, Date range, Payment method
- **Autocomplete**: Smart suggestions for customers, units, categories
- **Pagination**: 20-50 items per page with total count
- **Sort Options**: Date, Amount, Customer, Unit, TX ID (asc/desc)

---

## 🎨 Design System

### PS3 2006-2007 Aesthetic
Authentic PlayStation 3 launch-era visual design:

| Element | Value | Usage |
|---------|-------|-------|
| Background | `#000000` | Primary background |
| Chrome Silver | `#C0C0C0` | Accents, borders, ID badges |
| PlayStation Red | `#e60012` | Highlights, active states, warnings |
| Header Font | Orbitron | Titles, branding |
| Body Font | Rajdhani | Content, data display |
| Icons | System Emoji | Native, fast rendering |

### ID Badge System
All records display silver-colored unique IDs with hyphen format:

| Type | Format | Description |
|------|--------|-------------|
| **Income** | `PSM-0001` | PlayStation Masuk - Transaction ID |
| **Expense** | `PSK-0001` | PlayStation Keluar - Expense ID |
| **Schedule** | `PSJ-0001` | PlayStation Jadwal - Booking ID |
| **Konsol** | `PS3-01` | PS3 Console inventory |
| **TV/Monitor** | `TV-01` | Display inventory |
| **Stik** | `STK-01` | Controller inventory |
| **Kabel USB** | `USB-01` | USB cable inventory |
| **Kabel HDMI** | `HDMI-01` | HDMI cable inventory |
| **Kabel Power** | `PLUG-01` | Power cable inventory |
| **Lainnya** | `LAIN-01` | Other items |
| **Station** | `HOME-01` | Pairing/Station ID |

---

## 🚀 Deployment

### Fly.io (Production)

```bash
# Deploy to Fly.io (Singapore region)
fly deploy --app rental-dashboard

# Check deployment status
fly status --app rental-dashboard

# Monitor logs in real-time
fly logs --app rental-dashboard -f
```

**Live Instance**: https://rental.blockchainism.store

### Local Development

```bash
# Clone repository
git clone https://github.com/rianardn/Rental-Dashboard.git
cd Rental-Dashboard

# Install dependencies
npm install

# Start development server
npm start

# Open browser
open http://localhost:3000
```

### Environment Configuration

Create `.env` file:
```env
ADMIN_PASSWORD=your-secure-password
JWT_SECRET=your-random-secret
NODE_ENV=production
DATA_DIR=./data
PORT=3000
```

Generate secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📱 Usage Guide

### Dashboard Operations

**Starting a Rental:**
1. Click the station card
2. Enter customer name and phone (optional)
3. Select duration: Preset (1-5 hours), Custom minutes, or Unlimited
4. Select payment method
5. Click "Start"
6. Timer begins with WIB timestamp

**Audio Alerts:**
- Final 30 seconds: Gentle jingle plays (4 different patterns cycle by unit)
- "Stop Alarm" button appears during jingle playback
- Auto-stops after 30 seconds or manual mute

**Warning Bubbles:**
- Orange bubble: < 5 minutes remaining (draggable)
- Red bubble: Time expired (draggable)
- Click bubble to jump to station
- Drag to reposition anywhere on screen

**Extending Sessions:**
- Click "+15min" or "+30min" during active session
- Or stop and start new session

### Management Page (Manajemen)

Access via 📋 button in navigation.

#### 📅 Jadwal (Booking Schedule)
- **Create**: Customer name, phone, date range, time, duration, station assignment
- **Conflict Detection**: System warns if station already booked
- **Today's View**: Today's bookings highlighted in red
- **Quick Actions**: Start (converts to rental), Complete, Cancel, Delete
- **ID Display**: Each schedule shows `PSJxxxxx` badge

#### 💳 Metode Pembayaran (Payment Methods)
- **Add Methods**: Name + Type (Cash/Card/Wallet/Bank)
- **Balance Tracking**: Auto-calculated from transactions
- **Edit/Delete**: Modify existing methods
- **Icons**: Emoji selection for visual identification

#### 📦 Inventory (Asset Tracking)
- **Categories**: 🎮 Konsol, 📺 TV, 🕹️ Stik, 🔌 Kabel USB, 🔌 Kabel HDMI, 🔌 Kabel Power, 📦 Lainnya
- **Item IDs**: Auto-generated per category (PS3-01, TV-01, STK-01, etc.)
- **Condition**: 🟢 Baik / 🔴 Rusak / 🟡 Dalam Perbaikan / ⚫ Rusak Total
- **Purchase Info**: Date, price, vendor, warranty
- **Usage Stats**: Auto-tracked hours for Konsol/TV from rental data
- **Book Value**: Depreciation tracking over time
- **Maintenance Log**: Service history with costs
- **Visual Grid**: Grouped by category with emoji icons

#### 🔗 Station Pairing
- **Create Station**: `HOME-01`, `HOME-02`...
- **Composition**: Konsol (1) + TV (1) + Stik (0-2) + Kabel (unlimited)
- **Quick Swap**: Move all accessories to different Konsol in one click
- **Analytics**: Cost/revenue per station, usage ranking
- **History**: Track item movements between stations

#### 💰 Modal Awal (Capital & ROI)
- **Capital In**: Record initial investment
- **Capital Out**: Log equipment purchases, renovations, setup costs
- **ROI Calculator**: Automatic projections based on historical revenue
- **Summary Cards**: Total capital, spent, remaining, break-even estimate

#### 🎮 Unit Management
- **Add Unit**: Create new PS3/TV units
- **Rename**: Update unit names
- **Delete**: Remove inactive units only (safety check)
- **Grid View**: Visual status indicators

### Reports & Analytics

**Daily Reports:**
- Filter by date range (preset or custom)
- Income breakdown by payment method
- Expense breakdown by category
- Net profit calculation
- Per-station revenue analysis

**Export Options:**
- **CSV**: For Excel/accounting software
- **JSON**: Full data backup
- **Import**: Restore from JSON (with "I AGREE" safety check)

### Search & Filter System

**Transactions (Income):**
```
Search: PSM-0001 (TX ID partial match with hyphen)
Customer: Auto-complete with highlight
Unit: Auto-complete with highlight
Payment: Cash / QRIS / Transfer
Amount: Min / Max range
Date: From / To picker
Sort: Date / Amount / Customer / Unit / TX ID
```

**Expenses:**
```
Search: PSK-0001 (TX ID partial match with hyphen)
Tipe Biaya: Dropdown (matches submission form)
Sub-Kategori: Dynamic dropdown (for Servis & Aksesoris)
Item: Auto-complete
Note: Text search
Amount: Min / Max range
Date: From / To picker
```

**Inventory:**
```
Search: PS3-01, TV-02, STK-01 (Item ID)
Category: Konsol / TV / Stik / Kabel USB / Kabel HDMI / Kabel Power / Lainnya
Condition: Baik / Rusak / Perbaikan / Rusak Total
Location: Text search
Vendor: Text search
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Node.js + Express                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Dashboard   │  │  Management  │  │   Reports    │       │
│  │   (UI)       │  │    (UI)      │  │    (UI)      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
├─────────────────────────────────────────────────────────────┤
│  REST API Routes                                              │
│  ├── /api/auth/*       (JWT authentication)                   │
│  ├── /api/units/*      (Rental operations)                  │
│  ├── /api/transactions (Income CRUD + search)               │
│  ├── /api/expenses     (Expense CRUD + search)              │
│  ├── /api/schedules    (Booking management)                 │
│  ├── /api/inventory    (Asset tracking)                     │
│  ├── /api/pairings     (Station management)                 │
│  ├── /api/capital      (Capital & ROI)                      │
│  ├── /api/reports      (Analytics & export)                 │
│  ├── /api/payment-methods (Payment method management)       │
│  └── /api/db           (Import/Export)                      │
├─────────────────────────────────────────────────────────────┤
│  Middleware                                                   │
│  ├── JWT Auth verification                                  │
│  ├── CORS protection                                        │
│  ├── Request logging                                        │
│  └── Error handling                                         │
├─────────────────────────────────────────────────────────────┤
│  SQLite Database (better-sqlite3)                             │
│  ├── settings               (Business configuration)        │
│  ├── units                  (Rental units)                  │
│  ├── transactions           (Income with PSM-0001 IDs)      │
│  ├── expenses               (Expense with PSK-0001 IDs)     │
│  ├── schedules              (Bookings with PSJ-0001 IDs)    │
│  ├── inventory_items        (Assets: PS3-01, TV-01, etc.) │
│  ├── inventory_pairings     (Stations: HOME-01, etc.)     │
│  ├── inventory_pairing_items (Station composition)          │
│  ├── inventory_maintenance  (Service history)               │
│  ├── inventory_usage        (Usage tracking)                │
│  ├── inventory_depreciation (Asset depreciation)            │
│  ├── inventory_pairing_history (Change tracking)            │
│  ├── capital                (Initial capital & expenses)  │
│  ├── payment_methods        (Custom payment methods)        │
│  ├── sessions               (JWT token storage)             │
│  ├── edit_logs              (Edit audit trail)              │
│  └── deletion_logs          (Soft-delete compliance)        │
├─────────────────────────────────────────────────────────────┤
│  Persistence                                                  │
│  └── Fly.io Volume: ps3_data → /app/data                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📡 API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Authenticate with password |
| GET | `/api/auth/verify` | Verify JWT token validity |

### Units & Rentals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/units` | List all units |
| POST | `/api/units` | Add new unit |
| POST | `/api/units/:id/start` | Start rental session |
| POST | `/api/units/:id/stop` | Stop rental session |
| POST | `/api/units/:id/extend` | Extend active session |

### Transactions (Income)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/transactions` | List with search/filter/pagination |
| POST | `/api/transactions` | Create income record |
| PUT | `/api/transactions/:id` | Update transaction |
| DELETE | `/api/transactions/:id` | Soft-delete (requires reason) |
| GET | `/api/transactions/:id/edits` | Get edit history |

**Query Parameters for GET /api/transactions:**
```
search      - Partial TX ID match (PSM-0001)
customer    - Customer name filter (partial, case-insensitive)
unit        - Unit name filter (partial, case-insensitive)
payment     - cash | qris | transfer
amountMin   - Minimum amount
amountMax   - Maximum amount
dateFrom    - Start date (YYYY-MM-DD)
dateTo      - End date (YYYY-MM-DD)
sortBy      - date | amount | customer | unit | id | created
sortOrder   - asc | desc
limit       - Results per page (default: 100)
offset      - Pagination offset
```

### Expenses
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/expenses` | List with search/filter/pagination |
| POST | `/api/expenses` | Create expense record |
| PUT | `/api/expenses/:id` | Update expense |
| DELETE | `/api/expenses/:id` | Soft-delete (requires reason) |
| GET | `/api/expenses/:id/edits` | Get edit history |
| GET | `/api/expense-categories` | Autocomplete categories |
| GET | `/api/expense-items` | Autocomplete items |

### Schedules (Bookings)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/schedules` | List all bookings |
| POST | `/api/schedules` | Create booking (auto-assigns PSJ-0001) |
| PUT | `/api/schedules/:id` | Update booking |
| DELETE | `/api/schedules/:id` | Delete booking |

### Inventory
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inventory` | List all assets with filters |
| POST | `/api/inventory` | Add asset (auto-generates ID: PS3-01, TV-01, etc.) |
| GET | `/api/inventory/:id` | Get single asset with full details |
| PUT | `/api/inventory/:id` | Update asset |
| DELETE | `/api/inventory/:id` | Soft-delete asset |
| POST | `/api/inventory/:id/maintenance` | Add maintenance record |
| GET | `/api/inventory/:id/maintenance` | Get maintenance history |
| GET | `/api/inventory/:id/usage` | Get usage statistics |
| GET | `/api/inventory/:id/depreciation` | Get depreciation history |

### Inventory Pairings (Stations)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pairings` | List all stations |
| POST | `/api/pairings` | Create station (auto-assigns HOME-01) |
| GET | `/api/pairings/:id` | Get station with items |
| PUT | `/api/pairings/:id` | Update station |
| DELETE | `/api/pairings/:id` | Delete station |
| POST | `/api/pairings/:id/items` | Add item to station |
| DELETE | `/api/pairings/:id/items/:itemId` | Remove item from station |
| POST | `/api/pairings/swap` | Quick swap items between stations |
| GET | `/api/pairings/:id/analysis` | Get cost/revenue analysis |
| GET | `/api/pairings/:id/history` | Get pairing change history |

### Payment Methods
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/payment-methods` | List all payment methods |
| POST | `/api/payment-methods` | Create payment method |
| PUT | `/api/payment-methods/:id` | Update payment method |
| DELETE | `/api/payment-methods/:id` | Delete payment method |
| GET | `/api/payment-methods/:id/balance` | Get calculated balance |

### Inventory Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/inventory/analytics` | Global analytics (top performer, etc.) |
| GET | `/api/inventory/categories` | List category counts |
| GET | `/api/inventory/locations` | List location counts |

### Capital & ROI
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/capital` | Get capital summary & history |
| POST | `/api/capital` | Add initial capital |
| POST | `/api/capital/expenses` | Add capital expense |
| DELETE | `/api/capital/expenses/:id` | Delete capital expense |
| GET | `/api/stats/roi` | Get ROI projections |

### Audit Trail
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/deletion-logs` | Get deletion audit trail |
| GET | `/api/deletion-logs?recordType=transaction` | Filter by type |

### Data Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/db` | Export full database as JSON |
| PUT | `/api/db` | Import database (requires "I AGREE") |
| GET | `/api/settings` | Get business settings |
| PUT | `/api/settings` | Update settings |

---

## 🔒 Security Features

| Feature | Implementation |
|---------|---------------|
| Authentication | JWT with 24-hour expiration |
| Password Hashing | HMAC-SHA256 |
| SQL Injection Prevention | Parameterized queries |
| CORS | Configured for production domain |
| Data Validation | Server-side validation on all inputs |
| Import Safety | "I AGREE" confirmation required |
| Audit Logging | All edits and deletions tracked |

---

## 💾 Database Schema

### Core Tables

**units**
```sql
id (INTEGER PRIMARY KEY)
name (TEXT)
status (TEXT: available/rented)
currentCustomer (TEXT)
startTime (INTEGER)
duration (INTEGER)
endTime (INTEGER)
phone (TEXT)
notes (TEXT)
order (INTEGER)
```

**transactions** (Income)
```sql
id (INTEGER PRIMARY KEY)
transactionId (TEXT UNIQUE) - Format: PSM-0001 (hyphenated)
customerName (TEXT)
unitName (TEXT)
amount (INTEGER)
paymentMethod (TEXT: cash/qris/transfer)
date (TEXT YYYY-MM-DD)
startTime (TEXT)
endTime (TEXT)
duration (INTEGER)
notes (TEXT)
createdAt (INTEGER)
```

**expenses**
```sql
id (INTEGER PRIMARY KEY)
expenseId (TEXT UNIQUE) - Format: PSK-0001 (hyphenated)
category (TEXT)
subCategory (TEXT)
item (TEXT)
amount (INTEGER)
date (TEXT YYYY-MM-DD)
notes (TEXT)
createdAt (INTEGER)
```

**schedules** (Bookings)
```sql
id (INTEGER PRIMARY KEY)
scheduleId (TEXT UNIQUE) - Format: PSJ-0001 (hyphenated)
customerName (TEXT)
phone (TEXT)
startDate (TEXT)
endDate (TEXT)
startTime (TEXT)
endTime (TEXT)
duration (INTEGER)
unitId (INTEGER)
unitName (TEXT)
notes (TEXT)
status (TEXT: pending/active/completed/cancelled)
createdAt (INTEGER)
```

**inventory_items**
```sql
id (TEXT PRIMARY KEY) - Format: PS3-01, TV-01, STK-01, etc.
name (TEXT)
category (TEXT: konsol/tv/stik/kabel_usb/kabel_hdmi/kabel_power/lainnya)
subcategory (TEXT)
purchase_date (TEXT)
purchase_cost (INTEGER)
vendor (TEXT)
warranty_info (TEXT)
condition (TEXT: baik/rusak/perbaikan/rusak_total)
current_location (TEXT)
notes (TEXT)
photo_url (TEXT)
is_active (INTEGER DEFAULT 1)
created_at (INTEGER)
updated_at (INTEGER)
```

**inventory_pairings** (Stations)
```sql
id (TEXT PRIMARY KEY) - Format: HOME-01, HOME-02...
name (TEXT)
description (TEXT)
is_active (INTEGER DEFAULT 1)
created_at (INTEGER)
updated_at (INTEGER)
```

**inventory_pairing_items**
```sql
pairing_id (TEXT) - Reference to inventory_pairings
item_id (TEXT) - Reference to inventory_items
role (TEXT: konsol/tv/stik1/stik2/hdmi/charger/etc)
added_date (TEXT)
notes (TEXT)
PRIMARY KEY (pairing_id, item_id)
```

**inventory_maintenance**
```sql
id (INTEGER PRIMARY KEY)
item_id (TEXT) - Reference to inventory_items
maintenance_date (TEXT)
cost (INTEGER)
description (TEXT)
vendor (TEXT)
next_scheduled_maintenance (TEXT)
created_at (INTEGER)
```

**inventory_usage**
```sql
id (INTEGER PRIMARY KEY)
item_id (TEXT) - Reference to inventory_items
date (TEXT)
hours_used (INTEGER)
source (TEXT: auto_from_schedule/manual_input)
pairing_id (TEXT) - Nullable, reference to inventory_pairings
created_at (INTEGER)
```

**inventory_depreciation**
```sql
id (INTEGER PRIMARY KEY)
item_id (TEXT) - Reference to inventory_items
depreciation_date (TEXT)
book_value (INTEGER)
depreciation_method (TEXT: straight_line/declining)
created_at (INTEGER)
```

**inventory_pairing_history**
```sql
id (INTEGER PRIMARY KEY)
item_id (TEXT) - Reference to inventory_items
old_pairing_id (TEXT) - Nullable
new_pairing_id (TEXT) - Nullable
change_date (TEXT)
reason (TEXT)
changed_by (TEXT)
```

**payment_methods**
```sql
id (TEXT PRIMARY KEY) - UUID format
name (TEXT)
type (TEXT: cash/card/wallet/bank)
icon (TEXT)
balance (INTEGER DEFAULT 0)
is_active (INTEGER DEFAULT 1)
created_at (INTEGER)
updated_at (INTEGER)
```

**capital**
```sql
id (INTEGER PRIMARY KEY)
type (TEXT: initial/expense)
amount (INTEGER)
description (TEXT)
date (TEXT YYYY-MM-DD)
createdAt (INTEGER)
```

**edit_logs** (Audit Trail)
```sql
id (INTEGER PRIMARY KEY)
recordType (TEXT: transaction/expense)
recordId (INTEGER)
fieldName (TEXT)
oldValue (TEXT)
newValue (TEXT)
editedAt (INTEGER)
editedBy (TEXT)
```

**deletion_logs** (Compliance)
```sql
id (INTEGER PRIMARY KEY)
recordType (TEXT)
recordId (INTEGER)
recordData (TEXT JSON)
reason (TEXT)
deletedAt (INTEGER)
deletedBy (TEXT)
```

---

## 🧪 Testing

### Health Check
```bash
curl https://rental.blockchainism.store/ping
```

### Authentication Test
```bash
curl -X POST https://rental.blockchainism.store/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "***"}'
```

### API Test Examples
```bash
# Get units
curl -H "Authorization: Bearer *** \
  https://rental.blockchainism.store/api/units

# Search transactions
curl -H "Authorization: Bearer *** \
  "https://rental.blockchainism.store/api/transactions?search=PSM&limit=10"

# Get ROI stats
curl -H "Authorization: Bearer *** \
  https://rental.blockchainism.store/api/stats/roi
```

---

## ⚙️ Customization

### Change Theme
Access Settings modal → Themes tab:
- **PS3 Classic**: Black/Silver/Red authentic 2006-2007 aesthetic
- **Dark Night**: Deep blue theme for low-light operation

Or programmatically:
```javascript
localStorage.setItem('ps3_theme', 'dark-night');
location.reload();
```

### Adjust Audio Patterns
Edit `JINGLE_PATTERNS` in `public/app.js`:
```javascript
const JINGLE_PATTERNS = [
  [432, 0, 528, 0, 639],  // Unit 1 (meditation)
  [600, 550, 500, 450],   // Unit 2 (wind chimes)
  [396, 0, 396, 528],     // Unit 3 (tibetan bowl)
  [400, 500, 600, 700]    // Unit 4 (ocean)
];
```

### Modify Warning Threshold
```javascript
const FINAL_ALERT_SECONDS = 30; // Change to 60 for 1-minute warning
```

---

## 📈 Performance Metrics

| Metric | Value |
|--------|-------|
| Memory Usage | ~80MB idle |
| Cold Start | < 2 seconds |
| API Response | < 50ms average |
| Database | 10K+ transactions tested |
| Polling Interval | 1 second |
| Audio Latency | < 100ms |
| Concurrent Users | Unlimited (stateless) |
| Theme Switch | Instant (CSS variables) |

---

## 📋 Changelog

### v3.5.0 (2025-04-15)
- **Multi-Theme System**: PS3 Classic + Dark Night themes with instant switching
- **Draggable Warning Bubbles**: Floating notification bubbles for time warnings
- **Payment Methods Management**: Custom payment methods with balance tracking
- **ES6 Modernization**: Refactored codebase with modern JavaScript patterns

### v3.0.0 (2025-04-11)
- **Schedule ID System**: Implemented PSJxxxxx IDs for all bookings
- **Conflict Detection**: Automatic booking overlap prevention
- **Management Page**: Consolidated 4 modules (Jadwal, Inventory, Capital, Units)
- **ID Badge Display**: All records now show silver-colored unique IDs

### v2.3.0 (2025-04-10)
- **Search & Filter**: Discord-style query system for transactions and expenses
- **Audit Trail**: Complete edit and deletion history tracking
- **ROI Calculator**: Automatic break-even analysis

### v2.2.0 (2025-04-09)
- **Audio Alert System**: 4 unique jingles for session warnings
- **Expense Sub-categories**: Dynamic dropdowns matching submission form

### v2.1.0 (2025-04-08)
- **WIB Timezone**: Full Indonesia Western Time support
- **Import/Export**: JSON backup with safety confirmation

### v2.0.0 (2025-04-07)
- **Initial Release**: Dashboard, rentals, basic reporting

---

## 📝 License

MIT License - See [LICENSE](LICENSE) for details.

---

## 🙏 Credits

- **Design Inspiration**: Sony PlayStation 3 (2006-2007 era)
- **Fonts**: [Orbitron](https://fonts.google.com/specimen/Orbitron), [Rajdhani](https://fonts.google.com/specimen/Rajdhani)
- **Icons**: Native system emoji
- **Audio**: Web Audio API implementation
- **Deployment**: [Fly.io](https://fly.io)
- **Database**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

---

## 📞 Support

For issues or feature requests, please open a GitHub issue or contact the maintainer.

**Live Demo**: https://rental.blockchainism.store
