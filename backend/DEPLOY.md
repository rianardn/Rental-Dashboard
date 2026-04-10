# PS3 Rental Manager - Railway Deployment Guide

Complete full-stack deployment guide for PS3 Rental Manager on Railway's free tier.

## Architecture Changes for Railway

### What Changed from LAN Mode

| Feature | LAN Mode | Railway Mode |
|---------|----------|--------------|
| **Database** | JSON file | SQLite (better-sqlite3) |
| **Auth** | None | JWT-based password protection |
| **Real-time** | WebSocket | HTTP polling (3s interval) |
| **Storage** | Local filesystem | Railway Volume (persistent) |
| **Frontend** | localStorage | API-only (stateless) |

### Why These Changes?

1. **SQLite instead of JSON**: 
   - ACID transactions (no corruption)
   - Better concurrent access
   - Automatic schema migrations
   - Single file, no external DB cost

2. **HTTP polling instead of WebSocket**:
   - Works reliably on free tier
   - No persistent connection issues
   - Simpler architecture
   - Auto-reconnect on failures

3. **JWT authentication**:
   - Protects your data on public internet
   - Simple password-based login
   - Token stored in localStorage

## Railway Deployment Steps

### 1. Prepare Your Code

```bash
cd ~/ps3-rental-backend/backend

# Install dependencies
npm install

# Verify everything works locally
npm start
```

### 2. Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repo or upload files

### 3. Configure Environment Variables

In Railway Dashboard → Variables, add:

```
ADMIN_PASSWORD=your-secure-password-here
JWT_SECRET=your-random-secret-key-here
NODE_ENV=production
DATA_DIR=/app/data
```

**Generate secure secrets:**
```bash
# JWT_SECRET (run in terminal)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ADMIN_PASSWORD: Choose a strong password (min 8 chars)
```

### 4. Add Persistent Volume

1. In Railway Dashboard, click "New" → "Volume"
2. Name: `ps3-data`
3. Mount Path: `/app/data`
4. Size: 1GB (free tier limit)

This ensures your database persists across deployments.

### 5. Deploy

Railway will automatically deploy when you push to GitHub.

Or deploy via CLI:
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link project
railway link

# Deploy
railway up
```

### 6. Domain Setup

1. In Railway Dashboard → Settings → Domains
2. Click "Generate Domain" for a free `railway.app` domain
3. Or add custom domain (requires CNAME to Railway)

## Free Tier Optimization Tips

### Memory Optimization

Railway free tier = 512MB RAM. The app is optimized to use < 100MB:

- SQLite with WAL mode (efficient writes)
- No WebSocket connections (saves memory)
- Minimal dependencies (no heavy frameworks)
- Gzip compression built-in

### Disk Usage

- SQLite database: ~1MB per 1000 transactions
- 1GB volume = capacity for 1M+ transactions
- Auto-cleanup not needed (archives don't grow fast)

### Sleep Prevention (Optional)

Railway free tier sleeps after inactivity. To keep alive:

```bash
# Add to crontab or external ping service
curl -s https://your-app.railway.app/ping > /dev/null
```

Or use a free uptime monitor like UptimeRobot (pings every 5 minutes).

## Post-Deployment

### First Login

1. Open your Railway URL
2. Login with password from `ADMIN_PASSWORD`
3. You'll see empty dashboard (default units created)

### Adding Units

1. Go to "Pengaturan" tab
2. Add units (TV 1, TV 2, etc.)

### Importing Existing Data

If you have data from localStorage:

1. Go to old app → Export Backup (JSON)
2. Open new Railway app
3. Settings → Import Data
4. Select your backup file

## Monitoring

### Health Check

Railway uses `/ping` endpoint automatically:
```json
{
  "ok": true,
  "time": 1234567890,
  "server": "ps3-rental-backend",
  "db": "sqlite",
  "version": "2.0.0"
}
```

### Logs

```bash
# Railway CLI
railway logs

# Or view in Railway Dashboard → Deployments → Logs
```

### Database Inspection

```bash
# SSH into Railway instance (if needed)
railway connect

# SQLite CLI
sqlite3 /app/data/ps3rental.db

# Check tables
.tables
SELECT COUNT(*) FROM transactions;
```

## Backup & Recovery

### Automatic Backups

Railway volumes are backed up, but best practice:

1. Weekly: Export JSON backup from Settings
2. Download to local machine
3. Store in cloud (Google Drive, etc.)

### Restore from Backup

1. Go to Settings → Import Data
2. Select backup JSON file
3. Confirm overwrite

## Troubleshooting

### App Won't Start

Check logs for:
- SQLite permission errors → Volume not mounted
- Port binding → Must use `process.env.PORT`
- Memory exceeded → Check dependency size

### Database Locked

```bash
# SSH into instance
railway connect

# Fix SQLite WAL files
cd /app/data
rm -f ps3rental.db-shm ps3rental.db-wal
# Restart app
```

### Login Not Working

1. Check `ADMIN_PASSWORD` env var is set
2. Clear browser localStorage (token might be old)
3. Refresh page

## Upgrading from LAN Mode

### Migration Checklist

- [ ] Export JSON backup from old LAN mode
- [ ] Deploy to Railway
- [ ] Import data to Railway
- [ ] Update all devices to use Railway URL
- [ ] Test on mobile/tablet
- [ ] Set up ping service to prevent sleep (optional)

### Mobile Access

1. Open Railway URL on phone
2. Login
3. Add to Home Screen (PWA-like experience)
4. Works on any device with internet

## Security Considerations

1. **Change default password** immediately
2. **Use strong JWT_SECRET** (32+ random chars)
3. **HTTPS enforced** by Railway automatically
4. **No sensitive data in logs**
5. **Token expires** when you logout

## Cost Estimation (Free Tier)

| Resource | Free Tier | This App |
|----------|-----------|----------|
| RAM | 512MB | ~80MB |
| Disk | 1GB Volume | ~5-50MB |
| Bandwidth | 100GB/mo | ~1-5GB/mo |
| Compute | $5/mo credit | ~$3-4/mo |

**Result**: Should fit comfortably within free tier limits.

## Support

Issues? Check:
1. Railway status: [status.railway.app](https://status.railway.app)
2. App logs in Railway dashboard
3. Health check: `/ping` endpoint

---

**Version**: 2.0.0 (Railway Production)
**Database**: SQLite (better-sqlite3)
**Auth**: JWT + Password
**Last Updated**: 2025
