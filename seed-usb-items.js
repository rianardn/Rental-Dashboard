#!/usr/bin/env node
/**
 * Seed USB/Charger items untuk wizard stasiun
 */

const API_URL = process.env.API_URL || 'https://rental-dashboard.fly.dev';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function login() {
  console.log('[Login] Authenticating...');
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD })
  });
  const data = await res.json();
  if (!data.token) throw new Error('Login failed: ' + JSON.stringify(data));
  console.log('[Login] Success');
  return data.token;
}

async function seedUSBItems(token) {
  const items = [
    { id: 'USB-01', name: 'Kabel Charger PS3 (USB-A)', category: 'kabel', subcategory: 'usb', purchaseDate: '2023-01-15', purchaseCost: 75000, condition: 'baik', location: 'Gudang' },
    { id: 'USB-02', name: 'Kabel Charger PS3 (USB-A)', category: 'kabel', subcategory: 'usb', purchaseDate: '2023-01-15', purchaseCost: 75000, condition: 'baik', location: 'Gudang' },
    { id: 'USB-03', name: 'Kabel Charger PS3 (USB-A)', category: 'kabel', subcategory: 'usb', purchaseDate: '2023-01-15', purchaseCost: 75000, condition: 'baik', location: 'Gudang' },
    { id: 'USB-04', name: 'Kabel Charger PS3 (USB-A)', category: 'kabel', subcategory: 'usb', purchaseDate: '2023-01-15', purchaseCost: 75000, condition: 'baik', location: 'Gudang' },
    { id: 'USB-05', name: 'Kabel Charger PS3 (USB-A)', category: 'kabel', subcategory: 'usb', purchaseDate: '2023-01-15', purchaseCost: 75000, condition: 'baik', location: 'Gudang' },
    { id: 'USB-06', name: 'Kabel Charger PS3 (USB-A)', category: 'kabel', subcategory: 'usb', purchaseDate: '2023-01-15', purchaseCost: 75000, condition: 'baik', location: 'Gudang' }
  ];

  console.log('[Seed] Adding USB/Charger items...');

  for (const item of items) {
    try {
      const res = await fetch(`${API_URL}/api/inventory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(item)
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`  ✓ Added ${item.id} - ${item.name}`);
      } else if (data.error && data.error.includes('already exists')) {
        console.log(`  ⚠ ${item.id} already exists`);
      } else {
        console.log(`  ✗ Failed ${item.id}:`, data.error);
      }
    } catch (err) {
      console.log(`  ✗ Error ${item.id}:`, err.message);
    }
  }
  console.log('[Seed] Done');
}

async function main() {
  try {
    const token = await login();
    await seedUSBItems(token);
  } catch (err) {
    console.error('[Error]', err.message);
    process.exit(1);
  }
}

main();
