/**
 * Orders Route
 * Zero-trust order validation, idempotent creation, real UPI payload generation,
 * and customer order tracking.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { directUPI, counter, razorpay } = require('../lib/payments');

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

// POST /api/orders - Fast, single-pass, idempotent order creation
router.post('/', async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      orderType,
      tableNumber,
      paymentMethod = 'UPI',
      notes,
      items,
      idempotencyKey
    } = req.body;

    // 0. Idempotency Check: Prevent duplicate orders on network retries or double-clicks
    if (idempotencyKey && typeof idempotencyKey === 'string') {
      const existingOrder = await db.get(
        'SELECT * FROM orders WHERE idempotency_key = ?',
        [idempotencyKey.trim()]
      );

      if (existingOrder) {
        const orderItems = await db.all(
          'SELECT product_name_snapshot AS name, unit_price_snapshot AS unitPrice, quantity, subtotal FROM order_items WHERE order_id = ?',
          [existingOrder.id]
        );

        let upiData = null;
        if (existingOrder.payment_method === 'UPI' && existingOrder.payment_status === 'PAYMENT_PENDING') {
          const directUpiData = await directUPI.createPaymentRequest(existingOrder);
          if (razorpay.isConfigured()) {
            try {
              const rzpData = await razorpay.createPaymentRequest({
                id: existingOrder.id,
                order_number: existingOrder.order_number,
                total: existingOrder.total
              });
              upiData = {
                ...rzpData,
                upiUri: directUpiData.upiUri,
                qrDataUrl: directUpiData.qrDataUrl,
                directUpi: directUpiData
              };
            } catch (e) {
              upiData = directUpiData;
            }
          } else {
            upiData = directUpiData;
          }
        }

        return res.status(200).json({
          success: true,
          data: {
            orderId: existingOrder.id,
            orderNumber: existingOrder.order_number,
            customerName: existingOrder.customer_name,
            orderType: existingOrder.order_type,
            tableNumber: existingOrder.table_number,
            paymentMethod: existingOrder.payment_method,
            paymentStatus: existingOrder.payment_status,
            status: existingOrder.status,
            total: existingOrder.total,
            items: orderItems,
            payment: upiData,
            isIdempotentReplay: true
          }
        });
      }
    }

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
    const normalizedMethod = (paymentMethod || 'UPI').toUpperCase();
    if (normalizedMethod !== 'COUNTER' && normalizedMethod !== 'UPI') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PAYMENT_METHOD', message: 'Payment method must be Pay at Counter or Online UPI.' }
      });
    }

    // 4. Validate Items & Re-calculate Total Server-Side (Zero Trust)
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
            message: `"${product.name}" is sold out. Please update your cart.`
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

    // 5. Generate Sequential Order Number (CAF-1001, CAF-1002...)
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
    const cleanIdempotencyKey = idempotencyKey && typeof idempotencyKey === 'string' ? idempotencyKey.trim() : null;

    // 6. Insert Order & Order Items within a Transaction
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO orders (
          id, order_number, customer_name, customer_phone, order_type,
          table_id, table_number, status, payment_status, payment_method,
          subtotal, tax, discount, total, notes, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEIVED', 'PAYMENT_PENDING', ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
        [
          orderId,
          orderNumber,
          customerName.trim(),
          cleanPhone,
          orderType,
          validTableId,
          validTableNumber,
          normalizedMethod,
          calculatedTotal,
          calculatedTotal,
          cleanNotes,
          cleanIdempotencyKey,
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

      // Record in payments table
      const paymentId = 'payrec_' + crypto.randomUUID();
      await tx.run(
        `INSERT INTO payments (
          id, order_id, provider, amount, currency, status, method, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'INR', 'PENDING', ?, ?, ?)`,
        [
          paymentId,
          orderId,
          normalizedMethod === 'UPI' ? 'DIRECT_UPI' : 'COUNTER',
          calculatedTotal,
          normalizedMethod,
          now,
          now
        ]
      );
    });

    console.log(`🛎️  New Genuine Order Created: ${orderNumber} (${orderType} · ₹${calculatedTotal} · ${normalizedMethod})`);

    // 7. Generate Payment Payload
    let paymentPayload = null;
    if (normalizedMethod === 'UPI') {
      const directUpiPayload = await directUPI.createPaymentRequest({
        id: orderId,
        order_number: orderNumber,
        total: calculatedTotal
      });

      if (razorpay.isConfigured()) {
        try {
          const rzpPayload = await razorpay.createPaymentRequest({
            id: orderId,
            order_number: orderNumber,
            total: calculatedTotal
          });

          await db.run(
            'UPDATE orders SET razorpay_order_id = ? WHERE id = ?',
            [rzpPayload.razorpayOrderId, orderId]
          );

          paymentPayload = {
            ...rzpPayload,
            upiUri: directUpiPayload.upiUri,
            qrDataUrl: directUpiPayload.qrDataUrl,
            directUpi: directUpiPayload
          };
        } catch (rzpErr) {
          console.warn('Razorpay order creation error, falling back to direct UPI:', rzpErr.message);
          paymentPayload = directUpiPayload;
        }
      } else {
        paymentPayload = directUpiPayload;
      }
    } else {
      paymentPayload = await counter.createPaymentRequest({
        id: orderId,
        order_number: orderNumber,
        total: calculatedTotal
      });
    }

    res.status(201).json({
      success: true,
      data: {
        orderId,
        orderNumber,
        customerName: customerName.trim(),
        orderType,
        tableNumber: validTableNumber,
        paymentMethod: normalizedMethod,
        paymentStatus: 'PAYMENT_PENDING',
        status: 'RECEIVED',
        total: calculatedTotal,
        items: validatedItems.map(i => ({
          name: i.nameSnapshot,
          unitPrice: i.priceSnapshot,
          quantity: i.quantity,
          subtotal: i.subtotal
        })),
        payment: paymentPayload
      }
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Something went wrong. Your order was not duplicated. Please try again.'
      }
    });
  }
});

// GET /api/orders/history - Customer Order History (by comma-separated order numbers or phone)
router.get('/history', async (req, res) => {
  try {
    const { orderNumbers, phone } = req.query;

    let orders = [];
    if (orderNumbers) {
      const numbersList = orderNumbers
        .split(',')
        .map(n => n.trim().toUpperCase())
        .filter(n => /^CAF-\d+$/.test(n));

      if (numbersList.length > 0) {
        orders = await db.all(
          `SELECT id, order_number, customer_name, order_type, table_number,
                  status, payment_status, payment_method, total, created_at
           FROM orders
           WHERE order_number IN (${numbersList.map(() => '?').join(',')})
           ORDER BY created_at DESC, order_number DESC
           LIMIT 20`,
          numbersList
        );
      }
    } else if (phone) {
      const cleanPhone = phone.toString().replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        orders = await db.all(
          `SELECT id, order_number, customer_name, order_type, table_number,
                  status, payment_status, payment_method, total, created_at
           FROM orders
           WHERE customer_phone = ?
           ORDER BY created_at DESC, order_number DESC
           LIMIT 20`,
          [cleanPhone]
        );
      }
    }

    res.json({
      success: true,
      data: orders
    });
  } catch (err) {
    console.error('Error fetching customer history:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch order history.' }
    });
  }
});

// GET /api/orders/:orderNumber - Customer Live Order Tracking
router.get('/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const order = await db.get(
      `SELECT id, order_number, customer_name, order_type, table_number,
              status, payment_status, payment_method, subtotal, total, notes,
              customer_utr, razorpay_order_id, created_at
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

    // Attach UPI / Razorpay payment instructions & QR if pending
    let paymentDetails = null;
    if (order.payment_method === 'UPI') {
      const directUpiPayload = await directUPI.createPaymentRequest(order);
      paymentDetails = { ...directUpiPayload };

      if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        try {
          let rzpOrderId = order.razorpay_order_id;
          if (!rzpOrderId && order.payment_status !== 'PAID') {
            const rzp = await razorpay.createPaymentRequest(order);
            rzpOrderId = rzp.razorpayOrderId;
            await db.run('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [rzpOrderId, order.id]);
          }
          if (rzpOrderId) {
            paymentDetails.provider = 'RAZORPAY';
            paymentDetails.razorpayOrderId = rzpOrderId;
            paymentDetails.razorpayKeyId = process.env.RAZORPAY_KEY_ID;
            paymentDetails.amountInPaise = Math.round(order.total * 100);
            paymentDetails.currency = 'INR';
          }
        } catch (e) {
          console.warn('Could not attach Razorpay details to order fetch:', e.message);
        }
      }
    }

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
        customerUtr: order.customer_utr,
        createdAt: order.created_at,
        items,
        payment: paymentDetails
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
