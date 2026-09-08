/**
 * Razorpay Standard Web Checkout Test Suite
 * Validates:
 * 1. POST /api/create-order (amount validation, auth error handling, standard payload)
 * 2. POST /api/verify-payment (missing field rejection, signature mismatch rejection, valid HMAC verification)
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

async function runRazorpayStandardTests() {
  console.log('\n💳 Starting Razorpay Standard Web Checkout Test Suite...\n');

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  await resetOrders();

  // 1. BACKEND - CREATE ORDER TESTS
  console.log('--- 1. POST /api/create-order (Order Creation & Validation) ---');

  await test('Reject create-order when amount is missing with HTTP 400', async () => {
    const res = await request('POST', '/api/create-order', {
      currency: 'INR',
      receipt: 'rcpt_test_missing'
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    if (res.body.error?.code !== 'INVALID_AMOUNT') throw new Error(`Expected INVALID_AMOUNT, got ${res.body.error?.code}`);
  });

  await test('Reject create-order when amount < 100 paise with HTTP 400', async () => {
    const res = await request('POST', '/api/create-order', {
      amount: 50, // 50 paise is less than the minimum 100 paise
      currency: 'INR',
      receipt: 'rcpt_test_low'
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    if (res.body.error?.code !== 'INVALID_AMOUNT') throw new Error(`Expected INVALID_AMOUNT, got ${res.body.error?.code}`);
  });

  await test('Handle Razorpay auth failure with HTTP 401 when API credentials are rejected', async () => {
    const res = await request('POST', '/api/create-order', {
      amount: 50000, // 500.00 INR (50000 paise)
      currency: 'INR',
      receipt: 'rcpt_test_500'
    });
    // With test keys rzp_test_TZb2HAumP0qRvS, Razorpay API responds with 401 Authentication failed
    if (res.status !== 401 && res.status !== 200) {
      throw new Error(`Expected 401 (or 200 if credentials were active), got ${res.status}`);
    }
    if (res.status === 401) {
      if (res.body.error?.code !== 'AUTH_FAILED') {
        throw new Error(`Expected error code AUTH_FAILED, got ${res.body.error?.code}`);
      }
    }
  });

  // 2. BACKEND - VERIFY PAYMENT SIGNATURE TESTS
  console.log('\n--- 2. POST /api/verify-payment (HMAC-SHA256 Signature Verification) ---');

  await test('Reject verify-payment with missing order_id with HTTP 400', async () => {
    const res = await request('POST', '/api/verify-payment', {
      payment_id: 'pay_123',
      signature: 'sig_123'
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    if (res.body.error?.code !== 'MISSING_FIELDS') throw new Error(`Expected MISSING_FIELDS, got ${res.body.error?.code}`);
  });

  await test('Reject verify-payment with missing payment_id with HTTP 400', async () => {
    const res = await request('POST', '/api/verify-payment', {
      order_id: 'order_123',
      signature: 'sig_123'
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    if (res.body.error?.code !== 'MISSING_FIELDS') throw new Error(`Expected MISSING_FIELDS, got ${res.body.error?.code}`);
  });

  await test('Reject verify-payment with missing signature with HTTP 400', async () => {
    const res = await request('POST', '/api/verify-payment', {
      order_id: 'order_123',
      payment_id: 'pay_123'
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    if (res.body.error?.code !== 'MISSING_FIELDS') throw new Error(`Expected MISSING_FIELDS, got ${res.body.error?.code}`);
  });

  await test('Reject verify-payment with forged/invalid signature with HTTP 400', async () => {
    const res = await request('POST', '/api/verify-payment', {
      order_id: 'order_valid_123',
      payment_id: 'pay_valid_456',
      signature: 'invalid_forged_hex_signature_0000000000000000000000000000000000000000000000000000000000000000'
    });
    if (res.status !== 400) throw new Error(`Expected 400 rejection, got ${res.status}`);
    if (res.body.error?.code !== 'INVALID_SIGNATURE') throw new Error(`Expected INVALID_SIGNATURE code, got ${res.body.error?.code}`);
  });

  await test('Accept standalone valid HMAC-SHA256 signature with HTTP 200', async () => {
    const testOrderId = 'order_test_' + crypto.randomBytes(6).toString('hex');
    const testPaymentId = 'pay_test_' + crypto.randomBytes(6).toString('hex');
    const secret = process.env.RAZORPAY_KEY_SECRET;

    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(`${testOrderId}|${testPaymentId}`)
      .digest('hex');

    const res = await request('POST', '/api/verify-payment', {
      order_id: testOrderId,
      payment_id: testPaymentId,
      signature: validSignature
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.body.success) throw new Error('Expected success: true');
    if (res.body.order_id !== testOrderId) throw new Error('Returned order_id mismatch');
    if (res.body.payment_id !== testPaymentId) throw new Error('Returned payment_id mismatch');
  });

  await test('Verify payment for an existing cafe order and confirm status updates to PAID and CONFIRMED', async () => {
    // 1. Create a genuine cafe order
    const orderRes = await request('POST', '/api/orders', {
      customerName: 'Aarav Gupta',
      customerPhone: '9123456780',
      orderType: 'DINE_IN',
      tableNumber: 3,
      paymentMethod: 'RAZORPAY',
      items: [
        { productId: 'prod_caramel_latte', quantity: 1 },
        { productId: 'prod_hazelnut_mocha', quantity: 1 }
      ]
    });

    if (orderRes.status !== 201) throw new Error(`Failed to create order, got ${orderRes.status} (${JSON.stringify(orderRes.body)})`);
    const orderNumber = orderRes.body.data.orderNumber;

    // Attach test Razorpay order ID to order
    const rzpOrderId = 'order_rzp_' + crypto.randomBytes(8).toString('hex');
    await db.run('UPDATE orders SET razorpay_order_id = ? WHERE order_number = ?', [rzpOrderId, orderNumber]);

    const fakePaymentId = 'pay_live_' + crypto.randomBytes(8).toString('hex');
    const validSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${rzpOrderId}|${fakePaymentId}`)
      .digest('hex');

    // Call POST /api/verify-payment with standard Razorpay callback parameters
    const verifyRes = await request('POST', '/api/verify-payment', {
      orderNumber,
      razorpay_order_id: rzpOrderId,
      razorpay_payment_id: fakePaymentId,
      razorpay_signature: validSignature
    });

    if (verifyRes.status !== 200) throw new Error(`Expected 200, got ${verifyRes.status}`);
    if (!verifyRes.body.success) throw new Error('Expected success: true');

    // Verify DB record status
    const dbOrder = await db.get('SELECT payment_status, status, razorpay_order_id, razorpay_payment_id FROM orders WHERE order_number = ?', [orderNumber]);
    if (dbOrder.payment_status !== 'PAID') throw new Error(`Expected payment_status PAID, got ${dbOrder.payment_status}`);
    if (dbOrder.status !== 'CONFIRMED') throw new Error(`Expected status CONFIRMED, got ${dbOrder.status}`);
    if (dbOrder.razorpay_payment_id !== fakePaymentId) throw new Error('Payment ID was not saved to DB');
  });

  await test('Idempotent replay: Re-submitting verified payment returns 200 without error', async () => {
    const existingOrder = await db.get("SELECT order_number, razorpay_order_id, razorpay_payment_id FROM orders WHERE payment_status = 'PAID' LIMIT 1");
    if (!existingOrder) throw new Error('No existing paid order found');

    const validSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${existingOrder.razorpay_order_id}|${existingOrder.razorpay_payment_id}`)
      .digest('hex');

    const res = await request('POST', '/api/verify-payment', {
      orderNumber: existingOrder.order_number,
      order_id: existingOrder.razorpay_order_id,
      payment_id: existingOrder.razorpay_payment_id,
      signature: validSignature
    });

    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.body.success) throw new Error('Expected success: true');
  });

  console.log(`\n========================================`);
  console.log(`Razorpay Tests: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  server.close();
  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runRazorpayStandardTests().catch((err) => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runRazorpayStandardTests };
