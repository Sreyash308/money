/**
 * Real-Time Sync & Sold-Out Option Test Suite
 * Tests SSE broadcast, admin price update sync, sold-out toggling, and order rejection for sold-out items.
 */

require('dotenv').config();
const http = require('http');

const BASE_URL = 'http://localhost:8000';

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
  });
}

function post(path, body = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = JSON.stringify(body);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function put(path, body = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = JSON.stringify(body);
    const req = http.request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function patch(path, body = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = JSON.stringify(body);
    const req = http.request(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function runRealtimeSyncTest() {
  console.log('⚡ Starting Real-Time Sync & Sold Out Test Suite...');

  // 1. Test initial version endpoint
  const v1Res = await get('/api/menu/version');
  if (!v1Res.body.success || !v1Res.body.data.version) {
    throw new Error('GET /api/menu/version failed');
  }
  const v1 = v1Res.body.data.version;
  console.log(`✅ Initial menu version: ${v1}`);

  // 2. Connect to SSE stream
  const sseEvents = [];
  const sseReq = http.get(new URL('/api/menu/events', BASE_URL), (res) => {
    res.on('data', chunk => {
      const text = chunk.toString();
      text.split('\n\n').forEach(part => {
        if (part.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(part.slice(6));
            sseEvents.push(parsed);
          } catch (_) {}
        }
      });
    });
  });

  // Give SSE client 200ms to register
  await new Promise(r => setTimeout(r, 200));
  console.log(`✅ Connected to SSE stream (/api/menu/events), initial events: ${sseEvents.length}`);

  // 3. Admin Login
  const loginRes = await post('/api/admin/login', {
    email: 'owner@ochrecoffee.com',
    password: process.env.ADMIN_PASSWORD || 'OchreCoffee#2026Secure'
  });
  if (!loginRes.body.success || !loginRes.body.data.token) {
    throw new Error(`Admin login failed: ${JSON.stringify(loginRes.body)}`);
  }
  const adminToken = loginRes.body.data.token;
  const authHeaders = { Authorization: `Bearer ${adminToken}` };
  console.log('✅ Admin authenticated via JWT');

  // 4. Update Product Price (e.g. prod_caramel_latte to 225)
  const updatePriceRes = await put('/api/admin/products/prod_caramel_latte', {
    name: 'Caramel Latte',
    price: 225,
    description: 'Chikmagalur espresso, amber caramel, velvety milk'
  }, authHeaders);
  if (!updatePriceRes.body.success) {
    throw new Error(`Failed to update price: ${JSON.stringify(updatePriceRes.body)}`);
  }
  console.log('✅ Updated Caramel Latte price to ₹225');

  // Wait for SSE broadcast
  await new Promise(r => setTimeout(r, 200));
  const v2Res = await get('/api/menu/version');
  const v2 = v2Res.body.data.version;
  if (v2 <= v1) throw new Error(`Version did not advance after price update: ${v2} vs ${v1}`);
  console.log(`✅ Version advanced after price update: ${v1} -> ${v2}`);

  const priceEvent = sseEvents.find(e => e.type === 'MENU_UPDATE' && e.change && e.change.productId === 'prod_caramel_latte');
  if (!priceEvent) throw new Error('SSE did not receive price update event');
  console.log('✅ SSE successfully received real-time price update event:', priceEvent.change);

  // 5. Mark Product as Sold Out (available = 0)
  const soldOutRes = await patch('/api/admin/products/prod_caramel_latte/availability', {
    available: 0
  }, authHeaders);
  if (!soldOutRes.body.success) {
    throw new Error(`Failed to mark sold out: ${JSON.stringify(soldOutRes.body)}`);
  }
  console.log('✅ Marked Caramel Latte as SOLD OUT (available: 0)');

  await new Promise(r => setTimeout(r, 200));
  const v3Res = await get('/api/menu/version');
  const v3 = v3Res.body.data.version;
  if (v3 <= v2) throw new Error(`Version did not advance after sold out toggle: ${v3} vs ${v2}`);
  console.log(`✅ Version advanced after sold out toggle: ${v2} -> ${v3}`);

  const soldOutEvent = sseEvents.find(e => e.type === 'MENU_UPDATE' && e.change && (e.change.available === 0 || e.change.available === false));
  if (!soldOutEvent) throw new Error('SSE did not receive sold-out event');
  console.log('✅ SSE successfully received real-time sold-out event:', soldOutEvent.change);

  // 6. Test that Customer Order creation rejects sold-out item
  const orderWithSoldOut = await post('/api/orders', {
    customerName: 'Test Sold Out User',
    customerPhone: '9876543210',
    orderType: 'TAKEAWAY',
    paymentMethod: 'COUNTER',
    items: [
      { id: 'prod_caramel_latte', quantity: 1 }
    ]
  });

  if (orderWithSoldOut.status !== 400 || orderWithSoldOut.body.error?.code !== 'PRODUCT_UNAVAILABLE') {
    throw new Error(`Server failed to reject sold out item: Status ${orderWithSoldOut.status}, body: ${JSON.stringify(orderWithSoldOut.body)}`);
  }
  console.log('✅ Server correctly rejected order containing sold-out item with PRODUCT_UNAVAILABLE');

  // 7. Restore product to In Stock (available = 1) and original price (189)
  await patch('/api/admin/products/prod_caramel_latte/availability', {
    available: 1
  }, authHeaders);
  await put('/api/admin/products/prod_caramel_latte', {
    name: 'Caramel Latte',
    price: 189,
    description: 'Chikmagalur single-origin double shot espresso, handcrafted amber caramel reduction, velvety textured milk.'
  }, authHeaders);
  console.log('✅ Restored Caramel Latte to IN STOCK at ₹189');

  // Terminate SSE connection
  sseReq.destroy();

  console.log('\n========================================');
  console.log('🎉 ALL REAL-TIME SYNC & SOLD-OUT TESTS PASSED!');
  console.log('========================================\n');
}

runRealtimeSyncTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
