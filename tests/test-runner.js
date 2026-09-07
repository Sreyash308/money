/**
 * Comprehensive Verification Suite for Ochre Coffee Roasters
 * Validates fresh start, zero fake payments, real UPI protocol (9182916879@ybl),
 * idempotency, UTR submission, honest verification, and admin controls.
 */

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

    let payload = null;
    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
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
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Ochre Verification Suite (Fresh Start & Real UPI)...\n');

  // Start test server on random high port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`📡 Test server running at ${baseUrl}\n`);
      resolve();
    });
  });

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // TEST 1: Fresh Start Purge Verification
  await test('Fresh Start: Database order history starts completely empty (0 orders)', async () => {
    await resetOrders();
    const count = await db.get('SELECT COUNT(*) as count FROM orders');
    if (count.count !== 0) throw new Error(`Expected 0 orders after purge, found ${count.count}`);
    const itemsCount = await db.get('SELECT COUNT(*) as count FROM order_items');
    if (itemsCount.count !== 0) throw new Error(`Expected 0 order items, found ${itemsCount.count}`);
    const paymentsCount = await db.get('SELECT COUNT(*) as count FROM payments');
    if (paymentsCount.count !== 0) throw new Error(`Expected 0 payments, found ${paymentsCount.count}`);
  });

  // TEST 2: Menu Integrity
  await test('GET /api/menu returns genuine cafe items with integer prices', async () => {
    const res = await request('GET', '/api/menu');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const { products, categories } = res.body.data;
    if (products.length < 15) throw new Error(`Expected at least 15 products, got ${products.length}`);
    if (categories.length < 5) throw new Error(`Expected at least 5 categories, got ${categories.length}`);

    const coldBrew = products.find(p => p.id === 'prod_spanish_cold_brew');
    if (!coldBrew || coldBrew.price !== 199) throw new Error('Spanish Cold Brew price mismatch');
  });

  // TEST 3: Tables
  await test('GET /api/tables returns active tables', async () => {
    const res = await request('GET', '/api/tables');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const tables = res.body.data;
    if (tables.length !== 10) throw new Error(`Expected 10 tables, got ${tables.length}`);
  });

  // TEST 4: Security: Zero-Trust Server Calculation
  await test('Security: Server calculates totals strictly from DB (ignores frontend price tampering)', async () => {
    const res = await request('POST', '/api/orders', {
      customerName: 'Security Tester',
      customerPhone: '9876543210',
      orderType: 'DINE_IN',
      tableNumber: 1,
      paymentMethod: 'COUNTER',
      items: [
        { productId: 'prod_caramel_latte', quantity: 2, price: 1 }, // Trying to pay ₹1 instead of ₹189
        { productId: 'prod_peri_peri_fries', quantity: 1, price: 10 } // Trying to pay ₹10 instead of ₹129
      ]
    });

    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    // Expected: (189 * 2) + (129 * 1) = 378 + 129 = 507
    if (res.body.data.total !== 507) {
      throw new Error(`Price tampering allowed! Expected ₹507, charged ₹${res.body.data.total}`);
    }
  });

  // Purge the security tester order so order history is clean
  await resetOrders();

  // TEST 5: First Genuine Order Creation (Pay at Counter) -> CAF-1001
  let counterOrderNumber = null;
  let counterOrderId = null;

  await test('Genuine Order 1: Creates CAF-1001 with Counter payment in PAYMENT_PENDING', async () => {
    const res = await request('POST', '/api/orders', {
      customerName: 'Sreyash G',
      customerPhone: '9876543210',
      orderType: 'DINE_IN',
      tableNumber: 3,
      paymentMethod: 'COUNTER',
      notes: 'Oat milk if available',
      items: [
        { productId: 'prod_caramel_latte', quantity: 1 }, // 189
        { productId: 'prod_chocolate_brownie', quantity: 1 } // 99 (Total: 288)
      ]
    });

    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    const ord = res.body.data;
    if (ord.orderNumber !== 'CAF-1001') throw new Error(`Expected first order to be CAF-1001, got ${ord.orderNumber}`);
    if (ord.total !== 288) throw new Error(`Expected total ₹288, got ₹${ord.total}`);
    if (ord.paymentStatus !== 'PAYMENT_PENDING') throw new Error(`Expected PAYMENT_PENDING, got ${ord.paymentStatus}`);
    if (ord.status !== 'RECEIVED') throw new Error(`Expected RECEIVED, got ${ord.status}`);

    counterOrderNumber = ord.orderNumber;
    counterOrderId = ord.orderId;
  });

  // TEST 6: Genuine Order 2 (Real Direct UPI) -> CAF-1002
  let upiOrderNumber = null;
  let upiOrderId = null;
  const idempotencyKeyTest = 'test_key_' + crypto.randomUUID();

  await test('Genuine Order 2: Creates CAF-1002 with real UPI QR & standard URI for 9182916879@ybl', async () => {
    const res = await request('POST', '/api/orders', {
      customerName: 'Ananya Sharma',
      customerPhone: '9876543210',
      orderType: 'TAKEAWAY',
      paymentMethod: 'UPI',
      idempotencyKey: idempotencyKeyTest,
      items: [
        { productId: 'prod_spanish_cold_brew', quantity: 1 }, // 199
        { productId: 'prod_chocolate_brownie', quantity: 2 }   // 99 * 2 = 198 (Total: 397)
      ]
    });

    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    const ord = res.body.data;
    if (ord.orderNumber !== 'CAF-1002') throw new Error(`Expected CAF-1002, got ${ord.orderNumber}`);
    if (ord.total !== 397) throw new Error(`Expected ₹397, got ₹${ord.total}`);
    if (ord.paymentStatus !== 'PAYMENT_PENDING') throw new Error(`Expected PAYMENT_PENDING, got ${ord.paymentStatus}`);

    const payment = ord.payment;
    if (!payment) throw new Error('Payment payload missing from order creation response');
    if (payment.destinationVpa !== '9182916879@ybl') throw new Error(`Destination VPA mismatch: ${payment.destinationVpa}`);
    if (!payment.upiUri.includes('pa=9182916879%40ybl') && !payment.upiUri.includes('pa=9182916879@ybl')) {
      throw new Error(`UPI URI does not contain target VPA: ${payment.upiUri}`);
    }
    if (!payment.upiUri.includes('am=397.00')) {
      throw new Error(`UPI URI does not contain exact server amount: ${payment.upiUri}`);
    }
    if (!payment.qrDataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('Valid QR Code Data URL was not generated');
    }

    upiOrderNumber = ord.orderNumber;
    upiOrderId = ord.orderId;
  });

  // TEST 7: Idempotency Enforcement
  await test('Idempotency: Re-submitting identical order with same idempotencyKey returns existing order without duplication', async () => {
    const res = await request('POST', '/api/orders', {
      customerName: 'Ananya Sharma',
      customerPhone: '9876543210',
      orderType: 'TAKEAWAY',
      paymentMethod: 'UPI',
      idempotencyKey: idempotencyKeyTest,
      items: [
        { productId: 'prod_spanish_cold_brew', quantity: 1 },
        { productId: 'prod_chocolate_brownie', quantity: 2 }
      ]
    });

    if (res.status !== 200) throw new Error(`Expected 200 replay, got ${res.status}`);
    if (res.body.data.orderNumber !== upiOrderNumber) throw new Error('Did not return original order number');
    if (!res.body.data.isIdempotentReplay) throw new Error('Expected isIdempotentReplay flag');

    // Verify DB count has not increased
    const count = await db.get('SELECT COUNT(*) as count FROM orders');
    if (count.count !== 2) throw new Error(`Order duplicated! Expected 2 orders, found ${count.count}`);
  });

  // TEST 8: Customer Submits 12-Digit UPI UTR
  await test('UPI Flow: Customer submits 12-digit UTR -> Recorded on order without fake auto-verification', async () => {
    const testUtr = '423589123456';
    const res = await request('POST', '/api/payments/submit-utr', {
      orderNumber: upiOrderNumber,
      utr: testUtr
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.body.data.customerUtr !== testUtr) throw new Error('UTR was not returned');

    // Security & Honest Rule: Order status MUST STILL BE PAYMENT_PENDING
    const orderCheck = await db.get('SELECT customer_utr, payment_status FROM orders WHERE order_number = ?', [upiOrderNumber]);
    if (orderCheck.customer_utr !== testUtr) throw new Error('UTR was not saved in DB');
    if (orderCheck.payment_status !== 'PAYMENT_PENDING') {
      throw new Error(`Rule Violation: Order marked ${orderCheck.payment_status} before admin verification!`);
    }
  });

  // TEST 9: Admin Authentication & Order Review
  let adminToken = null;

  await test('Admin: Login and fetch orders queue with genuine data', async () => {
    const loginRes = await request('POST', '/api/admin/login', {
      email: 'owner@ochrecoffee.com',
      password: process.env.ADMIN_PASSWORD || 'OchreCoffee#2026Secure'
    });
    if (loginRes.status !== 200) throw new Error(`Login failed, got ${loginRes.status}`);
    adminToken = loginRes.body.data.token;

    const ordersRes = await request('GET', '/api/admin/orders', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (ordersRes.status !== 200) throw new Error(`Orders fetch failed, got ${ordersRes.status}`);
    const orders = ordersRes.body.data;
    if (orders.length !== 2) throw new Error(`Expected exactly 2 genuine orders, found ${orders.length}`);

    // Verify customer UTR is visible to admin
    const upiOrd = orders.find(o => o.order_number === upiOrderNumber);
    if (!upiOrd || upiOrd.customer_utr !== '423589123456') throw new Error('Admin did not receive customer UTR');
  });

  // TEST 10: Admin Verifies & Marks UPI Order PAID
  await test('Admin: Verifies UPI payment and clicks Mark Paid -> Updates payment_status to PAID and status to CONFIRMED', async () => {
    const res = await request('POST', `/api/admin/orders/${upiOrderId}/mark-paid`, null, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.body.data.paymentStatus !== 'PAID') throw new Error('Order not marked PAID');

    const dbCheck = await db.get('SELECT status, payment_status FROM orders WHERE id = ?', [upiOrderId]);
    if (dbCheck.payment_status !== 'PAID') throw new Error('DB does not reflect PAID status');
    if (dbCheck.status !== 'CONFIRMED') throw new Error(`Expected CONFIRMED, got ${dbCheck.status}`);
  });

  // TEST 11: Admin Marks Counter Order PAID & Advances Status
  await test('Admin: Marks Counter order as PAID and advances to READY', async () => {
    await request('POST', `/api/admin/orders/${counterOrderId}/mark-paid`, null, {
      'Authorization': `Bearer ${adminToken}`
    });

    const advanceRes = await request('PATCH', `/api/admin/orders/${counterOrderId}/status`, { status: 'READY' }, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (advanceRes.status !== 200) throw new Error('Status update failed');

    const check = await db.get('SELECT status, payment_status FROM orders WHERE id = ?', [counterOrderId]);
    if (check.status !== 'READY') throw new Error(`Expected READY, got ${check.status}`);
    if (check.payment_status !== 'PAID') throw new Error(`Expected PAID, got ${check.payment_status}`);
  });

  // TEST 12: Customer Live Tracking Reflects Verified Updates
  await test('Customer: GET /api/orders/:orderNumber reflects live PAID status and items breakdown', async () => {
    const res = await request('GET', `/api/orders/${upiOrderNumber}`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const ord = res.body.data;
    if (ord.paymentStatus !== 'PAID') throw new Error(`Customer tracker shows ${ord.paymentStatus} instead of PAID`);
    if (ord.status !== 'CONFIRMED') throw new Error(`Customer tracker shows ${ord.status} instead of CONFIRMED`);
    if (ord.customerUtr !== '423589123456') throw new Error('Customer UTR missing in tracker');
  });

  // TEST 13: Customer History API
  await test('Customer: GET /api/orders/history returns genuine orders placed on customer device', async () => {
    const res = await request('GET', `/api/orders/history?orderNumbers=${counterOrderNumber},${upiOrderNumber}`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const list = res.body.data;
    if (list.length !== 2) throw new Error(`Expected 2 orders, got ${list.length}`);
    if (list[0].order_number !== upiOrderNumber) throw new Error('Expected newest order first');
  });

  // TEST 14: Admin Stats Reporting Reflects Real Data
  await test('Admin: GET /api/admin/stats returns metrics strictly calculated from active database', async () => {
    const res = await request('GET', '/api/admin/stats', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const s = res.body.data;
    if (s.todayOrders !== 2) throw new Error(`Expected exactly 2 genuine orders today, got ${s.todayOrders}`);
    if (s.destinationVpa !== '9182916879@ybl') throw new Error(`Destination VPA mismatch: ${s.destinationVpa}`);
  });

  // TEST 15: Razorpay Payment Signature Verification (Valid Signature)
  await test('Razorpay: POST /api/payments/verify with genuine HMAC signature marks order PAID & CONFIRMED', async () => {
    // Create new order for Razorpay checkout test
    const newOrdRes = await request('POST', '/api/orders', {
      customerName: 'Rahul Verma',
      customerPhone: '9876543210',
      orderType: 'DINE_IN',
      tableNumber: 5,
      paymentMethod: 'UPI',
      items: [{ productId: 'prod_caramel_latte', quantity: 1 }]
    });
    if (newOrdRes.status !== 201) throw new Error(`Expected 201, got ${newOrdRes.status}`);
    const rzpOrderData = newOrdRes.body.data;
    const rzpOrderId = rzpOrderData.payment.razorpayOrderId;
    if (!rzpOrderId) throw new Error('Razorpay order ID not returned from API');

    const fakePaymentId = 'pay_test_' + crypto.randomUUID().slice(0, 10);
    const validSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'TykDQoaag7ZCwf19VcGLreOQ')
      .update(`${rzpOrderId}|${fakePaymentId}`)
      .digest('hex');

    const verifyRes = await request('POST', '/api/payments/verify', {
      orderNumber: rzpOrderData.orderNumber,
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: fakePaymentId,
      razorpay_signature: validSignature
    });

    if (verifyRes.status !== 200) throw new Error(`Expected 200, got ${verifyRes.status}`);
    if (verifyRes.body.data.paymentStatus !== 'PAID') throw new Error('Payment status not marked PAID');

    const dbCheck = await db.get('SELECT payment_status, status, razorpay_payment_id FROM orders WHERE order_number = ?', [rzpOrderData.orderNumber]);
    if (dbCheck.payment_status !== 'PAID') throw new Error(`DB order not PAID: ${dbCheck.payment_status}`);
    if (dbCheck.status !== 'CONFIRMED') throw new Error(`DB order not CONFIRMED: ${dbCheck.status}`);
    if (dbCheck.razorpay_payment_id !== fakePaymentId) throw new Error('Payment ID mismatch in DB');
  });

  // TEST 16: Razorpay Payment Signature Verification (Tampered/Invalid Signature)
  await test('Razorpay: POST /api/payments/verify rejects forged signature with 400', async () => {
    const res = await request('POST', '/api/payments/verify', {
      orderNumber: counterOrderNumber,
      razorpay_order_id: 'order_fake123',
      razorpay_payment_id: 'pay_fake123',
      razorpay_signature: 'forged_fake_signature_hex_value_00000000'
    });
    if (res.status !== 400) throw new Error(`Expected 400 rejection, got ${res.status}`);
    if (res.body.error.code !== 'INVALID_SIGNATURE') throw new Error(`Expected INVALID_SIGNATURE code, got ${res.body.error.code}`);
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  server.close();
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err);
  if (server) server.close();
  process.exit(1);
});
