/**
 * Comprehensive Automated Verification Suite for Ochre Coffee Roasters
 * Validates the complete order lifecycle, security rules, payment verification,
 * webhook idempotency, and admin controls.
 */

const http = require('http');
const crypto = require('crypto');
const app = require('../server');
const db = require('../db');

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
  console.log('🧪 Starting Ochre Restaurant Verification Suite...\n');

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

  // TEST 1: Public Menu
  await test('GET /api/menu returns active categories & products with availability states', async () => {
    const res = await request('GET', '/api/menu');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.body.success) throw new Error('Expected success: true');
    const { products, categories } = res.body.data;
    if (!Array.isArray(products) || products.length === 0) throw new Error('No products returned');
    if (!Array.isArray(categories) || categories.length === 0) throw new Error('No categories returned');

    const caramelLatte = products.find(p => p.id === 'prod_caramel_latte');
    if (!caramelLatte) throw new Error('Caramel Latte not found in menu');
    if (caramelLatte.price !== 189) throw new Error(`Expected ₹189, got ${caramelLatte.price}`);
  });

  // TEST 2: Tables List & Occupancy
  await test('GET /api/tables returns 10 cafe tables with occupancy status', async () => {
    const res = await request('GET', '/api/tables');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const tables = res.body.data;
    if (tables.length < 10) throw new Error(`Expected at least 10 tables, got ${tables.length}`);
    const t1 = tables.find(t => t.tableNumber === 1);
    if (!t1 || typeof t1.isOccupied !== 'boolean') throw new Error('Table 1 missing or invalid format');
  });

  // TEST 3: Zero-Trust Price Manipulation Protection
  await test('Security: Server ignores manipulated frontend prices and charges correct DB price', async () => {
    // Malicious user attempts to set price = 1
    const orderPayload = {
      customerName: 'Hacker Test',
      customerPhone: '9876543210',
      orderType: 'DINE_IN',
      tableNumber: 1,
      paymentMethod: 'COUNTER',
      items: [
        { productId: 'prod_caramel_latte', quantity: 2, price: 1 }, // Trying to pay ₹2 instead of ₹378
        { productId: 'prod_peri_peri_fries', quantity: 1, price: 5 } // Trying to pay ₹5 instead of ₹129
      ]
    };

    const res = await request('POST', '/api/orders', orderPayload);
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    // Expected DB calculation: (189 * 2) + (129 * 1) = 378 + 129 = 507
    if (res.body.data.total !== 507) {
      throw new Error(`Security breach: Server trusted client price! Expected ₹507, charged ₹${res.body.data.total}`);
    }
  });

  // TEST 4: Invalid Table Safety
  await test('Security: Dine-in order with non-existent table (99999) is rejected', async () => {
    const orderPayload = {
      customerName: 'Test Guest',
      customerPhone: '9876543210',
      orderType: 'DINE_IN',
      tableNumber: 99999,
      paymentMethod: 'COUNTER',
      items: [{ productId: 'prod_caramel_latte', quantity: 1 }]
    };

    const res = await request('POST', '/api/orders', orderPayload);
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    if (res.body.error?.code !== 'INVALID_TABLE') throw new Error(`Expected INVALID_TABLE error, got ${res.body.error?.code}`);
  });

  // TEST 5: Pay at Counter Full Lifecycle
  let counterOrderNumber = null;
  let counterOrderId = null;

  await test('Customer: Places Dine-in Pay-at-Counter order -> Created with PENDING payment', async () => {
    const orderPayload = {
      customerName: 'Sreyash G',
      customerPhone: '9876543210',
      orderType: 'DINE_IN',
      tableNumber: 5,
      paymentMethod: 'COUNTER',
      notes: 'Extra hot please',
      items: [
        { productId: 'prod_caramel_latte', quantity: 2 },
        { productId: 'prod_grilled_cheese', quantity: 1 }
      ]
    };

    const res = await request('POST', '/api/orders', orderPayload);
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    const ord = res.body.data;
    if (!ord.orderNumber.startsWith('CAF-')) throw new Error(`Invalid order number: ${ord.orderNumber}`);
    if (ord.paymentStatus !== 'PENDING') throw new Error(`Expected PENDING, got ${ord.paymentStatus}`);
    if (ord.status !== 'RECEIVED') throw new Error(`Expected RECEIVED, got ${ord.status}`);
    if (ord.total !== (189 * 2 + 149)) throw new Error(`Expected total ₹527, got ₹${ord.total}`);

    counterOrderNumber = ord.orderNumber;
    counterOrderId = ord.orderId;
  });

  // TEST 6: Customer Order Tracking
  await test('Customer: Can track order status at GET /api/orders/:orderNumber', async () => {
    const res = await request('GET', `/api/orders/${counterOrderNumber}`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const ord = res.body.data;
    if (ord.orderNumber !== counterOrderNumber) throw new Error('Order number mismatch');
    if (ord.tableNumber !== 5) throw new Error('Table number mismatch');
    if (!Array.isArray(ord.items) || ord.items.length !== 2) throw new Error('Items list mismatch');
  });

  // TEST 7: Admin Authentication & Protection
  let adminToken = null;

  await test('Admin: Unauthenticated requests to /api/admin/orders are blocked (401)', async () => {
    const res = await request('GET', '/api/admin/orders');
    if (res.status !== 401) throw new Error(`Expected 401 UNAUTHORIZED, got ${res.status}`);
  });

  await test('Admin: Login with valid credentials succeeds and returns JWT', async () => {
    const res = await request('POST', '/api/admin/login', {
      email: 'owner@ochrecoffee.com',
      password: 'ochreAdmin2026!'
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.body.data?.token) throw new Error('No JWT token returned');
    adminToken = res.body.data.token;
  });

  // TEST 8: Admin Marks Counter Payment as Paid
  await test('Admin: Marks Counter order as PAID -> Updates order paymentStatus to PAID', async () => {
    const res = await request('POST', `/api/admin/orders/${counterOrderId}/mark-paid`, null, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.body.data?.paymentStatus !== 'PAID') throw new Error('Payment status was not updated to PAID');

    // Verify DB
    const check = await db.get('SELECT payment_status FROM orders WHERE id = ?', [counterOrderId]);
    if (check.payment_status !== 'PAID') throw new Error('Database does not reflect PAID status');
  });

  // TEST 9: Admin Status Transitions
  await test('Admin: Updates order status: RECEIVED -> PREPARING -> READY -> COMPLETED', async () => {
    for (const nextStatus of ['PREPARING', 'READY', 'COMPLETED']) {
      const res = await request('PATCH', `/api/admin/orders/${counterOrderId}/status`, { status: nextStatus }, {
        'Authorization': `Bearer ${adminToken}`
      });
      if (res.status !== 200) throw new Error(`Failed to update to ${nextStatus}, got ${res.status}`);
      const check = await db.get('SELECT status FROM orders WHERE id = ?', [counterOrderId]);
      if (check.status !== nextStatus) throw new Error(`Status in DB was not updated to ${nextStatus}`);
    }
  });

  // TEST 10: Online UPI / Razorpay Payment Lifecycle & Verification
  let upiOrderNumber = null;
  let rzpOrderId = null;

  await test('UPI Flow: Place order -> Initiate Razorpay order with server-calculated amount', async () => {
    const orderPayload = {
      customerName: 'Ananya Sharma',
      customerPhone: '9876543210',
      orderType: 'TAKEAWAY',
      tableNumber: null,
      paymentMethod: 'UPI',
      items: [
        { productId: 'prod_spanish_cold_brew', quantity: 1 }, // 199
        { productId: 'prod_chocolate_brownie', quantity: 2 }   // 99 * 2 = 198 (Total: 397)
      ]
    };

    const res = await request('POST', '/api/orders', orderPayload);
    if (res.status !== 201) throw new Error(`Order creation failed, got ${res.status}`);
    upiOrderNumber = res.body.data.orderNumber;

    // Create payment gateway order
    const payRes = await request('POST', '/api/payments/create', { orderNumber: upiOrderNumber });
    if (payRes.status !== 200) throw new Error(`Payment creation failed, got ${payRes.status}`);
    const payData = payRes.body.data;
    if (payData.amount !== 39700) throw new Error(`Expected 39700 paise, got ${payData.amount}`);
    if (payData.destinationVpa !== '9182916879@ybl') throw new Error(`Target VPA mismatch: ${payData.destinationVpa}`);
    rzpOrderId = payData.razorpayOrderId;
  });

  await test('Security: Tampered payment verification signature is REJECTED', async () => {
    const fakeVerification = {
      orderNumber: upiOrderNumber,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: 'pay_tampered_123',
      razorpaySignature: 'totally_forged_fake_signature_hash'
    };

    const res = await request('POST', '/api/payments/verify', fakeVerification);
    if (res.status !== 400) throw new Error(`Expected 400 rejection for forged signature, got ${res.status}`);

    // Verify order was NOT marked paid
    const check = await db.get('SELECT payment_status FROM orders WHERE order_number = ?', [upiOrderNumber]);
    if (check.payment_status === 'PAID') throw new Error('Security breach: Order was marked paid with invalid signature!');
  });

  await test('UPI Flow: Valid signature verification marks order PAID and CONFIRMED', async () => {
    const validPaymentId = 'pay_verified_789';
    const validSig = 'sim_verified_sig';

    const res = await request('POST', '/api/payments/verify', {
      orderNumber: upiOrderNumber,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: validPaymentId,
      razorpaySignature: validSig
    });

    if (res.status !== 200) throw new Error(`Verification failed, got ${res.status}`);
    const check = await db.get('SELECT status, payment_status FROM orders WHERE order_number = ?', [upiOrderNumber]);
    if (check.payment_status !== 'PAID') throw new Error(`Expected PAID, got ${check.payment_status}`);
    if (check.status !== 'CONFIRMED') throw new Error(`Expected CONFIRMED, got ${check.status}`);
  });

  // TEST 11: Webhook Idempotency
  await test('Webhook: Processing same payment event twice is idempotent', async () => {
    const testEventId = 'evt_test_idempotency_' + crypto.randomUUID().slice(0, 8);
    const webhookPayload = JSON.stringify({
      entity: 'event',
      id: testEventId,
      event: 'order.paid',
      payload: {
        order: {
          entity: {
            id: rzpOrderId,
            amount: 39700,
            status: 'paid'
          }
        }
      }
    });

    // First arrival
    const res1 = await request('POST', '/api/payments/razorpay/webhook', webhookPayload, {
      'x-razorpay-signature': 'sim_sig'
    });
    if (res1.status !== 200) throw new Error(`Expected 200 on first webhook, got ${res1.status}`);

    // Second arrival (retry)
    const res2 = await request('POST', '/api/payments/razorpay/webhook', webhookPayload, {
      'x-razorpay-signature': 'sim_sig'
    });
    if (res2.status !== 200) throw new Error(`Expected 200 on second webhook, got ${res2.status}`);
    if (res2.body.status !== 'already_processed') throw new Error(`Expected already_processed, got ${res2.body.status}`);
  });

  // TEST 12: Admin Product Availability Toggle & Checkout Rejection
  await test('Admin: Toggles product availability -> Customer order for unavailable item is REJECTED', async () => {
    // 1. Toggle Caramel Latte to UNAVAILABLE
    const toggleRes = await request('PATCH', '/api/admin/products/prod_caramel_latte/availability', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (toggleRes.status !== 200) throw new Error(`Toggle failed, got ${toggleRes.status}`);
    if (toggleRes.body.data.available !== false) throw new Error('Product should be unavailable');

    // 2. Customer attempts to checkout with Caramel Latte
    const orderPayload = {
      customerName: 'Late Customer',
      customerPhone: '9876543210',
      orderType: 'TAKEAWAY',
      tableNumber: null,
      paymentMethod: 'COUNTER',
      items: [{ productId: 'prod_caramel_latte', quantity: 1 }]
    };

    const checkoutRes = await request('POST', '/api/orders', orderPayload);
    if (checkoutRes.status !== 400) throw new Error(`Expected 400 for unavailable item, got ${checkoutRes.status}`);
    if (checkoutRes.body.error?.code !== 'PRODUCT_UNAVAILABLE') {
      throw new Error(`Expected PRODUCT_UNAVAILABLE, got ${checkoutRes.body.error?.code}`);
    }

    // 3. Toggle Caramel Latte back to AVAILABLE
    await request('PATCH', '/api/admin/products/prod_caramel_latte/availability', null, {
      'Authorization': `Bearer ${adminToken}`
    });
  });

  // TEST 13: Admin Stats Reporting
  await test('Admin: GET /api/admin/stats returns accurate revenue and order counts', async () => {
    const res = await request('GET', '/api/admin/stats', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const s = res.body.data;
    if (typeof s.todayOrders !== 'number' || s.todayOrders < 2) throw new Error(`Expected at least 2 orders today, got ${s.todayOrders}`);
    if (typeof s.todayRevenue !== 'number' || s.todayRevenue < 397) throw new Error(`Expected revenue >= 397, got ${s.todayRevenue}`);
    if (s.destinationVpa !== '9182916879@ybl') throw new Error(`Expected destination VPA 9182916879@ybl, got ${s.destinationVpa}`);
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
