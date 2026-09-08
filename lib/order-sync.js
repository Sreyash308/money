/**
 * Order Cloud Sync Module for Ochre Coffee Roasters
 * Ensures all orders placed across any Vercel serverless container instance
 * are persistently saved and synchronized across all containers via GitHub cloud authority,
 * preventing orders from vanishing between polls or container restarts.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('../db');

const ORDERS_FILE_PATH = path.join(__dirname, '../data/orders.json');
const TMP_ORDERS_PATH = '/tmp/orders.json';
const GITHUB_REPO = process.env.GITHUB_REPO || 'Sreyash308/money';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

let cachedOrdersData = null;
let cachedOrdersTime = 0;
const CACHE_TTL_MS = 2500; // 2.5 seconds cache TTL

let lastHydrationTime = 0;
const HYDRATION_THROTTLE_MS = 2000; // 2 seconds between DB hydrations per container

/**
 * Helper to make HTTPS requests to GitHub API
 */
function githubApiRequest(method, endpoint, token, data = null) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        'User-Agent': 'Ochre-Coffee-Order-Sync',
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        ...(payload && {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        })
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: parsed });
          } else {
            resolve({ statusCode: res.statusCode, error: parsed });
          }
        } catch (e) {
          resolve({ statusCode: res.statusCode, error: body });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Fetch data/orders.json from GitHub repository API
 */
async function fetchOrdersFromGitHub() {
  if (process.env.NODE_ENV === 'test') return null;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return null;

  try {
    const filePath = 'data/orders.json';
    const res = await githubApiRequest('GET', `/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`, token);
    if (res.statusCode === 200 && res.body && res.body.content) {
      const decoded = Buffer.from(res.body.content, 'base64').toString('utf8');
      const data = JSON.parse(decoded);
      if (data && Array.isArray(data.orders)) {
        return data;
      }
    }
  } catch (err) {
    console.warn('Could not fetch orders from GitHub API:', err.message);
  }
  return null;
}

/**
 * Load cloud orders with memory cache and multi-tier fallbacks
 */
async function loadCloudOrders(force = false) {
  if (db.dbType === 'postgres') {
    return { orders: [], postgres: true };
  }

  if (!force && cachedOrdersData && (Date.now() - cachedOrdersTime < CACHE_TTL_MS)) {
    return cachedOrdersData;
  }

  // 1. Primary Authority in Serverless: Fetch from GitHub cloud
  if (process.env.NODE_ENV !== 'test') {
    const ghData = await fetchOrdersFromGitHub();
    if (ghData) {
      cachedOrdersData = ghData;
      cachedOrdersTime = Date.now();
      saveOrdersToDisk(ghData);
      return ghData;
    }
  }

  // 2. Fallback to /tmp/orders.json
  try {
    if (fs.existsSync(TMP_ORDERS_PATH)) {
      const raw = fs.readFileSync(TMP_ORDERS_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.orders)) {
        cachedOrdersData = parsed;
        cachedOrdersTime = Date.now();
        return parsed;
      }
    }
  } catch (_) {}

  // 3. Fallback to data/orders.json
  try {
    if (fs.existsSync(ORDERS_FILE_PATH)) {
      const raw = fs.readFileSync(ORDERS_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.orders)) {
        cachedOrdersData = parsed;
        cachedOrdersTime = Date.now();
        return parsed;
      }
    }
  } catch (_) {}

  return { orders: [], last_reset_at: null };
}

/**
 * Save orders payload to in-memory cache, /tmp/orders.json, and data/orders.json
 */
