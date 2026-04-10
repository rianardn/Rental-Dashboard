# 🎮 PS3 Rental Manager — Setup Guide

## Struktur Folder

```
ps3-rental/
├── server.js          ← Backend server (Node.js)
├── package.json
├── public/
│   └── index.html     ← Frontend app (buka di browser)
└── data/
    └── db.json        ← Database otomatis dibuat sini
```

---

## 1. Install Node.js

Download dari: https://nodejs.org (pilih versi LTS)

Cek berhasil:
```
node --version
npm --version
```

---

## 2. Install Dependencies

Buka Command Prompt / Terminal di folder `ps3-rental/`:
```
npm install
```

---

## 3. Jalankan Server

```
npm start
```

Output yang muncul:
```
╔══════════════════════════════════════════╗
║     🎮  PS3 Rental Backend Server       ║
╠══════════════════════════════════════════╣
║  Port    : 3000                          ║
║  HP/PC   : http://192.168.1.5:3000       ║
║  Local   : http://localhost:3000         ║
╚══════════════════════════════════════════╝
```

---

## 4. Akses dari Perangkat

| Perangkat | Cara Akses |
|-----------|-----------|
| **PC Windows** | Buka browser → `http://localhost:3000` |
| **HP Android** | Buka browser → `http://192.168.1.5:3000` (gunakan IP yang muncul di terminal) |
| **HP lain** | Sama seperti Android, pastikan dalam WiFi yang sama |

> ⚠️ HP dan PC harus terhubung ke **WiFi yang sama**

---

## 5. Koneksi dari HP (pengaturan pertama kali)

1. Buka aplikasi di HP → tab **Setelan**
2. Masukkan IP PC kamu (contoh: `192.168.1.5`) dan Port `3000`
3. Tekan **Test Koneksi**
4. Kalau berhasil, badge **LAN** muncul di header
5. Data otomatis sync dari server

> Setelah pertama kali tersimpan, HP akan **auto-connect** setiap kali dibuka.

---

## 6. Jalankan Otomatis saat Windows Startup (opsional)

Buat file `start-server.bat`:
```bat
@echo off
cd /d "C:\path\ke\ps3-rental"
node server.js
pause
```

Lalu taruh shortcut file `.bat` ini di:
```
C:\Users\<nama_user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

---

## 7. Firewall Windows (jika HP tidak bisa konek)

1. Buka **Windows Defender Firewall**
2. Klik **Allow an app through firewall**
3. Klik **Allow another app** → browse ke `node.exe`
4. Centang keduanya (Private & Public)

Atau lewat PowerShell (run as Administrator):
```powershell
netsh advfirewall firewall add rule name="PS3 Rental Server" dir=in action=allow protocol=TCP localport=3000
```

---

## Cara Kerja Sync

```
PC Windows (server)          HP Android (client)
      │                              │
      │←─── WebSocket connect ───────│
      │──── kirim full DB ──────────→│
      │                              │
      │  [user mulai sesi di HP]     │
      │←─── POST /api/units/1/start ─│
      │──── broadcast ke semua ─────→│ (PC juga update real-time)
      │                              │
      │  [user stop sesi di PC]      │
      │←─── POST /api/units/1/stop ──│
      │──── broadcast ──────────────→│
```

Semua data disimpan di `data/db.json` di PC — aman walau server restart.

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| HP tidak bisa konek | Cek WiFi sama, cek firewall Windows |
| IP berubah tiap hari | Set IP statis di router (DHCP reservation) |
| Data hilang setelah restart | Tidak akan hilang — tersimpan di `db.json` |
| Port 3000 sudah dipakai | Ganti PORT di `server.js` baris pertama |
