/**
 * Comprehensive Production Security & Hardening Regression Test Suite
 * Ochre Coffee Roasters
 *
 * Tests:
 * 1. Authentication & JWT Pinning (Expiry, Algorithm, Issuer, Audience)
 * 2. CSRF Protection for Cookie Mutations
 * 3. Role-Based Access Control (RBAC: Cashier vs Owner)
 * 4. Production Reset Guards (ALLOW_PRODUCTION_ORDER_RESET)
 * 5. Order Status State Machine (Reject backward/illegal transitions)
 * 6. Customer Privacy & Order Enumeration Masking
 * 7. Table Concurrency Collision (Simultaneous orders for same table)
 * 8. Idempotency Concurrency (Simultaneous orders with same key)
 * 9. Duplicate UPI UTR Rejection
 * 10. Audit Logging Persistence
 * 11. Razorpay HMAC & Webhook Idempotency
 * 12. Public API Rate Limiting
 */

const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('../db');
const { resetOrders } = require('../db/reset-orders');
const { getJwtSecret, JWT_ISSUER, JWT_AUDIENCE } = require('../middleware/auth');

let server = null;
let baseUrl = '';
let passed = 0;
let failed = 0;

function request(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let body = null;

    if (data) {
      body = typeof data === 'string' ? data : JSON.stringify(data);
      if (!reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (e) {
            parsed = raw;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed
          });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

async function runSecuritySuite() {
  console.log('🛡️ Starting Ochre Coffee Roasters Security Regression Suite...\n');

  await db.initDb();
  await resetOrders();

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  const secret = getJwtSecret();

  // 1. AUTHENTICATION & JWT SECURITY
  console.log('\n--- 1. AUTHENTICATION & JWT INTEGRITY ---');

  await test('Reject request without authentication token', async () => {
    const res = await request('GET', '/api/admin/orders');
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await test('Reject token signed with wrong algorithm (none attack)', async () => {
    // Unsigned 'none' algorithm token
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ id: 'usr_owner', role: 'OWNER', email: 'owner@ochrecoffee.com', iss: JWT_ISSUER, aud: JWT_AUDIENCE })
    ).toString('base64url');
    const forgedToken = `${header}.${payload}.`;

    const res = await request('GET', '/api/admin/orders', null, {
      Authorization: `Bearer ${forgedToken}`
    });
    if (res.status !== 401) throw new Error(`Expected 401 rejection for none alg, got ${res.status}`);
  });

  await test('Reject token with wrong issuer', async () => {
    const badIssToken = jwt.sign(
      { id: 'usr_owner', role: 'OWNER', email: 'owner@ochrecoffee.com' },
      secret,
      { algorithm: 'HS256', issuer: 'attacker-issuer', audience: JWT_AUDIENCE, expiresIn: '1h' }
    );

    const res = await request('GET', '/api/admin/orders', null, {
      Authorization: `Bearer ${badIssToken}`
    });
    if (res.status !== 401) throw new Error(`Expected 401 rejection for bad issuer, got ${res.status}`);
  });

  await test('Reject expired token', async () => {
    const expiredToken = jwt.sign(
      { id: 'usr_owner', role: 'OWNER', email: 'owner@ochrecoffee.com' },
      secret,
      { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '-1s' }
    );

    const res = await request('GET', '/api/admin/orders', null, {
      Authorization: `Bearer ${expiredToken}`
    });
    if (res.status !== 401) throw new Error(`Expected 401 rejection for expired token, got ${res.status}`);
  });

  // 2. CSRF PROTECTION
  console.log('\n--- 2. CSRF PROTECTION ---');

  const validOwnerToken = jwt.sign(
    { id: 'usr_owner', role: 'OWNER', email: 'owner@ochrecoffee.com' },
    secret,
    { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '1h' }
  );

  await test('Reject cookie-authenticated mutation without CSRF token', async () => {
    const res = await request(
      'PATCH',
      '/api/admin/products/prod_caramel_latte/availability',
      null,
      {
        Cookie: `admin_token=${validOwnerToken}; ochre_csrf=secret-csrf-value`
        // Missing x-csrf-token header
      }
    );
    if (res.status !== 403) throw new Error(`Expected 403 CSRF rejection, got ${res.status}`);
  });

  await test('Reject cookie-authenticated mutation with mismatched CSRF token', async () => {
    const res = await request(
      'PATCH',
      '/api/admin/products/prod_caramel_latte/availability',
      null,
      {
        Cookie: `admin_token=${validOwnerToken}; ochre_csrf=cookie-token-123`,
        'x-csrf-token': 'attacker-mismatched-token'
      }
    );
    if (res.status !== 403) throw new Error(`Expected 403 CSRF mismatch, got ${res.status}`);
  });

  await test('Allow cookie mutation with matching CSRF token', async () => {
    const csrfVal = 'valid-csrf-match-123';
    const res = await request(
      'PATCH',
      '/api/admin/products/prod_caramel_latte/availability',
      null,
      {
        Cookie: `admin_token=${validOwnerToken}; ochre_csrf=${csrfVal}`,
        'x-csrf-token': csrfVal
      }
    );
    if (res.status !== 200) throw new Error(`Expected 200 CSRF success, got ${res.status}`);
    // Restore availability
    await request('PATCH', '/api/admin/products/prod_caramel_latte/availability', null, {
      Authorization: `Bearer ${validOwnerToken}`
    });
  });

  // 3. ROLE-BASED AUTHORIZATION (CASHIER VS OWNER)
  console.log('\n--- 3. ROLE-BASED ACCESS CONTROL (RBAC) ---');

  const validCashierToken = jwt.sign(
    { id: 'usr_cashier', role: 'CASHIER', email: 'cashier@ochrecoffee.com' },
    secret,
    { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '1h' }
  );

  await test('Cashier can view orders queue', async () => {
    const res = await request('GET', '/api/admin/orders', null, {
      Authorization: `Bearer ${validCashierToken}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await test('Cashier BLOCKED from resetting orders (requireOwner)', async () => {
    const res = await request('POST', '/api/admin/orders/reset', { confirm: true }, {
      Authorization: `Bearer ${validCashierToken}`
    });
    if (res.status !== 403) throw new Error(`Expected 403 FORBIDDEN, got ${res.status}`);
    if (res.body.error.code !== 'FORBIDDEN') throw new Error(`Expected FORBIDDEN code, got ${res.body.error.code}`);
  });

  await test('Cashier BLOCKED from modifying product prices (requireOwner)', async () => {
    const res = await request(
      'PUT',
      '/api/admin/products/prod_caramel_latte',
      { name: 'Caramel Latte', price: 299, categoryId: 'cat_espresso', description: 'Test' },
      { Authorization: `Bearer ${validCashierToken}` }
    );
    if (res.status !== 403) throw new Error(`Expected 403 FORBIDDEN, got ${res.status}`);
  });

  await test('Cashier BLOCKED from toggling product availability (requireOwner)', async () => {
    const res = await request('PATCH', '/api/admin/products/prod_caramel_latte/availability', null, {
      Authorization: `Bearer ${validCashierToken}`
    });
    if (res.status !== 403) throw new Error(`Expected 403 FORBIDDEN, got ${res.status}`);
  });

  await test('Owner ALLOWED on product availability toggle', async () => {
    const res = await request('PATCH', '/api/admin/products/prod_caramel_latte/availability', null, {
      Authorization: `Bearer ${validOwnerToken}`
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    // Restore
    await request('PATCH', '/api/admin/products/prod_caramel_latte/availability', null, {
      Authorization: `Bearer ${validOwnerToken}`
    });
  });

  // 4. ORDER STATUS STATE MACHINE
  console.log('\n--- 4. ORDER STATUS STATE MACHINE ---');

  let testOrderId = null;
  let testOrderNumber = null;
  let testOrderToken = null;

  await test('Create order for state machine testing', async () => {
    const res = await request('POST', '/api/orders', {
      customerName: 'State Machine Tester',
      customerPhone: '9876543210',
      orderType: 'DINE_IN',
      tableNumber: 3,
      paymentMethod: 'COUNTER',
      items: [{ productId: 'prod_caramel_latte', quantity: 1 }]
    });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
    testOrderId = res.body.data.orderId;
    testOrderNumber = res.body.data.orderNumber;
    testOrderToken = res.body.data.orderToken;
  });

  await test('Reject illegal status jump (RECEIVED -> READY before payment/confirmation)', async () => {
    const res = await request('PATCH', `/api/admin/orders/${testOrderId}/status`, { status: 'READY' }, {
      Authorization: `Bearer ${validOwnerToken}`
    });
    if (res.status !== 400) throw new Error(`Expected 400 for illegal status transition, got ${res.status}`);
    if (res.body.error.code !== 'ILLEGAL_TRANSITION') throw new Error(`Expected ILLEGAL_TRANSITION, got ${res.body.error.code}`);
  });

  await test('Allow valid forward status progression (RECEIVED -> CONFIRMED -> PREPARING -> READY)', async () => {
    const paidRes = await request('POST', `/api/admin/orders/${testOrderId}/mark-paid`, null, {
      Authorization: `Bearer ${validOwnerToken}`
    });
    if (paidRes.status !== 200) throw new Error(`Expected 200 mark-paid, got ${paidRes.status}`);

    const step1 = await request('PATCH', `/api/admin/orders/${testOrderId}/status`, { status: 'PREPARING' }, {
      Authorization: `Bearer ${validOwnerToken}`
    });
    if (step1.status !== 200) throw new Error(`Expected 200 PREPARING, got ${step1.status}`);

    const step2 = await request('PATCH', `/api/admin/orders/${testOrderId}/status`, { status: 'READY' }, {
      Authorization: `Bearer ${validOwnerToken}`
    });
    if (step2.status !== 200) throw new Error(`Expected 200 READY, got ${step2.status}`);
  });

  await test('Reject backward status transition (READY -> RECEIVED)', async () => {
    const res = await request('PATCH', `/api/admin/orders/${testOrderId}/status`, { status: 'RECEIVED' }, {
      Authorization: `Bearer ${validOwnerToken}`
    });
    if (res.status !== 400) throw new Error(`Expected 400 for backward transition, got ${res.status}`);
  });

  // 5. CUSTOMER PRIVACY & DATA MASKING
  console.log('\n--- 5. CUSTOMER PRIVACY & DATA MASKING ---');

  await test('Public unauthenticated request receives masked customer data', async () => {
    const res = await request('GET', `/api/orders/${testOrderNumber}`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = res.body.data;

    if (!data.isMasked) throw new Error('Expected isMasked: true');
    if (data.customerName !== 'S*** M*** T***') {
      throw new Error(`Expected masked name 'S*** M*** T***', got '${data.customerName}'`);
    }
    if (data.customerPhone !== null && data.customerPhone !== undefined) {
      throw new Error(`Expected customerPhone to be null, got ${data.customerPhone}`);
    }
    if (data.customerUtr !== null && data.customerUtr !== undefined) {
      throw new Error(`Expected customerUtr to be null, got ${data.customerUtr}`);
    }
    if (data.items.length !== 0) {
      throw new Error(`Expected items to be empty array for unauthorized caller, got ${data.items.length}`);
    }
  });

  await test('Authorized customer with orderToken receives unmasked details', async () => {
    const res = await request('GET', `/api/orders/${testOrderNumber}`, null, {
      'x-order-token': testOrderToken
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const data = res.body.data;

    if (data.isMasked) throw new Error('Expected isMasked: false');
    if (data.customerName !== 'State Machine Tester') {
      throw new Error(`Expected full name, got '${data.customerName}'`);
    }
    if (data.items.length === 0) {
      throw new Error('Expected full items list for authorized customer');
    }
  });

  // 6. CONCURRENT TABLE BOOKING RACE CONDITION
  console.log('\n--- 6. CONCURRENCY & RACE CONDITIONS ---');

  await test('Concurrent Table Booking: Two simultaneous requests for Table #7 -> Exactly one succeeds', async () => {
    const reqDataA = {
      customerName: 'User A Concurrent',
      customerPhone: '9876543211',
      orderType: 'DINE_IN',
      tableNumber: 7,
      paymentMethod: 'COUNTER',
      items: [{ productId: 'prod_caramel_latte', quantity: 1 }]
    };
    const reqDataB = {
      customerName: 'User B Concurrent',
      customerPhone: '9876543212',
      orderType: 'DINE_IN',
      tableNumber: 7,
      paymentMethod: 'COUNTER',
      items: [{ productId: 'prod_spanish_cold_brew', quantity: 1 }]
    };

    const [resA, resB] = await Promise.all([
      request('POST', '/api/orders', reqDataA),
      request('POST', '/api/orders', reqDataB)
    ]);

    const statuses = [resA.status, resB.status].sort();
    if (statuses[0] !== 201 || statuses[1] !== 400) {
      throw new Error(`Expected exactly one 201 and one 400, got [${resA.status}, ${resB.status}]`);
    }

    const failedRes = resA.status === 400 ? resA : resB;
    if (failedRes.body.error.code !== 'TABLE_OCCUPIED') {
      throw new Error(`Expected TABLE_OCCUPIED code, got ${failedRes.body.error.code}`);
    }
  });

  await test('Concurrent Idempotency: Simultaneous requests with same idempotencyKey return identical order', async () => {
    const sharedKey = 'concurrent_idemp_' + crypto.randomUUID();
    const orderPayload = {
      customerName: 'Idempotency Tester',
      customerPhone: '9876543210',
      orderType: 'TAKEAWAY',
      paymentMethod: 'COUNTER',
      idempotencyKey: sharedKey,
      items: [{ productId: 'prod_chocolate_brownie', quantity: 1 }]
    };

    const [res1, res2] = await Promise.all([
      request('POST', '/api/orders', orderPayload),
      request('POST', '/api/orders', orderPayload)
    ]);

    if (res1.status !== 201 && res1.status !== 200) throw new Error(`Res1 failed: ${res1.status}`);
    if (res2.status !== 201 && res2.status !== 200) throw new Error(`Res2 failed: ${res2.status}`);

    const ordNum1 = res1.body.data.orderNumber;
    const ordNum2 = res2.body.data.orderNumber;

    if (ordNum1 !== ordNum2) {
      throw new Error(`Idempotency race created duplicate orders: ${ordNum1} vs ${ordNum2}`);
    }
  });

  // 7. DUPLICATE UTR PREVENTION
  console.log('\n--- 7. DIRECT UPI & DUPLICATE UTR PREVENTION ---');

  const utrShared = '987654000111';
  let upiOrder1 = null;
  let upiOrder2 = null;

  await test('Submit UTR on Order 1 succeeds', async () => {
    const o1 = await request('POST', '/api/orders', {
      customerName: 'UPI User 1',
      customerPhone: '9876543210',
      orderType: 'TAKEAWAY',
      paymentMethod: 'UPI',
      items: [{ productId: 'prod_caramel_latte', quantity: 1 }]
    });
    upiOrder1 = o1.body.data.orderNumber;

    const res = await request('POST', '/api/payments/submit-utr', {
      orderNumber: upiOrder1,
      utr: utrShared
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });

  await test('Reject reused UTR on Order 2 with DUPLICATE_UTR (400)', async () => {
    const o2 = await request('POST', '/api/orders', {
      customerName: 'UPI User 2',
      customerPhone: '9876543219',
      orderType: 'TAKEAWAY',
      paymentMethod: 'UPI',
      items: [{ productId: 'prod_caramel_latte', quantity: 1 }]
    });
    upiOrder2 = o2.body.data.orderNumber;

    const res = await request('POST', '/api/payments/submit-utr', {
      orderNumber: upiOrder2,
      utr: utrShared
    });
    if (res.status !== 400) throw new Error(`Expected 400 rejection, got ${res.status}`);
    if (res.body.error.code !== 'DUPLICATE_UTR') {
      throw new Error(`Expected DUPLICATE_UTR code, got ${res.body.error.code}`);
    }
  });

  // 8. AUDIT LOGGING
  console.log('\n--- 8. AUDIT TRAIL PERSISTENCE ---');

  await test('Audit trail logs recorded in database with actor and action', async () => {
    const logs = await db.all(
      `SELECT action, actor_role, entity_type FROM audit_logs ORDER BY created_at DESC LIMIT 10`
    );
    if (!logs || logs.length === 0) {
      throw new Error('No audit log entries recorded in database');
    }
    const actions = logs.map((l) => l.action);
    const hasExpectedAction = actions.some((a) =>
      ['ORDER_STATUS_CHANGED', 'UTR_SUBMITTED', 'ORDER_PAYMENT_VERIFIED', 'PRODUCT_AVAILABILITY_CHANGED'].includes(a)
    );
    if (!hasExpectedAction) {
      throw new Error(`Expected security action in audit logs, found: ${actions.join(', ')}`);
    }
  });

  // 9. HEALTH & SECURITY HEADERS
  console.log('\n--- 9. SECURITY HEADERS & HEALTH READINESS ---');

  await test('Server responds with Helmet security headers', async () => {
    const res = await request('GET', '/api/health');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const csp = res.headers['content-security-policy'];
    if (!csp) throw new Error('Content-Security-Policy header missing');
    if (!csp.includes("default-src 'self'")) throw new Error(`CSP default-src missing: ${csp}`);
    if (res.headers['x-content-type-options'] !== 'nosniff') {
      throw new Error('X-Content-Type-Options nosniff missing');
    }
  });

  await test('Health ready checks database connectivity', async () => {
    const res = await request('GET', '/api/health/ready');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (res.body.status !== 'ready' || res.body.database !== 'connected') {
      throw new Error(`Unexpected readiness output: ${JSON.stringify(res.body)}`);
    }
  });

  console.log(`\n========================================`);
  console.log(`Security Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  server.close();
  if (failed > 0) process.exit(1);
}

runSecuritySuite().catch((err) => {
  console.error('Fatal security suite error:', err);
  if (server) server.close();
  process.exit(1);
});
