/**
 * Automated Verification: Multi-Table Capacity & Real-Time Occupancy Flow
 */

require('dotenv').config();
const http = require('http');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Multi-Table Capacity & Occupancy Verification...\n');

  // 1. Check Tables endpoint
  console.log('1️⃣ Fetching /api/tables...');
  const tablesRes = await request({
    hostname: 'localhost',
    port: 8000,
    path: '/api/tables',
    method: 'GET'
  });

  if (tablesRes.status !== 200 || !tablesRes.data.success) {
    throw new Error(`Failed to fetch /api/tables: ${JSON.stringify(tablesRes.data)}`);
  }

  const tables = tablesRes.data.data;
  console.log(`✅ Fetched ${tables.length} tables successfully.`);
  const sample = tables[0];
  console.log(`   Sample table #${sample.tableNumber}: capacity=${sample.capacity}, status=${sample.occupancyStatus}, open=${sample.availableSeats}`);

  if (!sample.occupancyStatus) {
    throw new Error('Table is missing occupancyStatus property!');
  }

  // Pick 2 vacant tables: e.g. 5 and 6
  const vacantTables = tables.filter(t => t.occupancyStatus === 'FULLY_VACANT');
  if (vacantTables.length < 2) {
    console.log('⚠️ Need at least 2 vacant tables for multi-table test. Found:', vacantTables.length);
  }
  const t1 = vacantTables[0].tableNumber;
  const t2 = vacantTables[1].tableNumber;
  console.log(`   Selected test tables: #${t1} and #${t2}`);

  // Fetch menu to get valid product
  const menuRes = await request({
    hostname: 'localhost',
    port: 8000,
    path: '/api/menu',
    method: 'GET'
  });
  const firstProd = menuRes.data.data.products[0];
  console.log(`   Using valid menu item: "${firstProd.name}" (${firstProd.id})`);

  // 2. Create multi-table order (6 guests across 2 tables)
  console.log(`\n2️⃣ Creating multi-table order for party of 6 across tables #${t1} and #${t2}...`);
  const orderRes = await request({
    hostname: 'localhost',
    port: 8000,
    path: '/api/orders',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    customerName: 'Aarav Sharma & Party',
    customerPhone: '9876543210',
    orderType: 'DINE_IN',
    tableNumbers: [t1, t2],
    guestCount: 6,
    paymentMethod: 'COUNTER',
    items: [
      { productId: firstProd.id, quantity: 2 }
    ]
  });

  if (orderRes.status !== 201 || !orderRes.data.success) {
    throw new Error(`Order placement failed: ${JSON.stringify(orderRes.data)}`);
  }

  const ord = orderRes.data.data;
  console.log(`✅ Order placed: ${ord.orderNumber}`);
  console.log(`   Table label: "${ord.tableLabel}"`);
  console.log(`   Table numbers: [${ord.tableNumbers.join(', ')}]`);
  console.log(`   Guest count: ${ord.guestCount}`);

  if (!ord.tableLabel || !ord.tableLabel.includes('&')) {
    throw new Error(`Expected multi-table label with '&', got: ${ord.tableLabel}`);
  }

  // 3. Verify /api/tables reflects occupancy
  console.log('\n3️⃣ Checking /api/tables occupancy after placement...');
  const afterOrderTables = await request({
    hostname: 'localhost',
    port: 8000,
    path: '/api/tables',
    method: 'GET'
  });
  const t1Data = afterOrderTables.data.data.find(t => t.tableNumber === t1);
  const t2Data = afterOrderTables.data.data.find(t => t.tableNumber === t2);
  console.log(`   Table #${t1}: status=${t1Data.occupancyStatus}, occupiedSeats=${t1Data.occupiedSeats}`);
  console.log(`   Table #${t2}: status=${t2Data.occupancyStatus}, occupiedSeats=${t2Data.occupiedSeats}`);

  if (t1Data.occupancyStatus === 'FULLY_VACANT' || t2Data.occupancyStatus === 'FULLY_VACANT') {
    throw new Error('Tables should not be FULLY_VACANT after booking!');
  }

  // 4. Verify conflict prevention: attempting to rebook table 1
  console.log(`\n4️⃣ Verifying booking collision prevention on Table #${t1}...`);
  const conflictRes = await request({
    hostname: 'localhost',
    port: 8000,
    path: '/api/orders',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    customerName: 'Conflict Tester',
    customerPhone: '9123456780',
    orderType: 'DINE_IN',
    tableNumbers: [t1],
    guestCount: 2,
    paymentMethod: 'COUNTER',
    items: [{ productId: firstProd.id, quantity: 1 }]
  });

  if (conflictRes.status === 400 && conflictRes.data.error?.code === 'TABLE_OCCUPIED') {
    console.log(`✅ Conflict correctly rejected with 400 TABLE_OCCUPIED: "${conflictRes.data.error.message}"`);
  } else {
    throw new Error(`Expected 400 TABLE_OCCUPIED, got: ${conflictRes.status} ${JSON.stringify(conflictRes.data)}`);
  }

  // 5. Test Customer Order Status endpoint
  console.log(`\n5️⃣ Fetching /api/orders/${ord.orderNumber} with token...`);
  const trackingRes = await request({
    hostname: 'localhost',
    port: 8000,
    path: `/api/orders/${ord.orderNumber}?token=${ord.orderToken}`,
    method: 'GET'
  });
  if (trackingRes.status !== 200 || !trackingRes.data.success) {
    throw new Error(`Failed to fetch order: ${JSON.stringify(trackingRes.data)}`);
  }
  const tracked = trackingRes.data.data;
  console.log(`✅ Order tracking data verified: label="${tracked.tableLabel}", guests=${tracked.guestCount}`);

  // 6. Admin Login & Table Vacate
  console.log('\n6️⃣ Logging in as Admin to test Vacate Table...');
  const loginRes = await request({
    hostname: 'localhost',
    port: 8000,
    path: '/api/admin/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: process.env.ADMIN_EMAIL || 'owner@ochrecoffee.com',
    password: process.env.ADMIN_PASSWORD || 'OchreCoffee#2026Secure'
  });

  if (loginRes.status !== 200 || !loginRes.data.success) {
    throw new Error(`Admin login failed: ${JSON.stringify(loginRes.data)}`);
  }
  const token = loginRes.data.data.token;
  console.log('✅ Admin login successful, JWT received.');

  // Vacate Table t1 — should automatically complete order and free both t1 AND t2!
  console.log(`   Vacating Table #${t1} via POST /api/admin/tables/${t1}/vacate...`);
  const vacateRes = await request({
    hostname: 'localhost',
    port: 8000,
    path: `/api/admin/tables/${t1}/vacate`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (vacateRes.status !== 200 || !vacateRes.data.success) {
    throw new Error(`Vacate failed: ${JSON.stringify(vacateRes.data)}`);
  }
  console.log(`✅ Vacate response: "${vacateRes.data.message}"`);

  // Verify both tables are now FULLY_VACANT
  const postVacateTables = await request({
    hostname: 'localhost',
    port: 8000,
    path: '/api/tables',
    method: 'GET'
  });
  const postT1 = postVacateTables.data.data.find(t => t.tableNumber === t1);
  const postT2 = postVacateTables.data.data.find(t => t.tableNumber === t2);

  console.log(`   Table #${t1} post-vacate status: ${postT1.occupancyStatus} (${postT1.availableSeats}/${postT1.capacity} Open)`);
  console.log(`   Table #${t2} post-vacate status: ${postT2.occupancyStatus} (${postT2.availableSeats}/${postT2.capacity} Open)`);

  if (postT1.occupancyStatus !== 'FULLY_VACANT' || postT2.occupancyStatus !== 'FULLY_VACANT') {
    throw new Error(`Both tables should be FULLY_VACANT after vacating multi-table order!`);
  }

  console.log('\n🎉 ALL MULTI-TABLE CAPACITY & OCCUPANCY TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
