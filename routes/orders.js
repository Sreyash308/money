/**
 * Orders Route
 * Zero-trust order validation, creation, and customer tracking.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');

// POST /api/orders/validate - Pre-checkout validation of cart items
router.post('/validate', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'EMPTY_CART', message: 'Cart cannot be empty.' }
      });
    }

    let calculatedSubtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const { productId, quantity } = item;
      const qty = parseInt(quantity, 10);
      if (isNaN(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: `Invalid quantity for item: ${productId}` }
        });
      }

      const product = await db.get(
        'SELECT id, name, price, available, active FROM products WHERE id = ? AND active = 1',
        [productId]
      );

      if (!product) {
        return res.status(400).json({
          success: false,
          error: { code: 'PRODUCT_NOT_FOUND', message: `Product ${productId} is no longer on the menu.` }
        });
      }

      if (product.available !== 1) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PRODUCT_UNAVAILABLE',
            message: `"${product.name}" is currently sold out or unavailable.`
          }
        });
      }

      const itemSubtotal = product.price * qty;
      calculatedSubtotal += itemSubtotal;

      validatedItems.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity: qty,
        subtotal: itemSubtotal
      });
    }

    res.json({
      success: true,
      data: {
        items: validatedItems,
        subtotal: calculatedSubtotal,
        total: calculatedSubtotal
      }
    });
  } catch (err) {
    console.error('Error validating cart:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to validate cart.' }
    });
  }
});

// POST /api/orders - Create new restaurant order with strict server validation
router.post('/', async (req, res) => {
  try {
    const { customerName, customerPhone, orderType, tableNumber, paymentMethod, notes, items } = req.body;

    // 1. Validate Customer Details
    if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_NAME', message: 'Please provide a valid name.' }
      });
    }

    const cleanPhone = (customerPhone || '').toString().replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PHONE', message: 'Please enter a valid 10-digit Indian mobile number.' }
      });
    }

    // 2. Validate Order Type & Table
    if (orderType !== 'DINE_IN' && orderType !== 'TAKEAWAY') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ORDER_TYPE', message: 'Order type must be Dine In or Takeaway.' }
      });
    }

    let validTableId = null;
    let validTableNumber = null;

    if (orderType === 'DINE_IN') {
      const parsedTable = parseInt(tableNumber, 10);
      if (isNaN(parsedTable) || parsedTable < 1) {
        return res.status(400).json({
          success: false,
          error: { code: 'TABLE_REQUIRED', message: 'Please select a valid table for dine-in.' }
        });
      }

      const tableRow = await db.get(
        'SELECT id, table_number FROM restaurant_tables WHERE table_number = ? AND active = 1',
        [parsedTable]
      );

      if (!tableRow) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_TABLE', message: `Table ${parsedTable} is not available.` }
        });
      }

      validTableId = tableRow.id;
      validTableNumber = tableRow.table_number;
    }

    // 3. Validate Payment Method
    if (paymentMethod !== 'COUNTER' && paymentMethod !== 'UPI') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PAYMENT_METHOD', message: 'Payment method must be Counter or UPI.' }
      });
    }

    // 4. Validate Items & Re-calculate Total Server-Side
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ITEMS', message: 'Order must contain between 1 and 30 items.' }
      });
    }

    let calculatedTotal = 0;
    const validatedItems = [];

    for (const itm of items) {
      const qty = parseInt(itm.quantity, 10);
      if (isNaN(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'Quantity must be between 1 and 20.' }
        });
      }

      const product = await db.get(
        'SELECT id, name, price, available, active FROM products WHERE id = ? AND active = 1',
        [itm.productId]
      );

      if (!product) {
        return res.status(400).json({
          success: false,
          error: { code: 'PRODUCT_NOT_FOUND', message: `Product ${itm.productId} not found.` }
        });
      }

      if (product.available !== 1) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PRODUCT_UNAVAILABLE',
            message: `"${product.name}" is no longer available. Please update your cart.`
          }
        });
      }

      const itemSubtotal = product.price * qty;
      calculatedTotal += itemSubtotal;

      validatedItems.push({
        id: crypto.randomUUID(),
        productId: product.id,
        nameSnapshot: product.name,
        priceSnapshot: product.price,
        quantity: qty,
        subtotal: itemSubtotal
      });
    }

    // 5. Generate Unique Order Number (CAF-1001, CAF-1002...)
    const lastOrder = await db.get(
      "SELECT order_number FROM orders WHERE order_number LIKE 'CAF-%' ORDER BY created_at DESC LIMIT 1"
    );
    let nextNum = 1001;
    if (lastOrder && lastOrder.order_number) {
      const match = lastOrder.order_number.match(/^CAF-(\d+)$/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    const orderNumber = `CAF-${nextNum}`;

    const orderId = 'ord_' + crypto.randomUUID();
    const now = new Date().toISOString();

    const cleanNotes = notes && typeof notes === 'string' ? notes.trim().slice(0, 300) : null;

    // 6. Insert Order & Order Items within a Transaction
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO orders (
          id, order_number, customer_name, customer_phone, order_type,
          table_id, table_number, status, payment_status, payment_method,
          subtotal, tax, discount, total, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
        [
          orderId,
          orderNumber,
          customerName.trim(),
          cleanPhone,
          orderType,
          validTableId,
          validTableNumber,
          'RECEIVED',
          'PENDING',
          paymentMethod,
          calculatedTotal,
          calculatedTotal,
          cleanNotes,
          now,
          now
        ]
      );

      for (const itm of validatedItems) {
        await tx.run(
          `INSERT INTO order_items (
            id, order_id, product_id, product_name_snapshot,
            unit_price_snapshot, quantity, subtotal, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            itm.id,
            orderId,
            itm.productId,
            itm.nameSnapshot,
            itm.priceSnapshot,
            itm.quantity,
            itm.subtotal,
            now
          ]
        );
      }
    });

    console.log(`🛎️  New Order Created: ${orderNumber} (${orderType} · ₹${calculatedTotal} · ${paymentMethod})`);

    res.status(201).json({
      success: true,
      data: {
        orderId,
        orderNumber,
        customerName: customerName.trim(),
        orderType,
        tableNumber: validTableNumber,
        paymentMethod,
        paymentStatus: 'PENDING',
        status: 'RECEIVED',
        total: calculatedTotal,
        items: validatedItems.map(i => ({
          name: i.nameSnapshot,
          unitPrice: i.priceSnapshot,
          quantity: i.quantity,
          subtotal: i.subtotal
        }))
      }
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create order.' }
    });
  }
});

// GET /api/orders/:orderNumber - Customer Live Order Tracking
router.get('/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const order = await db.get(
      `SELECT id, order_number, customer_name, order_type, table_number,
              status, payment_status, payment_method, subtotal, total, notes, created_at
       FROM orders
       WHERE order_number = ?`,
      [orderNumber.toUpperCase()]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' }
      });
    }

    const items = await db.all(
      `SELECT product_name_snapshot AS name, unit_price_snapshot AS unitPrice,
              quantity, subtotal
       FROM order_items
       WHERE order_id = ?`,
      [order.id]
    );

    res.json({
      success: true,
      data: {
        orderNumber: order.order_number,
        customerName: order.customer_name,
        orderType: order.order_type,
        tableNumber: order.table_number,
        status: order.status,
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        subtotal: order.subtotal,
        total: order.total,
        notes: order.notes,
        createdAt: order.created_at,
        items
      }
    });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch order details.' }
    });
  }
});

module.exports = router;
