#!/usr/bin/env node
/**
 * Seed Production Database via API
 * Adds sample inventory items and station for testing
 */

const API_BASE = process.env.API_URL || 'https://rental-dashboard.fly.dev';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

let authToken = null;

const SAMPLE_ITEMS = [
  { id: 'PS3-01', name: 'Sony PS3 Fat 60GB', category: 'ps3', purchaseCost: 2500000, condition: 'baik', location: 'Ruang Depan' },
  { id: 'TV-01', name: 'Samsung 32" LED TV', category: 'tv', purchaseCost: 3200000, condition: 'baik', location: 'Ruang Depan' },
  { id: 'STK-01', name: 'Stik PS3 Original (Hitam)', category: 'stik', purchaseCost: 350000, condition: 'baik', location: 'Ruang Depan' },
  { id: 'STK-02', name: 'Stik PS3 Original (Merah)', category: 'stik', purchaseCost: 350000, condition: 'baik', location: 'Ruang Depan' },
  { id: 'USB-01', name: 'Kabel Charger Stik', category: 'charger', purchaseCost: 50000, condition: 'baik', location: 'Ruang Depan' },
  { id: 'USB-02', name: 'Kabel Charger Stik Cadangan', category: 'charger', purchaseCost: 50000, condition: 'baik', location: 'Ruang Depan' },
  { id: 'HDMI-01', name: 'Kabel HDMI 2m', category: 'hdmi', purchaseCost: 75000, condition: 'baik', location: 'Ruang Depan' },
  { id: 'PLUG-01', name: 'Kabel Power PSU', category: 'plug', purchaseCost: 45000, condition: 'baik', location: 'Ruang Depan' },
];

const STATION = {
  id: 'HOME-01',
  name: 'Setup Gaming A',
  description: 'Station utama di ruang depan',
  isActive: true,
  items: [
    { item_id: 'PS3-01', role: 'konsol' },
    { item_id: 'TV-01', role: 'tv' },
    { item_id: 'STK-01', role: 'stik_1' },
    { item_id: 'STK-02', role: 'stik_2' },
    { item_id: 'USB-01', role: 'charger_1' },
    { item_id: 'USB-02', role: 'charger_2' },
    { item_id: 'HDMI-01', role: 'hdmi' },
    { item_id: 'PLUG-01', role: 'plug' }
  ]
};

async function login() {
  console.log('\n🔐 Logging in...');
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD })
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`  ❌ Login failed: ${err}`);
      return false;
    }

    const data = await res.json();
    authToken = data.token;
    console.log('  ✅ Login successful');
    return true;
  } catch (e) {
    console.log(`  ❌ Login error: ${e.message}`);
    return false;
  }
}

async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(url, {
    ...options,
    headers
  });
  return res;
}

async function seedItems() {
  console.log('\n📦 Seeding inventory items...\n');
  for (const item of SAMPLE_ITEMS) {
    try {
      const res = await fetchAPI('/api/inventory', {
        method: 'POST',
        body: JSON.stringify(item)
      });
      if (res.ok) {
        console.log(`  ✅ ${item.id}: ${item.name}`);
      } else {
        const err = await res.text();
        console.log(`  ⚠️  ${item.id}: ${err.substring(0, 100)}`);
      }
    } catch (e) {
      console.log(`  ❌ ${item.id}: ${e.message}`);
    }
  }
}

async function seedStation() {
  console.log('\n🏢 Creating station HOME-01...\n');
  try {
    // Create station
    const res = await fetchAPI('/api/stations', {
      method: 'POST',
      body: JSON.stringify({
        id: STATION.id,
        name: STATION.name,
        description: STATION.description,
        isActive: STATION.isActive
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`  ❌ Failed to create station: ${err.substring(0, 200)}`);
      return;
    }
    console.log(`  ✅ Station ${STATION.id} created`);

    // Add items to station
    for (const item of STATION.items) {
      try {
        const res2 = await fetchAPI(`/api/stations/${STATION.id}/items`, {
          method: 'POST',
          body: JSON.stringify(item)
        });
        if (res2.ok) {
          console.log(`    ✅ ${item.role}: ${item.item_id}`);
        } else {
          const err = await res2.text();
          console.log(`    ⚠️  ${item.role}: ${err.substring(0, 100)}`);
        }
      } catch (e) {
        console.log(`    ❌ ${item.role}: ${e.message}`);
      }
    }

    console.log(`\n  🎉 Station ${STATION.id} fully configured!`);
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}`);
  }
}

async function verify() {
  console.log('\n\n🔍 Verifying data...\n');
  try {
    const itemsRes = await fetchAPI('/api/inventory');
    const stationsRes = await fetchAPI('/api/stations');

    const items = await itemsRes.json();
    const stations = await stationsRes.json();

    console.log(`  📦 Inventory items: ${items.length}`);
    console.log(`  🏢 Stations: ${stations.length}`);

    if (stations.length > 0) {
      const station = stations[0];
      const stationItemsRes = await fetchAPI(`/api/stations/${station.id}/items`);
      const stationItems = await stationItemsRes.json();
      console.log(`  🔧 Items in ${station.id}: ${stationItems.length}`);
    }
  } catch (e) {
    console.log(`  ⚠️  Verify error: ${e.message}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  SEED PRODUCTION DATABASE - Rental Dashboard');
  console.log('  API:', API_BASE);
  console.log('═══════════════════════════════════════════');

  // Login first
  const loggedIn = await login();
  if (!loggedIn) {
    console.log('\n  ❌ Cannot proceed without authentication');
    process.exit(1);
  }

  await seedItems();
  await seedStation();
  await verify();

  console.log('\n═══════════════════════════════════════════');
  console.log('  ✅ SEEDING COMPLETE');
  console.log('═══════════════════════════════════════════\n');
}

main().catch(console.error);
