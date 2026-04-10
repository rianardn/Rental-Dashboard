# 🎮 PS3 Rental Manager - Full Stack

A complete rental management solution for PlayStation 3 rental businesses.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

- 📱 **Responsive Mobile UI**: Works on phone, tablet, laptop
- 🔐 **Secure Authentication**: Password-protected with JWT
- 💾 **Persistent Storage**: SQLite database (auto-migrated)
- 📊 **Real-time Dashboard**: Auto-refreshing timers & stats
- 📈 **Reports & Analytics**: Daily, weekly, monthly, yearly views
- 💾 **Import/Export**: JSON backup & CSV export
- 💸 **Expense Tracking**: Track business expenses
- 🔔 **Session Warnings**: Visual alerts before time expires

## 🎨 PS3 2006-2007 Design

Authentic PlayStation 3 aesthetic with:
- Black background (#000000)
- Chrome silver accents (linear-gradient)
- PlayStation red highlights (#e60012)
- Orbitron & Rajdhani display fonts
- Glowing red effects on active sessions

## 🚀 Quick Start

### Local Development

```bash
# Clone
git clone https://github.com/yourusername/ps3-rental-manager.git
cd ps3-rental-manager

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
- Real-time countdown/count-up timers
- Customer notes & session details

### Reports
- Filter by date period
- Income/expense/profit tracking
- Export CSV for accounting
- Transaction history

### Settings
- Configure rental rates
- Add/remove units
- Import/export data
- Manage business settings

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         Node.js + Express Server        │
│  ┌─────────────────────────────────┐   │
│  │   Static Files (UI)           │   │
│  ├─────────────────────────────────┤   │
│  │   REST API Routes             │   │
│  ├─────────────────────────────────┤   │
│  │   JWT Auth Middleware         │   │
│  ├─────────────────────────────────┤   │
│  │   SQLite Database             │   │
│  └─────────────────────────────────┘   │
│           ↓ 3s polling                 │
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
- No sensitive data in logs

## 💾 Database Schema

### Tables
- `settings` - Business configuration
- `units` - Rental units (TVs/PS3s)
- `transactions` - Rental history
- `expenses` - Business expenses
- `sessions` - Active login tokens

### Features
- WAL mode for concurrent access
- Automatic schema migrations
- Single-file database (easy backup)

## 📦 Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Auth | JWT + crypto |
| Frontend | Vanilla JS + CSS Grid |
| Fonts | Orbitron, Rajdhani |
| Icons | Emoji (system-native) |

## 🧪 Testing

```bash
# Health check
curl http://localhost:3000/ping

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "***"}'
```

## 📈 Performance

- **Memory**: ~80MB
- **Startup**: < 2 seconds
- **API response**: < 50ms average
- **Database**: Handles 10K+ transactions
- **Polling**: 3s interval (configurable)

## 🛠️ Customization

### Change Theme Colors
Edit CSS variables in `public/index.html`:
```css
:root {
  --ps3-red: #e60012;     /* Change to your brand */
  --ps3-silver: #c0c0c0;  /* Chrome accents */
}
```

### Change Poll Interval
```javascript
const POLL_INTERVAL = 5000; // 5 seconds instead of 3
```

### Default Units
Starts with 1 unit (PS 1). Add more units via Settings → "Manajemen Unit" → "Tambah Unit"

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Can't login | Check `ADMIN_PASSWORD` env var |
| Database locked | Restart app (WAL auto-recover) |
| Sync not working | Check browser console for errors |

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

---

Made with ❤️ for PS3 rental businesses worldwide.
