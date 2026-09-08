/**
 * Admin API Routes
 * Secure authentication, live orders queue, menu item editor,
 * instant availability toggle, tables management, and operational analytics.
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db');
const {
  requireAdmin,
  requireOwner,
  requireRole,
  getJwtSecret,
  generateCsrfToken,
  verifyCsrfToken,
  JWT_ISSUER,
  JWT_AUDIENCE
} = require('../middleware/auth');
const { notifyMenuChange } = require('./menu');
const { notifyOrderChange } = require('./orders');
const { exportAndSyncCatalog } = require('../lib/catalog-sync');

// POST /api/admin/login - Admin Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'CREDENTIALS_REQUIRED', message: 'Email and password are required.' }
      });
    }

    const user = await db.get('SELECT * FROM admin_users WHERE email = ?', [email.trim().toLowerCase()]);
    if (!user) {
      // Timing-safe dummy compare to mitigate user enumeration through response timing
      bcrypt.compareSync(password, '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUUabcdefghijk');
      await db.logAuditEvent({
        actorId: 'anonymous',
        actorRole: 'unknown',
        action: 'ADMIN_LOGIN_FAILED',
        entityType: 'admin_user',
        details: { email: email.trim().toLowerCase(), reason: 'USER_NOT_FOUND' },
        ipAddress: req.ip
      });
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    const match = bcrypt.compareSync(password, user.password_hash);
    if (!match) {
      await db.logAuditEvent({
        actorId: user.id,
        actorRole: user.role,
        action: 'ADMIN_LOGIN_FAILED',
        entityType: 'admin_user',
        entityId: user.id,
        details: { email: user.email, reason: 'BAD_PASSWORD' },
        ipAddress: req.ip
      });
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      getJwtSecret(),
      { algorithm: 'HS256', expiresIn: '7d', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );

    const csrfToken = generateCsrfToken();

    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.cookie('ochre_csrf', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    await db.logAuditEvent({
      actorId: user.id,
      actorRole: user.role,
      action: 'ADMIN_LOGIN',
      entityType: 'admin_user',
      entityId: user.id,
      details: { email: user.email, role: user.role },
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: {
        token,
        csrfToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        }
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Authentication error.' }
    });
  }
});

// GET /api/admin/me - Verify active admin session
router.get('/me', requireAdmin, async (req, res) => {
  let csrfToken = req.cookies ? req.cookies.ochre_csrf : null;
  if (!csrfToken) {
    csrfToken = generateCsrfToken();
    res.cookie('ochre_csrf', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  const token = req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : (req.cookies && req.cookies.admin_token ? req.cookies.admin_token : null);

  res.json({
    success: true,
    data: {
      user: req.adminUser,
      token,
      csrfToken
    }
  });
});

// POST /api/admin/logout - Logout
router.post('/logout', requireAdmin, async (req, res) => {
  await db.logAuditEvent({
    actorId: req.adminUser ? req.adminUser.id : 'unknown',
    actorRole: req.adminUser ? req.adminUser.role : 'unknown',
    action: 'ADMIN_LOGOUT',
    entityType: 'admin_user',
    entityId: req.adminUser ? req.adminUser.id : null,
    ipAddress: req.ip
  });
  res.clearCookie('admin_token', { path: '/' });
  res.clearCookie('ochre_csrf', { path: '/' });
  res.json({ success: true, message: 'Logged out successfully.' });
});


// GET /api/admin/orders - Live Orders list with filters
router.get('/orders', requireAdmin, async (req, res) => {
  try {
    const { status, paymentStatus, orderType, search } = req.query;

    let query = `
      SELECT o.*, t.label AS table_label
      FROM orders o
      LEFT JOIN restaurant_tables t ON o.table_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'ALL') {
      if (status === 'RECEIVED_OR_CONFIRMED') {
        query += " AND o.status IN ('RECEIVED', 'CONFIRMED')";
      } else {
        query += ' AND o.status = ?';
        params.push(status);
      }
    }

    if (paymentStatus && paymentStatus !== 'ALL') {
      query += ' AND o.payment_status = ?';
      params.push(paymentStatus);
    }

    if (orderType && orderType !== 'ALL') {
      query += ' AND o.order_type = ?';
      params.push(orderType);
    }

    if (search) {
      query += ' AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY o.created_at DESC, o.id DESC LIMIT 100';

    const orders = await db.all(query, params);

    // Fetch items for all returned orders
    const orderIds = orders.map(o => o.id);
    let itemsMap = {};

    if (orderIds.length > 0) {
      const allItems = await db.all(
        `SELECT order_id, product_name_snapshot, unit_price_snapshot, quantity, subtotal
         FROM order_items
         WHERE order_id IN (${orderIds.map(() => '?').join(',')})`,
        orderIds
      );

      for (const item of allItems) {
        if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
        itemsMap[item.order_id].push({
          name: item.product_name_snapshot,
          unitPrice: item.unit_price_snapshot,
          quantity: item.quantity,
          subtotal: item.subtotal
        });
      }
    }

    const enrichedOrders = orders.map(ord => ({
      ...ord,
      items: itemsMap[ord.id] || []
    }));

    res.json({
      success: true,
      data: enrichedOrders
    });
  } catch (err) {
    console.error('Error fetching admin orders:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch orders.' }
    });
  }
});

// PATCH /api/admin/orders/:id/status - Update Order Status
router.patch('/orders/:id/status', requireAdmin, verifyCsrfToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['RECEIVED', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Invalid order status.' }
      });
    }

    const order = await db.get('SELECT id, order_number, status, table_number, table_numbers, guest_count, order_type, payment_status, total FROM orders WHERE id = ?', [id]);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' }
      });
    }

    // Explicit Order Status State Machine (Disallow backward/illegal transitions)
    const legalTransitions = {
      'RECEIVED': ['CONFIRMED', 'CANCELLED'],
      'CONFIRMED': ['PREPARING', 'READY', 'CANCELLED'],
      'PREPARING': ['READY', 'CANCELLED'],
      'READY': ['COMPLETED', 'CANCELLED'],
      'COMPLETED': [],
      'CANCELLED': []
    };

    const allowedNext = legalTransitions[order.status] || [];
    if (!allowedNext.includes(status) && order.status !== status) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ILLEGAL_TRANSITION',
          message: `Cannot transition order ${order.order_number} from "${order.status}" to "${status}".`
        }
      });
    }

    const now = new Date().toISOString();
    await db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [status, now, id]);

    if (status === 'COMPLETED') {
      console.log(`🧹 Table ${order.table_numbers || (order.table_number ? '#' + order.table_number : 'N/A')} cleaned & order ${order.order_number} completed. Table is now VACANT.`);
    } else {
      console.log(`📋 Order ${order.order_number} status updated to: ${status}`);
    }

    await db.logAuditEvent({
      actorId: req.adminUser.id,
      actorRole: req.adminUser.role,
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'order',
      entityId: id,
      details: { orderNumber: order.order_number, from: order.status, to: status },
      ipAddress: req.ip
    });

    notifyOrderChange({
      action: 'STATUS_UPDATED',
      orderId: id,
      orderNumber: order.order_number,
      status,
      previousStatus: order.status,
      paymentStatus: order.payment_status,
      tableNumber: order.table_number,
      tableNumbers: order.table_numbers,
      guestCount: order.guest_count,
      orderType: order.order_type,
      isTableVacant: status === 'COMPLETED' || status === 'CANCELLED'
    });

    res.json({
      success: true,
      data: { id, status, isTableVacant: status === 'COMPLETED' || status === 'CANCELLED' }
    });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update order status.' }
    });
  }
});

// POST /api/admin/orders/:id/mark-paid - Mark Counter/UPI Payment as Paid & Accept Order
router.post('/orders/:id/mark-paid', requireAdmin, verifyCsrfToken, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await db.get('SELECT id, order_number, payment_status, payment_method, status, table_number, table_numbers, guest_count, order_type, total FROM orders WHERE id = ?', [id]);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' }
      });
    }

    if (order.payment_status === 'PAID') {
      return res.status(200).json({
        success: true,
        data: { id, paymentStatus: 'PAID', status: order.status, message: 'Payment already recorded as PAID.' }
      });
    }

    const now = new Date().toISOString();
    const newStatus = order.status === 'RECEIVED' ? 'CONFIRMED' : order.status;

    await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE orders
         SET payment_status = 'PAID',
             status = ?,
             updated_at = ?
         WHERE id = ?`,
        [newStatus, now, id]
      );

      await tx.run(
        `UPDATE payments
         SET status = 'PAID',
             updated_at = ?
         WHERE order_id = ?`,
        [now, id]
      );
    });

    console.log(`💵 Payment (${order.payment_method}) marked PAID & accepted for order: ${order.order_number}`);

    await db.logAuditEvent({
      actorId: req.adminUser.id,
      actorRole: req.adminUser.role,
      action: 'ORDER_PAYMENT_VERIFIED',
      entityType: 'order',
      entityId: id,
      details: { orderNumber: order.order_number, method: order.payment_method, amount: order.total },
      ipAddress: req.ip
    });

    notifyOrderChange({
      action: 'PAID_AND_ACCEPTED',
      orderId: id,
      orderNumber: order.order_number,
      status: newStatus,
      paymentStatus: 'PAID',
      tableNumber: order.table_number,
      tableNumbers: order.table_numbers,
      guestCount: order.guest_count,
      orderType: order.order_type
    });

    res.json({
      success: true,
      data: { id, paymentStatus: 'PAID', status: newStatus }
    });
  } catch (err) {
    console.error('Error marking payment paid:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update payment status.' }
    });
  }
});

// GET /api/admin/products - Manage Menu Catalog
router.get('/products', requireAdmin, async (req, res) => {
  try {
    const products = await db.all(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.active = 1
       ORDER BY p.sort_order ASC, p.created_at DESC`
    );

    const categories = await db.all('SELECT id, name FROM categories WHERE active = 1 ORDER BY sort_order ASC');

    res.json({
      success: true,
      data: { products, categories }
    });
  } catch (err) {
    console.error('Error fetching admin products:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch products.' }
    });
  }
});

// POST /api/admin/products - Add New Menu Item (Owner only)
router.post('/products', requireOwner, verifyCsrfToken, async (req, res) => {
  try {
    const { name, description, price, imageUrl, categoryId, isVeg, isCold, originTag, available } = req.body;

    if (!name || !price || !categoryId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Name, price, and category are required.' }
      });
    }

    const numPrice = parseInt(price, 10);
    if (isNaN(numPrice) || numPrice < 1) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PRICE', message: 'Price must be a positive integer.' }
      });
    }

    const id = 'prod_' + crypto.randomUUID().slice(0, 8);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + id.slice(-4);
    const isAvail = available !== undefined ? (available ? 1 : 0) : 1;
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO products (
        id, name, slug, description, price, image_url, category_id,
        is_veg, is_cold, origin_tag, available, active, sort_order,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 99, ?, ?)`,
      [
        id,
        name.trim(),
        slug,
        description ? description.trim() : '',
        numPrice,
        imageUrl || 'assets/coffee_mug.png',
        categoryId,
        isVeg ? 1 : 0,
        isCold ? 1 : 0,
        originTag ? originTag.trim() : null,
        isAvail,
        now,
        now
      ]
    );

    console.log(`🍵 Added new product: ${name} (₹${numPrice}, inStock: ${isAvail === 1})`);

    await db.logAuditEvent({
      actorId: req.adminUser.id,
      actorRole: req.adminUser.role,
      action: 'PRODUCT_CREATED',
      entityType: 'product',
      entityId: id,
      details: { name, price: numPrice },
      ipAddress: req.ip
    });

    // Broadcast instant real-time sync event
    notifyMenuChange({ action: 'CREATE', productId: id, name, price: numPrice, available: isAvail === 1 });

    exportAndSyncCatalog({ commitMessage: `chore(menu): admin created product ${name} (₹${numPrice})` }).catch(err => {
      console.warn('Background git sync on create:', err.message);
    });

    res.status(201).json({
      success: true,
      data: { id, name, slug, price: numPrice, available: isAvail === 1 }
    });
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create product.' }
    });
  }
});

// PUT /api/admin/products/:id - Edit Product Details (Owner only)
router.put('/products/:id', requireOwner, verifyCsrfToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, imageUrl, categoryId, isVeg, isCold, originTag, available } = req.body;

    const existing = await db.get('SELECT id, name, price, available FROM products WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found.' }
      });
    }

    const numPrice = price !== undefined ? parseInt(price, 10) : null;
    const isAvail = available !== undefined ? (available ? 1 : 0) : null;
    const now = new Date().toISOString();

    await db.run(
      `UPDATE products
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           price = COALESCE(?, price),
           image_url = COALESCE(?, image_url),
           category_id = COALESCE(?, category_id),
           is_veg = COALESCE(?, is_veg),
           is_cold = COALESCE(?, is_cold),
           origin_tag = COALESCE(?, origin_tag),
           available = COALESCE(?, available),
           updated_at = ?
       WHERE id = ?`,
      [
        name ? name.trim() : null,
        description !== undefined ? description.trim() : null,
        !isNaN(numPrice) && numPrice !== null ? numPrice : null,
        imageUrl || null,
        categoryId || null,
        isVeg !== undefined ? (isVeg ? 1 : 0) : null,
        isCold !== undefined ? (isCold ? 1 : 0) : null,
        originTag !== undefined ? originTag : null,
        isAvail,
        now,
        id
      ]
    );

    console.log(`✏️ Updated product: ${name || existing.name} (price: ${numPrice || existing.price}, stock: ${isAvail !== null ? isAvail : existing.available})`);

    await db.logAuditEvent({
      actorId: req.adminUser.id,
      actorRole: req.adminUser.role,
      action: 'PRODUCT_UPDATED',
      entityType: 'product',
      entityId: id,
      details: { name: name || existing.name, price: numPrice || existing.price },
      ipAddress: req.ip
    });

    // Broadcast instant real-time sync event
    notifyMenuChange({ action: 'UPDATE', productId: id, name: name || existing.name, price: numPrice || existing.price, available: isAvail !== null ? isAvail === 1 : existing.available === 1 });

    exportAndSyncCatalog({ commitMessage: `chore(menu): admin updated ${name || existing.name} (price: ₹${numPrice || existing.price})` }).catch(err => {
      console.warn('Background git sync on update:', err.message);
    });

    res.json({ success: true, message: 'Product updated successfully.' });
  } catch (err) {
    console.error('Error editing product:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update product.' }
    });
  }
});

// PATCH /api/admin/products/:id/availability - Instant Product Availability / Sold Out Toggle (Owner only)
router.patch('/products/:id/availability', requireOwner, verifyCsrfToken, async (req, res) => {
  try {
    const { id } = req.params;
    const product = await db.get('SELECT id, name, available FROM products WHERE id = ?', [id]);

    if (!product) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found.' }
      });
    }

    const newAvailability = req.body.available !== undefined 
      ? (req.body.available === 1 || req.body.available === true || req.body.available === '1' ? 1 : 0)
      : (product.available === 1 ? 0 : 1);
    const now = new Date().toISOString();

    await db.run('UPDATE products SET available = ?, updated_at = ? WHERE id = ?', [newAvailability, now, id]);

    console.log(`⚡ Instant Availability Toggle: ${product.name} is now ${newAvailability === 1 ? 'AVAILABLE' : 'UNAVAILABLE'}`);

    await db.logAuditEvent({
      actorId: req.adminUser.id,
      actorRole: req.adminUser.role,
      action: 'PRODUCT_AVAILABILITY_CHANGED',
      entityType: 'product',
      entityId: id,
      details: { name: product.name, available: newAvailability === 1 },
      ipAddress: req.ip
    });

    // Broadcast instant real-time sync event
    notifyMenuChange({ action: 'AVAILABILITY', productId: id, name: product.name, available: newAvailability === 1 });

    exportAndSyncCatalog({ commitMessage: `chore(menu): admin set ${product.name} to ${newAvailability === 1 ? 'available' : 'sold out'}` }).catch(err => {
      console.warn('Background git sync on availability toggle:', err.message);
    });

    res.json({
      success: true,
      data: {
        id,
        name: product.name,
        available: newAvailability === 1
      }
    });
  } catch (err) {
    console.error('Error toggling availability:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update availability.' }
    });
  }
});

// DELETE /api/admin/products/:id - Soft-delete product (Owner only)
router.delete('/products/:id', requireOwner, verifyCsrfToken, async (req, res) => {
  try {
    const { id } = req.params;
    const now = new Date().toISOString();
    await db.run('UPDATE products SET active = 0, updated_at = ? WHERE id = ?', [now, id]);

    await db.logAuditEvent({
      actorId: req.adminUser.id,
      actorRole: req.adminUser.role,
      action: 'PRODUCT_DELETED',
      entityType: 'product',
      entityId: id,
      ipAddress: req.ip
    });

    // Broadcast instant real-time sync event
    notifyMenuChange({ action: 'DELETE', productId: id });

    exportAndSyncCatalog({ commitMessage: `chore(menu): admin removed product ${id}` }).catch(err => {
      console.warn('Background git sync on delete:', err.message);
    });

    res.json({ success: true, message: 'Product removed from menu.' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to remove product.' }
    });
  }
});

// POST /api/admin/sync-git - Manually trigger sync of menu catalog to GitHub
router.post('/sync-git', requireOwner, verifyCsrfToken, async (req, res) => {
  try {
    const result = await exportAndSyncCatalog({ commitMessage: req.body.message || 'chore(menu): manual sync from admin portal' });
    res.json({
      success: true,
      data: {
        lastSyncedAt: result.catalog.last_synced_at,
        productsCount: result.catalog.products.length,
        git: result.git
      }
    });
  } catch (err) {
    console.error('Error syncing to git:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SYNC_ERROR', message: err.message || 'Failed to sync with git repository.' }
    });
  }
});

// GET /api/admin/tables - Manage Restaurant Tables
router.get('/tables', requireAdmin, async (req, res) => {
  try {
    const tables = await db.all('SELECT * FROM restaurant_tables ORDER BY table_number ASC');

    const activeOrders = await db.all(
      `SELECT id, order_number, customer_name, total, table_number, table_numbers, guest_count
       FROM orders
       WHERE order_type = 'DINE_IN'
         AND status IN ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY')`
    );

    const tableOrdersMap = {};
    for (const ord of activeOrders) {
      const nums = [];
      if (ord.table_number) nums.push(ord.table_number);
      if (ord.table_numbers) {
        String(ord.table_numbers).split(',').forEach(s => {
          const n = parseInt(s.trim(), 10);
          if (!isNaN(n) && !nums.includes(n)) nums.push(n);
        });
      }
      for (const n of nums) {
        tableOrdersMap[n] = {
          ...ord,
          isMultiTable: nums.length > 1,
          linkedTables: nums
        };
      }
    }

    const tablesData = tables.map(t => {
      const act = tableOrdersMap[t.table_number] || null;
      let occupiedSeats = 0;
      if (act) {
        occupiedSeats = act.guest_count ? Math.min(act.guest_count, t.capacity) : t.capacity;
      }
      const availableSeats = Math.max(0, t.capacity - occupiedSeats);
      let occupancyStatus = 'FULLY_VACANT';
      if (act) {
        occupancyStatus = (availableSeats === 0 || occupiedSeats >= t.capacity) ? 'OCCUPIED' : 'HALF_OCCUPIED';
      }

      return {
        ...t,
        occupiedSeats,
        availableSeats,
        occupancyStatus,
        isOccupied: occupancyStatus === 'OCCUPIED',
        isHalfOccupied: occupancyStatus === 'HALF_OCCUPIED',
        activeOrder: act
      };
    });

    res.json({ success: true, data: tablesData });
  } catch (err) {
    console.error('Error fetching tables:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch tables.' }
    });
  }
});

// POST /api/admin/tables - Add a Table (Owner only)
router.post('/tables', requireOwner, verifyCsrfToken, async (req, res) => {
  try {
    const { tableNumber, label, capacity } = req.body;
    const num = parseInt(tableNumber, 10);
    const cap = parseInt(capacity, 10) || 4;

    if (isNaN(num) || num < 1) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TABLE_NUMBER', message: 'Valid table number is required.' }
      });
    }

    const existing = await db.get('SELECT id FROM restaurant_tables WHERE table_number = ?', [num]);
    if (existing) {
      return res.status(400).json({
        success: false,
        error: { code: 'TABLE_EXISTS', message: `Table ${num} already exists.` }
      });
    }

    const id = `tbl_${num}`;
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO restaurant_tables (id, table_number, label, capacity, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [id, num, label || `Table ${num < 10 ? '0' + num : num}`, cap, now, now]
    );

    await db.logAuditEvent({
      actorId: req.adminUser.id,
      actorRole: req.adminUser.role,
      action: 'TABLE_CREATED',
      entityType: 'table',
      entityId: id,
      details: { tableNumber: num, capacity: cap },
      ipAddress: req.ip
    });

    res.status(201).json({ success: true, message: `Table ${num} added.` });
  } catch (err) {
    console.error('Error adding table:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to add table.' }
    });
  }
});

// POST /api/admin/tables/:tableNumber/vacate - Clean and vacate table (Admin only)
router.post('/tables/:tableNumber/vacate', requireAdmin, verifyCsrfToken, async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const num = parseInt(tableNumber, 10);
    const now = new Date().toISOString();

    const allActive = await db.all(
      `SELECT id, order_number, table_number, table_numbers FROM orders
       WHERE order_type = 'DINE_IN'
         AND status IN ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY')`
    );

    const affectedOrders = allActive.filter(ord => {
      const nums = [];
      if (ord.table_number) nums.push(ord.table_number);
      if (ord.table_numbers) {
        String(ord.table_numbers).split(',').forEach(s => {
          const n = parseInt(s.trim(), 10);
          if (!isNaN(n)) nums.push(n);
        });
      }
      return nums.includes(num);
    });

    for (const ord of affectedOrders) {
      await db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', ['COMPLETED', now, ord.id]);

      await db.logAuditEvent({
        actorId: req.adminUser.id,
        actorRole: req.adminUser.role,
        action: 'TABLE_VACATED',
        entityType: 'order',
        entityId: ord.id,
        details: { tableNumber: num, orderNumber: ord.order_number },
        ipAddress: req.ip
      });

      notifyOrderChange({
        action: 'STATUS_UPDATED',
        orderId: ord.id,
        orderNumber: ord.order_number,
        status: 'COMPLETED',
        tableNumber: ord.table_number,
        tableNumbers: ord.table_numbers,
        isTableVacant: true
      });
    }

    console.log(`🧹 Table #${num} cleaned & vacated (${affectedOrders.length} active order(s) completed)`);

    res.json({
      success: true,
      message: `Table ${num} cleaned and vacated.`,
      vacatedOrders: affectedOrders.map(o => o.order_number)
    });
  } catch (err) {
    console.error('Error vacating table:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to vacate table.' }
    });
  }
});

// POST /api/admin/orders/reset - Purge order history and reset sequence (Owner only with environment guard)
router.post('/orders/reset', requireOwner, verifyCsrfToken, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_ORDER_RESET !== 'true') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'RESET_FORBIDDEN',
          message: 'Order history reset is disabled in production. Set ALLOW_PRODUCTION_ORDER_RESET=true to authorize.'
        }
      });
    }

    const deletedCounts = {};
    await db.transaction(async (tx) => {
      const oi = await tx.run('DELETE FROM order_items');
      const p = await tx.run('DELETE FROM payments');
      const w = await tx.run('DELETE FROM webhook_events');
      const o = await tx.run('DELETE FROM orders');
      deletedCounts.order_items = oi.changes;
      deletedCounts.payments = p.changes;
      deletedCounts.webhook_events = w.changes;
      deletedCounts.orders = o.changes;

      try {
        await tx.run("UPDATE order_sequences SET current_val = 1000 WHERE name = 'order_number'");
      } catch (seqErr) {}
    });

    if (db.dbType === 'sqlite') {
      try {
        await db.run("DELETE FROM sqlite_sequence WHERE name IN ('orders', 'order_items', 'payments', 'webhook_events')");
      } catch (e) {}
    }

    await db.logAuditEvent({
      actorId: req.adminUser.id,
      actorRole: req.adminUser.role,
      action: 'ORDER_RESET',
      entityType: 'orders',
      details: deletedCounts,
      ipAddress: req.ip
    });

    notifyOrderChange({ action: 'RESET_ORDERS', timestamp: new Date().toISOString() });

    console.log('🧹 Order history reset completed:', deletedCounts);

    res.json({
      success: true,
      message: 'All order history safely purged. Sequence reset to fresh start.',
      deleted: deletedCounts
    });
  } catch (err) {
    console.error('Error resetting order history:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to reset order history.' }
    });
  }
});

// GET /api/admin/stats - Today's Dashboard Metrics
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    // Current date in YYYY-MM-DD format
    const todayStr = new Date().toISOString().slice(0, 10);

    const ordersToday = await db.all(
      'SELECT status, payment_status, total, order_type, payment_method FROM orders WHERE created_at LIKE ?',
      [`${todayStr}%`]
    );

    let totalOrders = ordersToday.length;
    let todayRevenue = 0;
    let pendingCount = 0;
    let confirmedCount = 0;
    let preparingCount = 0;
    let readyCount = 0;
    let completedCount = 0;
    let dineInCount = 0;
    let takeawayCount = 0;
    let upiCount = 0;
    let counterCount = 0;

    for (const ord of ordersToday) {
      if (ord.payment_status === 'PAID') {
        todayRevenue += ord.total;
      }
      if (ord.status === 'RECEIVED') pendingCount++;
      if (ord.status === 'CONFIRMED') confirmedCount++;
      if (ord.status === 'PREPARING') preparingCount++;
      if (ord.status === 'READY') readyCount++;
      if (ord.status === 'COMPLETED') completedCount++;

      if (ord.order_type === 'DINE_IN') dineInCount++;
      else takeawayCount++;

      if (ord.payment_method === 'UPI') upiCount++;
      else counterCount++;
    }

    res.json({
      success: true,
      data: {
        todayOrders: totalOrders,
        todayRevenue,
        pending: pendingCount,
        confirmed: confirmedCount,
        toPrepare: pendingCount + confirmedCount,
        preparing: preparingCount,
        ready: readyCount,
        completed: completedCount,
        dineIn: dineInCount,
        takeaway: takeawayCount,
        upi: upiCount,
        counter: counterCount,
        destinationVpa: process.env.UPI_MERCHANT_VPA || '9182916879@ybl'
      }
    });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to calculate stats.' }
    });
  }
});

module.exports = router;