function saveOrdersToDisk(data) {
  if (!data) return false;
  cachedOrdersData = data;
  cachedOrdersTime = Date.now();

  try {
    fs.writeFileSync(TMP_ORDERS_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}

  try {
    const dir = path.dirname(ORDERS_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ORDERS_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Commit orders payload directly to GitHub repository
 */
async function syncOrdersToGitHub(data, commitMessage = 'chore(orders): sync live orders state') {
  if (process.env.NODE_ENV === 'test' || db.dbType === 'postgres') {
    return { success: true, skipped: true };
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    return { success: false, reason: 'GITHUB_TOKEN not configured on server' };
  }

  try {
    const filePath = 'data/orders.json';
    const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');

    let sha = null;
    const getRes = await githubApiRequest('GET', `/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`, token);
    if (getRes.statusCode === 200 && getRes.body && getRes.body.sha) {
      sha = getRes.body.sha;
    }

    const putPayload = {
      message: commitMessage,
      content: content,
      branch: GITHUB_BRANCH,
      ...(sha && { sha })
    };

    const putRes = await githubApiRequest('PUT', `/repos/${GITHUB_REPO}/contents/${filePath}`, token, putPayload);

    if (putRes.statusCode === 200 || putRes.statusCode === 201) {
      const commitSha = putRes.body?.commit?.sha || 'synced';
      return {
        success: true,
        sha: commitSha,
        url: putRes.body?.commit?.html_url
      };
    } else {
      console.warn('⚠️ GitHub API orders sync warning:', putRes.statusCode, putRes.error?.message || putRes.error);
      return { success: false, error: putRes.error };
    }
  } catch (err) {
    console.error('Error syncing orders to GitHub:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Hydrate local SQLite DB with orders from cloud authority if missing or outdated.
 * Ensures any newly booted or isolated serverless container has all active orders.
 */
async function ensureOrdersHydrated(force = false) {
  if (db.dbType === 'postgres') return;
  if (process.env.NODE_ENV === 'test' && !force) return;

  const now = Date.now();
  if (!force && (now - lastHydrationTime < HYDRATION_THROTTLE_MS)) {
    return;
  }
  lastHydrationTime = now;

  try {
    const cloud = await loadCloudOrders(force);
    if (!cloud || !Array.isArray(cloud.orders)) return;

    // 1. Handle global cloud reset
    if (cloud.last_reset_at) {
      const resetTime = new Date(cloud.last_reset_at).getTime();
      const localOrders = await db.all('SELECT id, created_at FROM orders');
      for (const ord of localOrders) {
        if (new Date(ord.created_at).getTime() <= resetTime) {
          await db.run('DELETE FROM order_items WHERE order_id = ?', [ord.id]);
          await db.run('DELETE FROM payments WHERE order_id = ?', [ord.id]);
          await db.run('DELETE FROM orders WHERE id = ?', [ord.id]);
        }
      }
    }

    // 2. Hydrate orders from cloud into local SQLite
    for (const ord of cloud.orders) {
      if (!ord || !ord.id) continue;

      const existing = await db.get('SELECT id, status, payment_status, updated_at FROM orders WHERE id = ?', [ord.id]);

      if (!existing) {
        await db.run(
          `INSERT INTO orders (
            id, order_number, customer_name, customer_phone, order_type,
            table_id, table_number, table_numbers, guest_count, status,
            payment_status, payment_method, subtotal, tax, discount, total,
            notes, order_token, idempotency_key, customer_utr, razorpay_order_id,
            razorpay_payment_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ord.id,
            ord.order_number,
            ord.customer_name || 'Guest',
            ord.customer_phone || '9999999999',
            ord.order_type || 'TAKEAWAY',
            ord.table_id || null,
            ord.table_number || null,
            ord.table_numbers || null,
            ord.guest_count || null,
            ord.status || 'RECEIVED',
            ord.payment_status || 'PAYMENT_PENDING',
            ord.payment_method || 'COUNTER',
            ord.subtotal || ord.total || 0,
            ord.tax || 0,
            ord.discount || 0,
            ord.total || 0,
            ord.notes || null,
            ord.order_token || null,
            ord.idempotency_key || null,
            ord.customer_utr || null,
            ord.razorpay_order_id || null,
            ord.razorpay_payment_id || null,
            ord.created_at || new Date().toISOString(),
            ord.updated_at || new Date().toISOString()
          ]
        );

        // Insert items snapshot
        if (Array.isArray(ord.items)) {
          for (const item of ord.items) {
            const itemId = item.id || 'itm_' + Math.random().toString(36).substring(2, 9);
            await db.run(
              `INSERT INTO order_items (id, order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, subtotal, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                itemId,
                ord.id,
                item.productId || item.product_id || null,
                item.name || item.nameSnapshot || item.product_name_snapshot || 'Item',
                item.unitPrice || item.priceSnapshot || item.unit_price_snapshot || 0,
                item.quantity || 1,
                item.subtotal || 0,
                ord.created_at || new Date().toISOString()
              ]
            );
          }
        }

        // Insert payments record if missing
        await db.run(
          `INSERT INTO payments (id, order_id, provider, amount, currency, status, method, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?)`,
          [
            'pay_' + ord.id.replace('ord_', ''),
            ord.id,
            ord.payment_method === 'COUNTER' ? 'COUNTER' : (ord.payment_method === 'RAZORPAY' ? 'RAZORPAY' : 'DIRECT_UPI'),
            ord.total || 0,
            ord.payment_status || 'PAYMENT_PENDING',
            ord.payment_method || 'COUNTER',
            ord.created_at || new Date().toISOString(),
            ord.updated_at || new Date().toISOString()
          ]
        );
      } else {
        // Reconcile status/payment updates if cloud version is newer
        const cloudUpdated = new Date(ord.updated_at || 0).getTime();
        const localUpdated = new Date(existing.updated_at || 0).getTime();

        if (cloudUpdated > localUpdated) {
          await db.run(
            `UPDATE orders
             SET status = ?, payment_status = ?, customer_utr = COALESCE(?, customer_utr),
                 razorpay_payment_id = COALESCE(?, razorpay_payment_id), updated_at = ?
             WHERE id = ?`,
            [ord.status, ord.payment_status, ord.customer_utr || null, ord.razorpay_payment_id || null, ord.updated_at, ord.id]
          );
        }
      }
    }

    // 3. Keep sequence counter synchronized to the highest order number
    let maxOrderNum = 1000;
    if (Array.isArray(cloud.orders)) {
      for (const ord of cloud.orders) {
        if (ord && ord.order_number && ord.order_number.startsWith('CAF-')) {
          const num = parseInt(ord.order_number.replace('CAF-', ''), 10);
          if (!isNaN(num) && num > maxOrderNum) {
            maxOrderNum = num;
          }
        }
      }
    }
    await db.run(
      "UPDATE order_sequences SET current_val = MAX(current_val, ?) WHERE name = 'order_number'",
      [maxOrderNum]
    );
  } catch (err) {
    console.warn('Orders hydration warning:', err.message);
  }
}

/**
 * Sync a single order (new or updated) to cloud persistence
 */
async function syncOrderToCloud(orderRecord, items = []) {
  if (db.dbType === 'postgres' || process.env.NODE_ENV === 'test') {
    return { success: true, skipped: true };
  }

  try {
    const cloud = await loadCloudOrders(true);
    let ordersList = Array.isArray(cloud.orders) ? [...cloud.orders] : [];

    // Fetch full order items if not provided
    let orderItems = items;
    if (!orderItems || orderItems.length === 0) {
      try {
        const rows = await db.all(
          'SELECT product_id, product_name_snapshot, unit_price_snapshot, quantity, subtotal FROM order_items WHERE order_id = ?',
          [orderRecord.id]
        );
        orderItems = rows.map(r => ({
          productId: r.product_id,
          name: r.product_name_snapshot,
          unitPrice: r.unit_price_snapshot,
          quantity: r.quantity,
          subtotal: r.subtotal
        }));
      } catch (_) {}
    }

    const orderPayload = {
      id: orderRecord.id,
      order_number: orderRecord.order_number,
      customer_name: orderRecord.customer_name,
      customer_phone: orderRecord.customer_phone,
      order_type: orderRecord.order_type,
      table_id: orderRecord.table_id || null,
      table_number: orderRecord.table_number || null,
      table_numbers: orderRecord.table_numbers || null,
      guest_count: orderRecord.guest_count || null,
      status: orderRecord.status,
      payment_status: orderRecord.payment_status,
      payment_method: orderRecord.payment_method,
      subtotal: orderRecord.subtotal,
      tax: orderRecord.tax || 0,
      discount: orderRecord.discount || 0,
      total: orderRecord.total,
      notes: orderRecord.notes || null,
      order_token: orderRecord.order_token || null,
      idempotency_key: orderRecord.idempotency_key || null,
      customer_utr: orderRecord.customer_utr || null,
      razorpay_order_id: orderRecord.razorpay_order_id || null,
      razorpay_payment_id: orderRecord.razorpay_payment_id || null,
      created_at: orderRecord.created_at || new Date().toISOString(),
      updated_at: orderRecord.updated_at || new Date().toISOString(),
      items: orderItems
    };

    const idx = ordersList.findIndex(o => o.id === orderRecord.id);
    if (idx >= 0) {
      ordersList[idx] = orderPayload;
    } else {
      ordersList.unshift(orderPayload);
    }

    // Retain most recent 100 orders
    if (ordersList.length > 100) {
      ordersList = ordersList.slice(0, 100);
    }

    const updatedData = {
      updated_at: new Date().toISOString(),
      last_reset_at: cloud.last_reset_at || null,
      orders: ordersList
    };

    saveOrdersToDisk(updatedData);

    const msg = `chore(orders): ${idx >= 0 ? 'update' : 'create'} order ${orderRecord.order_number} (${orderRecord.status})`;
    return await syncOrdersToGitHub(updatedData, msg);
  } catch (err) {
    console.error('Error in syncOrderToCloud:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Purge orders from cloud persistence (triggered by admin reset)
 */
async function purgeOrdersFromCloud() {
  const now = new Date().toISOString();
  const resetData = {
    updated_at: now,
    last_reset_at: now,
    orders: []
  };

  saveOrdersToDisk(resetData);

  if (db.dbType === 'postgres' || process.env.NODE_ENV === 'test') {
    return { success: true, skipped: true };
  }

  return await syncOrdersToGitHub(resetData, 'chore(orders): admin purged order history to start fresh');
}

module.exports = {
  loadCloudOrders,
  ensureOrdersHydrated,
  syncOrderToCloud,
  purgeOrdersFromCloud
};
