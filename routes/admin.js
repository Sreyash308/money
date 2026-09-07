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
const { requireAdmin } = require('../middleware/auth');

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'super-secret-jwt-key-ochre-coffee-roasters-2026';

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
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    const match = bcrypt.compareSync(password, user.password_hash);
    if (!match) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      data: {
        token,
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
  res.json({
    success: true,
    data: { user: req.adminUser }
  });
});

// POST /api/admin/logout - Logout
router.post('/logout', (req, res) => {
  res.clearCookie('admin_token');
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
      query += ' AND o.status = ?';
      params.push(status);
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

    query += ' ORDER BY o.created_at DESC LIMIT 100';

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
router.patch('/orders/:id/status', requireAdmin, async (req, res) => {
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

    const order = await db.get('SELECT id, order_number, status FROM orders WHERE id = ?', [id]);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' }
      });
    }

    const now = new Date().toISOString();
    await db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [status, now, id]);

    console.log(`📋 Order ${order.order_number} status updated to: ${status}`);

    res.json({
      success: true,
      data: { id, status }
    });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update order status.' }
    });
  }
});

// POST /api/admin/orders/:id/mark-paid - Mark Counter Payment as Paid
router.post('/orders/:id/mark-paid', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const order = await db.get('SELECT id, order_number, payment_status, status FROM orders WHERE id = ?', [id]);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' }
      });
    }

    const now = new Date().toISOString();
    await db.run(
      `UPDATE orders
       SET payment_status = 'PAID',
           status = CASE WHEN status = 'RECEIVED' THEN 'CONFIRMED' ELSE status END,
           updated_at = ?
       WHERE id = ?`,
      [now, id]
    );

    console.log(`💵 Counter payment marked PAID for order: ${order.order_number}`);

    res.json({
      success: true,
      data: { id, paymentStatus: 'PAID' }
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

// POST /api/admin/products - Add New Menu Item
router.post('/products', requireAdmin, async (req, res) => {
  try {
    const { name, description, price, imageUrl, categoryId, isVeg, isCold, originTag } = req.body;

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
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO products (
        id, name, slug, description, price, image_url, category_id,
        is_veg, is_cold, origin_tag, available, active, sort_order,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 99, ?, ?)`,
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
        now,
        now
      ]
    );

    console.log(`🍵 Added new product: ${name} (₹${numPrice})`);

    res.status(201).json({
      success: true,
      data: { id, name, slug, price: numPrice }
    });
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create product.' }
    });
  }
});

// PUT /api/admin/products/:id - Edit Product Details
router.put('/products/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, imageUrl, categoryId, isVeg, isCold, originTag } = req.body;

    const existing = await db.get('SELECT id FROM products WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found.' }
      });
    }

    const numPrice = parseInt(price, 10);
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
           updated_at = ?
       WHERE id = ?`,
      [
        name ? name.trim() : null,
        description !== undefined ? description.trim() : null,
        !isNaN(numPrice) ? numPrice : null,
        imageUrl || null,
        categoryId || null,
        isVeg !== undefined ? (isVeg ? 1 : 0) : null,
        isCold !== undefined ? (isCold ? 1 : 0) : null,
        originTag !== undefined ? originTag : null,
        now,
        id
      ]
    );

    res.json({ success: true, message: 'Product updated successfully.' });
  } catch (err) {
    console.error('Error editing product:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update product.' }
    });
  }
});

// PATCH /api/admin/products/:id/availability - Instant Product Availability Toggle
router.patch('/products/:id/availability', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const product = await db.get('SELECT id, name, available FROM products WHERE id = ?', [id]);

    if (!product) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Product not found.' }
      });
    }

    const newAvailability = product.available === 1 ? 0 : 1;
    const now = new Date().toISOString();

    await db.run('UPDATE products SET available = ?, updated_at = ? WHERE id = ?', [newAvailability, now, id]);

    console.log(`⚡ Instant Availability Toggle: ${product.name} is now ${newAvailability === 1 ? 'AVAILABLE' : 'UNAVAILABLE'}`);

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

// DELETE /api/admin/products/:id - Soft-delete product
router.delete('/products/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const now = new Date().toISOString();
    await db.run('UPDATE products SET active = 0, updated_at = ? WHERE id = ?', [now, id]);
    res.json({ success: true, message: 'Product removed from menu.' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to remove product.' }
    });
  }
});

// GET /api/admin/tables - Manage Restaurant Tables
router.get('/tables', requireAdmin, async (req, res) => {
  try {
    const tables = await db.all('SELECT * FROM restaurant_tables ORDER BY table_number ASC');

    const activeOrders = await db.all(
      `SELECT table_number, order_number, customer_name, total
       FROM orders
       WHERE order_type = 'DINE_IN'
         AND status IN ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY')`
    );

    const activeMap = {};
    for (const ord of activeOrders) {
      if (ord.table_number) activeMap[ord.table_number] = ord;
    }

    const tablesData = tables.map(t => ({
      ...t,
      activeOrder: activeMap[t.table_number] || null
    }));

    res.json({ success: true, data: tablesData });
  } catch (err) {
    console.error('Error fetching tables:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch tables.' }
    });
  }
});

// POST /api/admin/tables - Add a Table
router.post('/tables', requireAdmin, async (req, res) => {
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

    res.status(201).json({ success: true, message: `Table ${num} added.` });
  } catch (err) {
    console.error('Error adding table:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to add table.' }
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
