/**
 * Order Progression & Table Turnover Test Suite
 * Validates the full flow:
 * 1. Order Placed -> Table Occupied
 * 2. Order Accepted (Payment Confirmed)
 * 3. Food is Preparing
 * 4. Food Cooked & Ready
 * 5. Table Cleaned & Completed -> Table Vacant
 * 6. Quick Table Vacate API
 */

require('dotenv').config();
const http = require('http');

const BASE_URL = 'http://localhost:8000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (bodyStr) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runOrderLifecycleTest() {
  console.log('🔄 Starting Order Lifecycle & Table Turnover Test Suite...');

  // 1. Admin Login
  const loginRes = await request('POST', '/api/admin/login', {
    email: 'owner@ochrecoffee.com',
    password: process.env.ADMIN_PASSWORD || 'ochreAdmin2026!'
  });
  if (loginRes.status !== 200 || !loginRes.body.data?.token) {
    throw new Error(`Admin login failed: ${JSON.stringify(loginRes.body)}`);
  }
  const adminToken = loginRes.body.data.token;
  const authHeaders = { Authorization: `Bearer ${adminToken}` };
  console.log('✅ Admin logged in successfully');

  // 2. Connect to SSE stream (/api/orders/events)
  const orderEvents = [];
  const sseReq = http.get(new URL('/api/orders/events', BASE_URL), (res) => {
    res.on('data', chunk => {
      const text = chunk.toString();
      text.split('\n\n').forEach(part => {
        if (part.startsWith('data: ')) {
          try {
            orderEvents.push(JSON.parse(part.slice(6)));
          } catch (_) {}
        }
      });
    });
  });
  await new Promise(r => setTimeout(r, 200));
  console.log(`✅ Connected to Order SSE Stream (/api/orders/events)`);

  // 3. Check Table 4 initially vacant
  const initialTables = await request('GET', '/api/tables');
  const tbl4Before = initialTables.body.data.find(t => t.tableNumber === 4);
  if (!tbl4Before || tbl4Before.isOccupied) {
    throw new Error(`Expected Table 4 to be vacant initially, got: ${JSON.stringify(tbl4Before)}`);
  }
  console.log('✅ Initial state: Table 4 is VACANT');

  // 4. Guest creates Dine-In order for Table 4
  const createRes = await request('POST', '/api/orders', {
    customerName: 'Aarav Sharma',
    customerPhone: '9876543210',
    orderType: 'DINE_IN',
    tableNumber: 4,
    paymentMethod: 'COUNTER',
    items: [{ productId: 'prod_caramel_latte', quantity: 1 }]
  });

  if (createRes.status !== 201 || !createRes.body.data?.orderNumber) {
    throw new Error(`Failed to create order: ${JSON.stringify(createRes.body)}`);
  }
  const order = createRes.body.data;
  const orderId = order.orderId;
  const orderNumber = order.orderNumber;
  console.log(`✅ Order Placed: ${orderNumber} (Table 4 · Status: ${order.status} · Payment: ${order.paymentStatus})`);

  // 5. Verify Table 4 is now OCCUPIED
  const tablesAfterOrder = await request('GET', '/api/tables');
  const tbl4Occupied = tablesAfterOrder.body.data.find(t => t.tableNumber === 4);
  if (!tbl4Occupied.isOccupied) {
    throw new Error('Table 4 should be OCCUPIED after order creation');
  }
  console.log(`✅ Table Occupancy: Table 4 is now OCCUPIED by order ${tbl4Occupied.activeOrderNumber}`);

  // 6. Step 1: Accept Order & Confirm Payment
  const markPaidRes = await request('POST', `/api/admin/orders/${orderId}/mark-paid`, {}, authHeaders);
  if (markPaidRes.status !== 200 || markPaidRes.body.data?.paymentStatus !== 'PAID') {
    throw new Error(`Failed to mark order paid: ${JSON.stringify(markPaidRes.body)}`);
  }

  const trackStep1 = await request('GET', `/api/orders/${orderNumber}`, null, { 'x-order-token': order.orderToken });
  if (trackStep1.body.data.status !== 'CONFIRMED' || trackStep1.body.data.paymentStatus !== 'PAID') {
    throw new Error(`Order should be CONFIRMED (Accepted) and PAID, got: ${JSON.stringify(trackStep1.body.data)}`);
  }
  console.log(`✅ Step 1: Order Accepted & Payment Confirmed (Status: ${trackStep1.body.data.status}, Label: "${trackStep1.body.data.statusLabel}")`);

  // 7. Step 2: Food is Preparing (In Kitchen)
  const prepRes = await request('PATCH', `/api/admin/orders/${orderId}/status`, { status: 'PREPARING' }, authHeaders);
  if (prepRes.status !== 200 || prepRes.body.data?.status !== 'PREPARING') {
    throw new Error(`Failed to update to PREPARING: ${JSON.stringify(prepRes.body)}`);
  }

  const trackStep2 = await request('GET', `/api/orders/${orderNumber}`, null, { 'x-order-token': order.orderToken });
  if (trackStep2.body.data.status !== 'PREPARING') {
    throw new Error(`Expected PREPARING status, got: ${trackStep2.body.data.status}`);
  }
  console.log(`✅ Step 2: Food is Preparing (Status: ${trackStep2.body.data.status}, Label: "${trackStep2.body.data.statusLabel}")`);

  // 8. Step 3: Food Cooked & Ready
  const readyRes = await request('PATCH', `/api/admin/orders/${orderId}/status`, { status: 'READY' }, authHeaders);
  if (readyRes.status !== 200 || readyRes.body.data?.status !== 'READY') {
    throw new Error(`Failed to update to READY: ${JSON.stringify(readyRes.body)}`);
  }

  const trackStep3 = await request('GET', `/api/orders/${orderNumber}`, null, { 'x-order-token': order.orderToken });
  if (trackStep3.body.data.status !== 'READY') {
    throw new Error(`Expected READY status, got: ${trackStep3.body.data.status}`);
  }
  console.log(`✅ Step 3: Food Cooked & Ready (Status: ${trackStep3.body.data.status}, Label: "${trackStep3.body.data.statusLabel}")`);

  // 9. Step 4: Table Cleaned & Order Completed -> Table becomes VACANT
  const completeRes = await request('PATCH', `/api/admin/orders/${orderId}/status`, { status: 'COMPLETED' }, authHeaders);
  if (completeRes.status !== 200 || completeRes.body.data?.status !== 'COMPLETED') {
    throw new Error(`Failed to update to COMPLETED: ${JSON.stringify(completeRes.body)}`);
  }

  const trackStep4 = await request('GET', `/api/orders/${orderNumber}`, null, { 'x-order-token': order.orderToken });
  if (trackStep4.body.data.status !== 'COMPLETED' || !trackStep4.body.data.isTableVacant) {
    throw new Error(`Expected COMPLETED and isTableVacant true, got: ${JSON.stringify(trackStep4.body.data)}`);
  }
  console.log(`✅ Step 4: Table Cleaned & Completed (Status: ${trackStep4.body.data.status}, Label: "${trackStep4.body.data.statusLabel}")`);

  // 10. Verify Table 4 is now VACANT for next guest
  const tablesAfterComplete = await request('GET', '/api/tables');
  const tbl4After = tablesAfterComplete.body.data.find(t => t.tableNumber === 4);
  if (tbl4After.isOccupied) {
    throw new Error(`Table 4 should be VACANT after completion, but isOccupied is true`);
  }
  console.log('✅ Table Turnover: Table 4 is confirmed VACANT & ready for next guest');

  // 11. Test Quick Vacate API (/api/admin/tables/:tableNumber/vacate)
  const order2Res = await request('POST', '/api/orders', {
    customerName: 'Priya Patel',
    customerPhone: '9876543211',
    orderType: 'DINE_IN',
    tableNumber: 5,
    paymentMethod: 'COUNTER',
    items: [{ productId: 'prod_vanilla_cinnamon_latte', quantity: 1 }]
  });
  const vacateRes = await request('POST', '/api/admin/tables/5/vacate', {}, authHeaders);
  if (vacateRes.status !== 200 || !vacateRes.body.success) {
    throw new Error(`Vacate table API failed: ${JSON.stringify(vacateRes.body)}`);
  }
  const tablesAfterVacate = await request('GET', '/api/tables');
  const tbl5 = tablesAfterVacate.body.data.find(t => t.tableNumber === 5);
  if (tbl5.isOccupied) {
    throw new Error('Table 5 should be vacant after vacate API');
  }
  console.log('✅ Quick Vacate API: Table 5 cleaned and active order completed successfully');

  // Terminate SSE
  sseReq.destroy();

  console.log('\n========================================');
  console.log('🎉 ALL ORDER LIFECYCLE & TABLE TURNOVER TESTS PASSED!');
  console.log('========================================\n');
}

runOrderLifecycleTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
