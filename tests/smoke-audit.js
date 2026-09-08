/**
 * Production Audit Smoke Test Suite
 * Executes TESTS A through G as specified in the Final Production Audit
 */

process.env.NODE_ENV = 'test';
const http = require('http');
const crypto = require('crypto');
const app = require('../server');
const db = require('../db');
const { resetOrders } = require('../db/reset-orders');

let server;
let baseUrl;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let postData = null;

    if (body) {
      postData = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runSmokeAudit() {
  console.log('🚀 Running Final Production Smoke Tests (Tests A - G)...\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  await resetOrders();

  let adminToken = null;
  // Get admin token
  const adminLogin = await request('POST', '/api/admin/login', {
    email: 'owner@ochrecoffee.com',
    password: process.env.ADMIN_PASSWORD || 'OchreCoffee#2026Secure'
  });
  if (adminLogin.status !== 200) throw new Error('Admin login failed: ' + JSON.stringify(adminLogin.body));
  adminToken = adminLogin.body.data.token;

  // TEST A — COUNTER (1 item -> cart -> takeaway -> counter -> place order -> db order exists -> admin sees it -> payment pending -> admin mark paid -> payment paid, order confirmed)
  console.log('--- TEST A: COUNTER FLOW ---');
  const orderA = await request('POST', '/api/orders', {
    customerName: 'Aarav Sharma',
    customerPhone: '9876543210',
    orderType: 'TAKEAWAY',
    paymentMethod: 'COUNTER',
    items: [{ productId: 'prod_caramel_latte', quantity: 1 }],
    idempotencyKey: 'smoke_test_a_' + Date.now()
  });
  if (orderA.status !== 201) throw new Error(`TEST A: Expected 201, got ${orderA.status}`);
  const ordAData = orderA.body.data;
  console.log(`  ✓ Order created: ${ordAData.orderNumber} (Takeaway, ₹${ordAData.total}, Status: ${ordAData.status}, Payment: ${ordAData.paymentStatus})`);

  // Verify in admin queue
  const adminQueue = await request('GET', '/api/admin/orders', null, { 'Authorization': `Bearer ${adminToken}` });
  const foundA = adminQueue.body.data.find(o => o.order_number === ordAData.orderNumber);
  if (!foundA) throw new Error('TEST A: Order not visible in admin queue');
  if (foundA.payment_status !== 'PAYMENT_PENDING') throw new Error('TEST A: Expected payment_status PAYMENT_PENDING');
  console.log('  ✓ Visible in Admin Queue with PAYMENT_PENDING');

  // Admin marks paid
  const markPaidA = await request('POST', `/api/admin/orders/${foundA.id}/mark-paid`, null, { 'Authorization': `Bearer ${adminToken}` });
  if (markPaidA.status !== 200) throw new Error('TEST A: Mark paid failed');
  const updatedA = await db.get('SELECT status, payment_status FROM orders WHERE id = ?', [foundA.id]);
  if (updatedA.payment_status !== 'PAID') throw new Error('TEST A: Payment not marked PAID');
  if (updatedA.status !== 'CONFIRMED') throw new Error('TEST A: Order not CONFIRMED');
  console.log(`  ✓ Admin marked PAID -> Payment: ${updatedA.payment_status}, Status: ${updatedA.status}`);
  console.log('  👉 TEST A: PASS\n');

  // TEST B — UPI (1 item -> cart -> dine-in -> table 1 -> UPI -> server-calculated amount -> UPI URI & QR contain 9182916879@ybl and amount -> submit UTR -> payment remains pending -> admin verifies -> payment becomes PAID)
  console.log('--- TEST B: UPI & MANUAL UTR VERIFICATION ---');
  const orderB = await request('POST', '/api/orders', {
    customerName: 'Priya Patel',
    customerPhone: '9876543211',
    orderType: 'DINE_IN',
    tableNumber: 1,
    paymentMethod: 'UPI',
    items: [{ productId: 'prod_spanish_cold_brew', quantity: 2 }],
    idempotencyKey: 'smoke_test_b_' + Date.now()
  });
  if (orderB.status !== 201) throw new Error(`TEST B: Expected 201, got ${orderB.status}`);
  const ordBData = orderB.body.data;
  const paymentB = ordBData.payment;
  if (ordBData.total !== 398) throw new Error(`TEST B: Server total incorrect: ${ordBData.total}`);
  const decodedUri = decodeURIComponent(paymentB.upiUri);
  if (!decodedUri.includes('9182916879@ybl')) throw new Error('TEST B: UPI URI missing VPA 9182916879@ybl');
  if (!decodedUri.includes('am=398.00') && !decodedUri.includes('am=398')) throw new Error('TEST B: UPI URI missing correct amount');
  if (!paymentB.qrDataUrl.startsWith('data:image/')) throw new Error('TEST B: QR data URL missing');
  console.log(`  ✓ Order ${ordBData.orderNumber} created with server total ₹${ordBData.total}`);
  console.log(`  ✓ UPI URI validated: ${paymentB.upiUri}`);
  console.log('  ✓ SVG QR code generated');

  // Submit UTR
  const utrRes = await request('POST', '/api/payments/submit-utr', {
    orderNumber: ordBData.orderNumber,
    utr: '987654123456',
    orderToken: ordBData.orderToken
  });
  if (utrRes.status !== 200) throw new Error('TEST B: Submit UTR failed: ' + JSON.stringify(utrRes.body));
  const checkB = await db.get('SELECT payment_status, customer_utr FROM orders WHERE order_number = ?', [ordBData.orderNumber]);
  if (checkB.payment_status !== 'PAYMENT_PENDING') throw new Error('TEST B: Payment status must remain PAYMENT_PENDING');
  if (checkB.customer_utr !== '987654123456') throw new Error('TEST B: Customer UTR not recorded');
  console.log('  ✓ Customer submitted UTR: 987654123456. Status HONESTLY remains PAYMENT_PENDING');

  // Admin verifies and marks paid
  const markPaidB = await request('POST', `/api/admin/orders/${ordBData.orderId}/mark-paid`, null, { 'Authorization': `Bearer ${adminToken}` });
  if (markPaidB.status !== 200) throw new Error('TEST B: Admin mark paid failed');
  const finalB = await db.get('SELECT status, payment_status FROM orders WHERE id = ?', [ordBData.orderId]);
  if (finalB.payment_status !== 'PAID') throw new Error('TEST B: Payment not PAID');
  if (finalB.status !== 'CONFIRMED') throw new Error('TEST B: Status not CONFIRMED');
  console.log(`  ✓ Cashier verified payment -> Payment: ${finalB.payment_status}, Status: ${finalB.status}`);
  console.log('  👉 TEST B: PASS\n');

  // TEST C — AVAILABILITY (Admin disables product -> customer attempts checkout -> blocked)
  console.log('--- TEST C: PRODUCT AVAILABILITY ENFORCEMENT ---');
  // Disable Caramel Latte
  const toggleRes = await request('PATCH', '/api/admin/products/prod_caramel_latte/availability', null, { 'Authorization': `Bearer ${adminToken}` });
  if (toggleRes.status !== 200) throw new Error('TEST C: Failed to toggle product');
  console.log('  ✓ Admin toggled Caramel Latte to UNAVAILABLE');

  // Customer tries to order it
  const orderC = await request('POST', '/api/orders', {
    customerName: 'Test Customer',
    customerPhone: '9876543210',
    orderType: 'TAKEAWAY',
    paymentMethod: 'COUNTER',
    items: [{ productId: 'prod_caramel_latte', quantity: 1 }]
  });
  if (orderC.status !== 400) throw new Error(`TEST C: Expected 400 blocked, got ${orderC.status}`);
  if (orderC.body.error.code !== 'PRODUCT_UNAVAILABLE') throw new Error('TEST C: Expected PRODUCT_UNAVAILABLE code');
  console.log(`  ✓ Checkout blocked by server with 400: ${orderC.body.error.message}`);

  // Re-enable for subsequent tests
  await request('PATCH', '/api/admin/products/prod_caramel_latte/availability', null, { 'Authorization': `Bearer ${adminToken}` });
  console.log('  ✓ Admin restored Caramel Latte to AVAILABLE');
  console.log('  👉 TEST C: PASS\n');

  // TEST D — PRICE TAMPERING (Modify frontend request to Caramel Latte = ₹1, total = ₹1 -> server calculates ₹189)
  console.log('--- TEST D: SERVER-SIDE PRICE AUTHORITY (PRICE TAMPERING ATTEMPT) ---');
  const orderD = await request('POST', '/api/orders', {
    customerName: 'Tamper Tester',
    customerPhone: '9876543210',
    orderType: 'TAKEAWAY',
    paymentMethod: 'COUNTER',
    items: [{ productId: 'prod_caramel_latte', quantity: 1, price: 1, unitPrice: 1 }],
    total: 1,
    subtotal: 1
  });
  if (orderD.status !== 201) throw new Error('TEST D: Failed to create order');
  if (orderD.body.data.total !== 189) throw new Error(`TEST D: Tampered total accepted! Expected 189, got ${orderD.body.data.total}`);
  const dbOrdD = await db.get('SELECT total FROM orders WHERE id = ?', [orderD.body.data.orderId]);
  if (dbOrdD.total !== 189) throw new Error(`TEST D: Tampered total in DB: ${dbOrdD.total}`);
  console.log(`  ✓ Frontend sent ₹1; Server ignored tampering and strictly billed ₹${dbOrdD.total} from database`);
  console.log('  👉 TEST D: PASS\n');

  // TEST E — DUPLICATE ORDER (Submit identical checkout request with same idempotencyKey twice -> one order)
  console.log('--- TEST E: IDEMPOTENT ORDER CREATION (DOUBLE-CLICK / RETRY) ---');
  const idemKey = 'idempotency_smoke_key_' + crypto.randomUUID();
  const reqE1 = await request('POST', '/api/orders', {
    customerName: 'Rohan Verma',
    customerPhone: '9876543212',
    orderType: 'TAKEAWAY',
    paymentMethod: 'COUNTER',
    items: [{ productId: 'prod_hazelnut_mocha', quantity: 1 }],
    idempotencyKey: idemKey
  });
  const reqE2 = await request('POST', '/api/orders', {
    customerName: 'Rohan Verma',
    customerPhone: '9876543212',
    orderType: 'TAKEAWAY',
    paymentMethod: 'COUNTER',
    items: [{ productId: 'prod_hazelnut_mocha', quantity: 1 }],
    idempotencyKey: idemKey
  });

  if (reqE1.status !== 201) throw new Error('TEST E: First order creation failed');
  if (reqE2.status !== 200) throw new Error(`TEST E: Expected 200 idempotent replay, got ${reqE2.status}`);
  if (reqE1.body.data.orderNumber !== reqE2.body.data.orderNumber) throw new Error('TEST E: Different order numbers created');
  if (!reqE2.body.data.isIdempotentReplay) throw new Error('TEST E: isIdempotentReplay flag missing');
  console.log(`  ✓ Request 1 created: ${reqE1.body.data.orderNumber}`);
  console.log(`  ✓ Request 2 replayed existing: ${reqE2.body.data.orderNumber} (zero duplicates created)`);
  console.log('  👉 TEST E: PASS\n');

  // TEST F — ADMIN SECURITY (Call admin APIs without auth -> 401/403)
  console.log('--- TEST F: ADMIN SECURITY & UNAUTHORIZED ACCESS ---');
  const endpoints = [
    { method: 'GET', path: '/api/admin/orders' },
    { method: 'PATCH', path: '/api/admin/orders/any/status' },
    { method: 'POST', path: '/api/admin/orders/any/mark-paid' },
    { method: 'GET', path: '/api/admin/products' },
    { method: 'PATCH', path: '/api/admin/products/prod_caramel_latte/availability' },
    { method: 'GET', path: '/api/admin/tables' },
    { method: 'GET', path: '/api/admin/stats' }
  ];

  for (const ep of endpoints) {
    const res = await request(ep.method, ep.path);
    if (res.status !== 401 && res.status !== 403) {
      throw new Error(`TEST F: Endpoint ${ep.method} ${ep.path} allowed unauthenticated access (got ${res.status})`);
    }
    console.log(`  ✓ ${ep.method} ${ep.path} rejected with HTTP ${res.status} UNAUTHORIZED`);
  }
  console.log('  👉 TEST F: PASS\n');

  // TEST G — CUSTOMER DATA SECURITY (Attempt to access sensitive info of another customer's order)
  console.log('--- TEST G: CUSTOMER DATA SECURITY & PRIVACY ---');
  // Order placed by Priya Patel (orderB)
  // Request without token:
  const anonView = await request('GET', `/api/orders/${ordBData.orderNumber}`);
  if (anonView.status !== 200) throw new Error('TEST G: Order not found');
  if (anonView.body.data.customerName !== 'P*** P***') {
    throw new Error(`TEST G: Customer name not masked for unauthenticated viewer: ${anonView.body.data.customerName}`);
  }
  if (anonView.body.data.customerPhone) {
    throw new Error('TEST G: Customer phone leaked to public tracking endpoint!');
  }
  console.log(`  ✓ Unauthenticated viewer sees masked identity: "${anonView.body.data.customerName}" (phone/email never exposed)`);

  // Request with authorized token:
  const ownerView = await request('GET', `/api/orders/${ordBData.orderNumber}`, null, {
    'x-order-token': ordBData.orderToken
  });
  if (ownerView.body.data.customerName !== 'Priya Patel') {
    throw new Error('TEST G: Authorized owner did not receive their name');
  }
  console.log(`  ✓ Authorized owner with orderToken receives verified identity: "${ownerView.body.data.customerName}"`);

  // Attempt to submit UTR with forged token:
  const forgedUtr = await request('POST', '/api/payments/submit-utr', {
    orderNumber: ordBData.orderNumber,
    utr: '999999999999',
    orderToken: 'forged_fake_token_1234'
  });
  if (forgedUtr.status !== 403) throw new Error(`TEST G: Forged token was not rejected with 403 (got ${forgedUtr.status})`);
  console.log(`  ✓ Forged orderToken rejected with HTTP 403 FORBIDDEN on UTR submission`);
  console.log('  👉 TEST G: PASS\n');

  // Final Purge back to 0 orders
  await resetOrders();
  const finalCount = (await db.get('SELECT COUNT(*) as c FROM orders')).c;
  if (finalCount !== 0) throw new Error('Final order count not 0');
  console.log(`🎉 ALL 7 AUDIT SMOKE TESTS PASSED! Database confirmed at ${finalCount} orders.`);

  server.close();
}

runSmokeAudit().catch((err) => {
  console.error('\n❌ Smoke Audit Failed:', err);
  if (server) server.close();
  process.exit(1);
});
