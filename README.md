# 🎮 PS3 Rental Manager - Full Stack

A complete rental management solution for PlayStation 3 rental businesses.

![Version](https://img.shields.io/badge/version-2.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- 📱 **Responsive Mobile & Desktop UI**: Optimized untuk HP, tablet, dan laptop
- 🔐 **Secure Authentication**: Password-protected dengan JWT
- 💾 **Persistent Storage**: SQLite database (auto-migrated), data persist via volume
- 📊 **Real-time Dashboard**: Auto-refreshing timers & stats (1s polling)
- ⏱️ **Real-time WIB Clock**: Jam Indonesia (UTC+7) di header
- 📈 **Reports & Analytics**: Daily, weekly, monthly, yearly views
- 💾 **Import/Export**: JSON backup & CSV export dengan konfirmasi "SAYA SETUJU"
- 💸 **Expense Tracking**: Track business expenses
- 🔔 **Audio Alert System**: Jingle chill/relaxing di 30 detik terakhir
- 🔕 **Mute Button**: Tombol matikan alarm saat sedang berbunyi
- ⏲️ **Flexible Duration**: Dropdown 1-5 Jam, Custom menit, atau Tanpa Batas

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
# Deploy ke Fly.io (region Singapore)
fly deploy

# Check status
fly status

# View logs
fly logs -a rental-dashboard
```

**Live URL:** https://rental-dashboard.fly.dev/

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
- Real-time countdown/count-up timers dengan WIB timezone
- Customer notes & session details
- **Pilih durasi**: 1-5 Jam, Custom (menit), atau Tanpa Batas

### Audio Alert System
- **4 Chill Jingles**: Meditation chimes, wind chimes, ocean waves, Tibetan bowl
- **30-Second Final Alert**: Jingle berbunyi hanya di 30 detik terakhir sebelum waktu habis
- **Mute Button**: Tombol "MATIKAN ALARM" muncul saat jingle berbunyi
- Auto-stop setelah 30 detik atau bisa di-mute manual
- Pattern cycle untuk unlimited units (Unit 5+ pakai jingle 1, 2, dst.)

### Import Safety
- Konfirmasi "SAYA SETUJU" sebelum import data
- Mencegah overwrite data yang tidak disengaja
- JSON validation sebelum import

### Reports
- Filter by date period
- Income/expense/profit tracking
- Export CSV for accounting
- Transaction history

### Settings
- Configure rental rates
- Add/remove/rename units
- Import/export data dengan safety check
- Manage business settings
- **Warning threshold**: Setting peringatan visual (menit)

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
| GET | `/api/transactions` | List transactions |
| GET | `/api/expenses` | List expenses |
| POST | `/api/expenses` | Add expense |
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
- `units` - Rental units (TVs/PS3s) dengan active status
- `transactions` - Rental history dengan WIB date
- `expenses` - Business expenses
- `sessions` - Active login tokens

### Features
- WAL mode for concurrent access
- Automatic schema migrations
- Single-file database (easy backup)
- Volume persistence di Fly.io (`ps3_data` → `/app/data`)

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
// Test jingle di browser console
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
Edit `JINGLE_PATTERNS` array di `public/index.html`:
```javascript
const JINGLE_PATTERNS = [
  [432, 0, 528, 0, 639],  // Unit 1
  [600, 550, 500, 450],   // Unit 2
  // ... custom frequencies (Hz)
];
```

### Change Final Alert Duration
```javascript
const FINAL_ALERT_SECONDS = 30; // Ubah ke 60 untuk 1 menit
```

### Default Units
Starts with 1 unit (PS 1). Add more units via Settings → "Manajemen Unit" → "Tambah Unit"

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Can't login | Check `ADMIN_PASSWORD` env var |
| Database locked | Restart app (WAL auto-recover) |
| Sync not working | Check browser console for errors |
| Audio tidak bunyi | Pastikan browser tidak mute tab (autoplay policy) |
| Alarm tidak berhenti | Klik tombol "MATIKAN ALARM" atau tunggu 30 detik |
| Import gagal | Pastikan JSON valid dan klik "SAYA SETUJU" |

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
- Audio jingles menggunakan Web Audio API

---

Made with ❤️ for PS3 rental businesses worldwide.
