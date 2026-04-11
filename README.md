# 🎮 PS3 Rental Manager - Full Stack

A complete rental management solution for PlayStation 3 rental businesses.

![Version](https://img.shields.io/badge/version-2.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- 📱 **Responsive Mobile & Desktop UI**: Optimized for mobile, tablet, and desktop
- 🔐 **Secure Authentication**: Password-protected with JWT
- 💾 **Persistent Storage**: SQLite database (auto-migrated) with volume persistence
- 📊 **Real-time Dashboard**: Auto-refreshing timers & stats (1s polling)
- ⏱️ **Real-time WIB Clock**: Indonesia timezone (UTC+7) in header
- 📈 **Reports & Analytics**: Daily, weekly, monthly, yearly views
- 💾 **Import/Export**: JSON backup & CSV export with "I AGREE" confirmation
- 💸 **Expense Tracking**: Track business expenses
- 🔔 **Audio Alert System**: Chill/relaxing jingles in the final 30 seconds
- 🔕 **Mute Button**: Stop alarm button appears when jingle is playing
- ⏲️ **Flexible Duration**: Dropdown 1-5 Hours, Custom minutes, or Unlimited
- 🗑️ **Audit Trail for Deletions**: Full deletion logging with reason tracking
- ✏️ **Edit History**: Track all changes to income and expense records

## 🎨 PS3 2006-2007 Design

Authentic PlayStation 3 aesthetic with:
- Black background (#000000)
- Chrome silver accents (linear-gradient)
- PlayStation red highlights (#e60012)
- Orbitron & Rajdhani display fonts
- Glowing red effects on active sessions

## 🚀 Deployment

### Fly.io (Production)
```bash
# Deploy to Fly.io (Singapore region)
fly deploy

# Check status
fly status

# View logs
fly logs -a rental-dashboard
```

### Local Development

```bash
# Clone
git clone https://github.com/rianardn/Rental-Dashboard.git
cd Rental-Dashboard

# Install
npm install

# Run
npm start

# Open http://localhost:3000
```

### Environment Variables

Create `.env` file:
```
ADMIN_PASSWORD=your-secure-password
JWT_SECRET=your-random-secret-key
NODE_ENV=production
DATA_DIR=./data
```

Generate secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 📱 Usage

### Dashboard
- View all units at a glance
- Start/stop rental sessions
- Real-time countdown/count-up timers with WIB timezone
- Customer notes & session details
- **Select duration**: 1-5 Hours, Custom (minutes), or Unlimited

### Audio Alert System
- **4 Chill Jingles**: Meditation chimes, wind chimes, ocean waves, Tibetan bowl
- **30-Second Final Alert**: Jingle plays only in the last 30 seconds before time expires
- **Mute Button**: "STOP ALARM" button appears when jingle is playing
- Auto-stop after 30 seconds or can be muted manually
- Pattern cycles for unlimited units (Unit 5+ uses jingle 1, 2, etc.)

### Import Safety
- "I AGREE" confirmation before importing data
- Prevents accidental data overwrite
- JSON validation before import

### Audit Trail (Deletion Logging)

**Soft-delete with full audit trail for compliance:**

- 🗑️ **Deletion Confirmation**: Checkbox + reason required before deletion
- 📋 **Complete Audit Log**: Deleted data stored in `deletion_logs` table with:
  - Full JSON snapshot of deleted record
  - Deletion reason (minimum 3 characters)
  - Timestamp (WIB timezone)
  - User who performed deletion
- ✏️ **Edit History**: Track all field changes with old/new values
- 📊 **History Tabs**: View edit history or deletion logs per transaction
- 🔍 **Viewable Logs**: Access deletion history via 📋 button on any record

**Supported Record Types:**
- `transaction` - Income/rental transactions
- `expense` - Business expenses

**API Endpoints:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| DELETE | `/api/transactions/:id` | Delete with reason (body: `{reason}`) |
| DELETE | `/api/expenses/:id` | Delete with reason (body: `{reason}`) |
| GET | `/api/deletion-logs?recordType=` | Get deletion audit trail |
| GET | `/api/transactions/:id/edits` | Get edit history |
| GET | `/api/expenses/:id/edits` | Get edit history |

### Reports
- Filter by date period
- Income/expense/profit tracking
- Export CSV for accounting
- Transaction history

### Search & Filter (Discord-style)

Advanced search and filtering for both income transactions and expenses with Discord-like query capabilities:

**Frontend UI Features:**
- 🔍 Real-time TX ID search with debounce (300ms)
- 👤 **Customer autocomplete filter** with match highlight - Income only
- 🎮 **Unit name autocomplete filter** with match highlight - Income only
- 💳 Payment method filter (Cash, QRIS, Transfer) - Income only
- 🏷️ **Tipe Biaya dropdown** (Expense only) - matches submission form
- 📂 **Sub-Kategori dropdown** (Expense only) - appears for Servis/Perawatan & Aksesoris
- 📝 Note text search (Expense only)
- 💰 Amount range filter (min/max)
- 📅 Date range picker (from/to)
- 📊 Sort options (date, amount, customer, unit, TX ID)
- 📄 Pagination (20-50 items per page)
- 🏷️ Active filter count badge
- 🔄 One-click reset all filters
- ⚡ Instant search response (300ms debounce)

**UX Improvements:**
- 🪟 **Auto-close "All Transactions" modal** when opening Edit/Delete/History modals (prevents z-index layering issues)
- 📱 Mobile-optimized modal transitions
- 🎯 Focus management for accessibility

**Backend SQL Capabilities:**
- Case-insensitive partial matching (COLLATE NOCASE)
- Efficient indexed queries with WHERE clause composition
- Pagination with total count for accurate page indicators

### Settings
- Configure rental rates
- Add/remove/rename units
- Import/export data with safety check
- Manage business settings
- **Warning threshold**: Visual warning setting (minutes)

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         Node.js + Express Server        │
│  ┌─────────────────────────────────┐   │
│  │   Static Files (UI)             │   │
│  ├─────────────────────────────────┤   │
│  │   REST API Routes               │   │
│  ├─────────────────────────────────┤   │
│  │   JWT Auth Middleware           │   │
│  ├─────────────────────────────────┤   │
│  │   SQLite Database               │   │
│  │   (Volume: ps3_data @ /data)    │   │
│  └─────────────────────────────────┘   │
│           ↓ 1s polling                  │
│  ┌─────────────────────────────────┐   │
│  │      Mobile/Tablet/Desktop      │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with password |
| GET | `/api/auth/verify` | Verify token |
| GET | `/api/db` | Export full database |
| PUT | `/api/db` | Import full database |
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/units` | List all units |
| POST | `/api/units` | Add new unit |
| POST | `/api/units/:id/start` | Start rental |
| POST | `/api/units/:id/stop` | Stop rental |
| GET | `/api/transactions` | List transactions with optional search/filter (see below) |
| DELETE | `/api/transactions/:id` | Delete transaction (requires `{reason}`) |
| PUT | `/api/transactions/:id` | Update transaction |
| GET | `/api/transactions/:id/edits` | Get transaction edit history |

### Search & Filter Transactions (Discord-style)

The `GET /api/transactions` endpoint supports Discord-like search and filtering capabilities:

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Partial TX ID match (e.g., `PSM0001`) - case insensitive |
| `customer` | string | Partial customer name filter (case insensitive) |
| `unit` | string | Partial unit name filter (case insensitive) |
| `amountMin` | number | Minimum income amount |
| `amountMax` | number | Maximum income amount |
| `dateFrom` | string | Start date (YYYY-MM-DD, WIB timezone) |
| `dateTo` | string | End date (YYYY-MM-DD, WIB timezone) |
| `payment` | string | Payment method: `cash`, `qris`, `transfer` |
| `sortBy` | string | Sort column: `date` (default), `amount`, `customer`, `unit`, `id`, `created` |
| `sortOrder` | string | Sort direction: `desc` (default), `asc` |
| `limit` | number | Results per page (default: 100, max: 1000) |
| `offset` | number | Pagination offset (default: 0) |

**Example Requests:**

```bash
# Search by TX ID (Discord-like ID search)
GET /api/transactions?search=PSM0001

# Filter by customer and payment method
GET /api/transactions?customer=John&payment=cash

# Filter by unit name (partial match with autocomplete)
GET /api/transactions?unit=PS3-A

# Combined filters: customer, unit, payment
GET /api/transactions?customer=Asep&unit=PS3&payment=cash

# Date range filter with amount range
GET /api/transactions?dateFrom=2025-01-01&dateTo=2025-01-31&amountMin=50000&amountMax=100000

# Combined search with pagination
GET /api/transactions?search=PSM&customer=Asep&payment=qris&sortBy=amount&sortOrder=desc&limit=50&offset=0

# Sort by unit name
GET /api/transactions?sortBy=unit&sortOrder=asc
```

**Response Format:**

```json
{
  "transactions": [...],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  },
  "filters": {
    "search": "PSM",
    "customer": "Asep",
    "unit": "PS3-A",
    "payment": "qris",
    ...
  }
}
```

### Search & Filter Expenses (Discord-style)

The `GET /api/expenses` endpoint supports the same Discord-like search and filtering capabilities as transactions:

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Partial TX ID match (e.g., `PSK0001`) - case insensitive |
| `category` | string | Expense category filter (partial match, case insensitive) |
| `item` | string | Expense item filter (partial match, case insensitive) |
| `amountMin` | number | Minimum expense amount |
| `amountMax` | number | Maximum expense amount |
| `dateFrom` | string | Start date (YYYY-MM-DD, WIB timezone) |
| `dateTo` | string | End date (YYYY-MM-DD, WIB timezone) |
| `note` | string | Search in notes (partial match, case insensitive) |
| `sortBy` | string | Sort column: `date` (default), `amount`, `category`, `item`, `id`, `created` |
| `sortOrder` | string | Sort direction: `desc` (default), `asc` |
| `limit` | number | Results per page (default: 100, max: 1000) |
| `offset` | number | Pagination offset (default: 0) |

**Autocomplete Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/expense-categories?search=&limit=10` | Get unique categories for autocomplete |
| GET | `/api/expense-items?search=&limit=10` | Get unique items for autocomplete |

**Example Requests:**

```bash
# Search by TX ID
GET /api/expenses?search=PSK0001

# Filter by category
GET /api/expenses?category=Makanan

# Date range with amount range
GET /api/expenses?dateFrom=2025-01-01&dateTo=2025-01-31&amountMin=10000&amountMax=50000

# Search in notes
GET /api/expenses?note=sparepart

# Combined filters with pagination
GET /api/expenses?category=Operasional&item=Listrik&sortBy=amount&sortOrder=desc&limit=20&offset=0
```

| GET | `/api/expenses` | List expenses with optional search/filter |
| POST | `/api/expenses` | Add expense |
| DELETE | `/api/expenses/:id` | Delete expense (requires `{reason}`) |
| PUT | `/api/expenses/:id` | Update expense |
| GET | `/api/expenses/:id/edits` | Get expense edit history |
| GET | `/api/deletion-logs` | Get deletion audit trail |
| GET | `/api/reports/summary` | Get report summary |

## 🔒 Security

- JWT-based authentication
- Password hashing with HMAC-SHA256
- SQLite parameter binding (SQL injection safe)
- CORS protection
- Import confirmation dialog (prevent accidental overwrite)
- No sensitive data in logs

## 💾 Database Schema

### Tables
- `settings` - Business configuration (rate per hour, warnBefore, businessName)
- `units` - Rental units (TVs/PS3s) with active status
- `transactions` - Rental history with WIB date
- `expenses` - Business expenses
- `sessions` - Active login tokens
- `edit_logs` - Audit trail for all record modifications
- `deletion_logs` - Audit trail for deleted records (soft-delete compliance)

### Features
- WAL mode for concurrent access
- Automatic schema migrations
- Single-file database (easy backup)
- Volume persistence on Fly.io (`ps3_data` → `/app/data`)

## 📦 Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Auth | JWT + crypto |
| Frontend | Vanilla JS + CSS Grid |
| Fonts | Orbitron, Rajdhani |
| Icons | Emoji (system-native) |
| Audio | Web Audio API (Oscillator + Gain nodes) |
| Timezone | WIB (UTC+7) for Indonesia |

## 🧪 Testing

```bash
# Health check
curl http://localhost:3000/ping

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-password"}'
```

### Audio Testing
```javascript
// Test jingle in browser console
playWarningJingle(0); // Jingle 1
playWarningJingle(1); // Jingle 2
playWarningJingle(2); // Jingle 3
playWarningJingle(3); // Jingle 4

// Stop alarm
stopAlarm();
```

## 📈 Performance

- **Memory**: ~80MB
- **Startup**: < 2 seconds
- **API response**: < 50ms average
- **Database**: Handles 10K+ transactions
- **Polling**: 1s interval (real-time updates)
- **Audio**: 30s continuous with Web Audio API

## 🛠️ Customization

### Change Theme Colors
Edit CSS variables in `public/index.html`:
```css
:root {
  --ps3-red: #e60012;     /* Change to your brand */
  --ps3-silver: #c0c0c0;  /* Chrome accents */
}
```

### Change Audio Patterns
Edit `JINGLE_PATTERNS` array in `public/index.html`:
```javascript
const JINGLE_PATTERNS = [
  [432, 0, 528, 0, 639],  // Unit 1
  [600, 550, 500, 450],   // Unit 2
  // ... custom frequencies (Hz)
];
```

### Change Final Alert Duration
```javascript
const FINAL_ALERT_SECONDS = 30; // Change to 60 for 1 minute
```

### Default Units
Starts with 1 unit (PS 1). Add more units via Settings → "Unit Management" → "Add Unit"

## 📋 Changelog

### v2.2.0 (2025-04-11)
- **Refactored Expense Filter UI**: Unified filter structure with expense submission form
  - Replaced category/item autocomplete with dropdown selects
  - Added dynamic sub-category dropdown for Servis/Perawatan and Aksesoris
  - Consistent UX between submission and filtering

### v2.1.0 (2025-04-10)
- Added search & filter system for expenses (Discord-style)
- Added audit trail for expense deletions
- Added edit history tracking for expenses
- Smart category inference for legacy expense records

### v2.0.0 (2025-04-09)
- Initial production release with Fly.io deployment
- SQLite database with WAL mode
- JWT authentication
- Real-time dashboard with WIB timezone
- Audio alert system with 4 jingles
- PS3 2006-2007 aesthetic design

## 📱 UI Optimization Updates

### Mobile-First Report Page (v2.3.1)
- Fixed negative number display breaking across lines
- Responsive font scaling for stat cards (1.6rem → 1.25rem → 1.1rem)
- Optimized stat card padding for small screens
- Tab buttons now scale down on mobile devices
- Chart section with responsive height and padding
- Export buttons adapt to 2-column or 1-column layout on mobile
- Improved text overflow handling with ellipsis

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Can't login | Check `ADMIN_PASSWORD` env var |
| Database locked | Restart app (WAL auto-recover) |
| Sync not working | Check browser console for errors |
| Audio not playing | Ensure browser tab is not muted (autoplay policy) |
| Alarm won't stop | Click "STOP ALARM" button or wait 30 seconds |
| Import failed | Ensure JSON is valid and click "I AGREE" |

## 🤝 Contributing

1. Fork the repo
2. Create branch: `git checkout -b feature/amazing`
3. Commit: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing`
5. Open Pull Request

## 📄 License

MIT - Feel free to use for your rental business!

## 🙏 Credits

- Design inspired by PlayStation 3 XMB (2006-2007)
- Fonts by Google Fonts (Orbitron, Rajdhani)
- Audio jingles using Web Audio API

---

Made with ❤️ for PS3 rental businesses worldwide.
