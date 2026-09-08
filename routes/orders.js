/**
 * Orders Route
 * Zero-trust order validation, idempotent creation, real UPI payload generation,
 * and customer order tracking.
 */

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db');
const { directUPI, counter, razorpay } = require('../lib/payments');
const { getJwtSecret, JWT_ISSUER, JWT_AUDIENCE } = require('../middleware/auth');

let currentOrderVersion = Date.now();
const sseOrderClients = new Set();

function notifyOrderChange(changeDetails = {}) {
  currentOrderVersion = Date.now();
  // Strip customer PII, customer phone, notes, and payment secrets before broadcasting
  const safeChange = {
    action: changeDetails.action || 'UPDATE',
    orderNumber: changeDetails.orderNumber,
    status: changeDetails.status,
    tableNumber: changeDetails.tableNumber,
    tableNumbers: changeDetails.tableNumbers,
    tableLabel: changeDetails.tableLabel,
    isTableVacant: changeDetails.isTableVacant,
    paymentStatus: changeDetails.paymentStatus,
    timestamp: new Date().toISOString()
  };

  const payload = JSON.stringify({
    type: 'ORDER_UPDATE',
    version: currentOrderVersion,
    timestamp: safeChange.timestamp,
    change: safeChange
  });

  for (const client of sseOrderClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseOrderClients.delete(client);
    }
  }
}


function getStatusLabel(status, paymentStatus) {
  switch (status) {
    case 'RECEIVED':
      return paymentStatus === 'PAID' ? 'Order Accepted & Confirmed' : 'Order Placed (Payment Pending)';
    case 'CONFIRMED':
      return 'Order Accepted (Payment Confirmed)';
    case 'PREPARING':
      return 'Food is Preparing';
    case 'READY':
      return 'Food Cooked & Ready';
    case 'COMPLETED':
      return 'Order Completed (Table Vacated)';
    case 'CANCELLED':
      return 'Order Cancelled';
    default:
      return status;
  }
}

function getStepIndex(status) {
  switch (status) {
    case 'RECEIVED': return 0;
    case 'CONFIRMED': return 1;
    case 'PREPARING': return 2;
    case 'READY': return 3;
    case 'COMPLETED': return 4;
    default: return 0;
  }
}

// GET /api/orders/events - Live Server-Sent Events stream for order status changes & table vacancy
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (res.flushHeaders) res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', version: currentOrderVersion })}\n\n`);
  sseOrderClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch (e) {
      clearInterval(heartbeat);
      sseOrderClients.delete(res);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseOrderClients.delete(res);
  });
});

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
      const productId = item.productId || item.id;
      const { quantity } = item;
      const qty = parseInt(quantity, 10);
      if (!productId || isNaN(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: `Invalid quantity or product for item: ${productId || 'unknown'}` }
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
      tableNumbers,
      guestCount,
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
    let validTableNumbersStr = null;
    let validGuestCount = guestCount ? parseInt(guestCount, 10) : 2;
    if (isNaN(validGuestCount) || validGuestCount < 1) validGuestCount = 2;
    let inputTables = [];

    if (orderType === 'DINE_IN') {
      if (Array.isArray(tableNumbers) && tableNumbers.length > 0) {
        inputTables = tableNumbers.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
      } else if (typeof tableNumbers === 'string' && tableNumbers.trim()) {
        inputTables = tableNumbers.split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
      } else if (tableNumber !== undefined && tableNumber !== null) {
        const parsed = parseInt(tableNumber, 10);
        if (!isNaN(parsed)) inputTables = [parsed];
      }

      // Deduplicate table numbers and sort
      inputTables = Array.from(new Set(inputTables)).sort((a, b) => a - b);

      if (inputTables.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'TABLE_REQUIRED', message: 'Please select at least one dining table for Dine-In.' }
        });
      }

      if (inputTables.length > 5) {
        return res.status(400).json({
          success: false,
          error: { code: 'TOO_MANY_TABLES', message: 'A maximum of 5 tables can be combined per order.' }
        });
      }

      // Verify all tables exist and are active
      let totalCombinedCapacity = 0;
      const verifiedTables = [];
      for (const tNum of inputTables) {
        const tableRow = await db.get(
          'SELECT id, table_number, label, capacity FROM restaurant_tables WHERE table_number = ? AND active = 1',
          [tNum]
        );
        if (!tableRow) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_TABLE', message: `Table #${tNum} is not available.` }
          });
        }
        totalCombinedCapacity += tableRow.capacity;
        verifiedTables.push(tableRow);
      }

      // Check if any of the selected tables is already fully occupied
      const activeOrders = await db.all(
        `SELECT id, order_number, table_number, table_numbers, guest_count
         FROM orders
         WHERE order_type = 'DINE_IN'
           AND status IN ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY')`
      );

      for (const tNum of inputTables) {
        for (const ord of activeOrders) {
          const associated = [];
          if (ord.table_number) associated.push(ord.table_number);
          if (ord.table_numbers) {
            String(ord.table_numbers).split(',').forEach(s => {
              const n = parseInt(s.trim(), 10);
              if (!isNaN(n)) associated.push(n);
            });
          }
          if (associated.includes(tNum)) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'TABLE_OCCUPIED',
                message: `Table #${tNum} is currently occupied by active order ${ord.order_number}. Please choose an open table.`
              }
            });
          }
        }
      }

      validTableId = verifiedTables[0].id;
      validTableNumber = verifiedTables[0].table_number;
      validTableNumbersStr = verifiedTables.map(t => t.table_number).join(', ');
    }

    // 3. Validate Payment Method
    const normalizedMethod = (paymentMethod || 'UPI').toUpperCase();
    if (normalizedMethod !== 'COUNTER' && normalizedMethod !== 'UPI' && normalizedMethod !== 'RAZORPAY') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PAYMENT_METHOD', message: 'Payment method must be Pay at Counter, Online UPI, or Razorpay.' }
      });
    }

    // 4. Validate Items & Re-calculate Total Server-Side (Zero Trust)
    if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ITEMS', message: 'Order must contain between 1 and 30 items.' }
      });
    }

    // Aggregate duplicate item IDs in cart payload
    const itemMap = new Map();
    for (const itm of items) {
      const productId = itm.productId || itm.id;
      const qty = parseInt(itm.quantity, 10);
      if (!productId || isNaN(qty) || qty < 1) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'Item quantity must be a positive integer.' }
        });
      }
      itemMap.set(productId, (itemMap.get(productId) || 0) + qty);
    }

    let calculatedTotal = 0;
    const validatedItems = [];

    for (const [productId, qty] of itemMap.entries()) {
      if (qty > 20) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'Maximum quantity per item is 20.' }
        });
      }

      const product = await db.get(
        'SELECT id, name, price, available, active FROM products WHERE id = ? AND active = 1',
        [productId]
      );

      if (!product) {
        return res.status(400).json({
          success: false,
          error: { code: 'PRODUCT_NOT_FOUND', message: `Product ${productId} not found.` }
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

    const orderId = 'ord_' + crypto.randomUUID();
    const orderToken = crypto.randomBytes(24).toString('hex');
    const now = new Date().toISOString();
    const cleanNotes = notes && typeof notes === 'string' ? notes.trim().slice(0, 300) : null;
    const cleanIdempotencyKey = idempotencyKey && typeof idempotencyKey === 'string' ? idempotencyKey.trim() : null;

    // Configurable tax rate from settings (defaults to 0%)
    const taxRow = await db.get("SELECT value FROM settings WHERE key = 'tax_rate_percent'");
    const taxRate = taxRow ? parseFloat(taxRow.value) || 0 : 0;
    const taxAmount = Math.round(calculatedTotal * (taxRate / 100));
    const finalTotal = calculatedTotal + taxAmount;

    let orderNumber = null;

    // 5. Insert Order & Order Items within an Atomic Transaction
    await db.transaction(async (tx) => {
      // Atomic Table Occupancy Verification (Prevents race conditions / double-booking)
      if (orderType === 'DINE_IN') {
        const activeOrders = await tx.all(
          `SELECT id, order_number, table_number, table_numbers
           FROM orders
           WHERE order_type = 'DINE_IN'
             AND status IN ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY')`
        );

        for (const tNum of inputTables) {
          for (const ord of activeOrders) {
            const associated = [];
            if (ord.table_number) associated.push(parseInt(ord.table_number, 10));
            if (ord.table_numbers) {
              String(ord.table_numbers).split(',').forEach(s => {
                const n = parseInt(s.trim(), 10);
                if (!isNaN(n)) associated.push(n);
              });
            }
            if (associated.includes(tNum)) {
              const tableErr = new Error(`Table #${tNum} is currently occupied by active order ${ord.order_number}. Please choose an open table.`);
              tableErr.code = 'TABLE_OCCUPIED';
              throw tableErr;
            }
          }
        }
      }

      // Concurrency-safe atomic order number generation
      orderNumber = await db.getNextOrderNumber(tx);

      await tx.run(
        `INSERT INTO orders (
          id, order_number, customer_name, customer_phone, order_type,
          table_id, table_number, table_numbers, guest_count, status, payment_status, payment_method,
          subtotal, tax, discount, total, notes, order_token, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', 'PAYMENT_PENDING', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          orderNumber,
          customerName.trim(),
          cleanPhone,
          orderType,
          validTableId,
          validTableNumber,
          validTableNumbersStr,
          validGuestCount,
          normalizedMethod,
          calculatedTotal,
          taxAmount,
          finalTotal,
          cleanNotes,
          orderToken,
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
          normalizedMethod === 'COUNTER' ? 'COUNTER' : (normalizedMethod === 'RAZORPAY' ? 'RAZORPAY' : 'DIRECT_UPI'),
          calculatedTotal,
          normalizedMethod,
          now,
          now
        ]
      );
    });

    console.log(`🛎️  New Genuine Order Created: ${orderNumber} (${orderType} · ₹${calculatedTotal} · ${normalizedMethod})`);

    // 6. Generate Payment Payload
    let paymentPayload = null;
    if (normalizedMethod === 'RAZORPAY') {
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
            orderId,
            orderNumber,
            total: calculatedTotal
          };
        } catch (rzpErr) {
          console.warn('Razorpay order creation error:', rzpErr.message);
          paymentPayload = {
            provider: 'RAZORPAY',
            keyId: process.env.RAZORPAY_KEY_ID,
            amount: Math.round(calculatedTotal * 100),
            currency: 'INR',
            destinationVpa: directUPI.vpa,
            directUpi: directUpiPayload
          };
        }
      } else {
        paymentPayload = {
          provider: 'RAZORPAY',
          keyId: process.env.RAZORPAY_KEY_ID,
          amount: Math.round(calculatedTotal * 100),
          currency: 'INR',
          destinationVpa: directUPI.vpa,
          directUpi: directUpiPayload
        };
      }
    } else if (normalizedMethod === 'UPI') {
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

    let tableLabel = null;
    let tableNumbersArray = [];
    if (validTableNumbersStr && validTableNumbersStr.includes(',')) {
      tableNumbersArray = validTableNumbersStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      const parts = tableNumbersArray.map(n => n < 10 ? '0' + n : '' + n);
      tableLabel = `Tables ${parts.join(' & ')}`;
    } else if (validTableNumber) {
      tableNumbersArray = [validTableNumber];
      tableLabel = `Table ${validTableNumber < 10 ? '0' + validTableNumber : validTableNumber}`;
    }

    notifyOrderChange({
      action: 'CREATED',
      orderId,
      orderNumber,
      orderType,
      tableNumber: validTableNumber,
      tableNumbers: validTableNumbersStr,
      tableLabel,
      guestCount: validGuestCount,
      status: 'RECEIVED',
      paymentStatus: 'PAYMENT_PENDING',
      total: finalTotal
    });

    res.status(201).json({
      success: true,
      data: {
        orderId,
        orderNumber,
        orderToken,
        customerName: customerName.trim(),
        orderType,
        tableNumber: validTableNumber,
        tableNumbers: tableNumbersArray,
        tableLabel,
        guestCount: validGuestCount,
        paymentMethod: normalizedMethod,
        paymentStatus: 'PAYMENT_PENDING',
        status: 'RECEIVED',
        statusLabel: getStatusLabel('RECEIVED', 'PAYMENT_PENDING'),
        stepIndex: getStepIndex('RECEIVED'),
        total: finalTotal,
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
    if (err.code === 'TABLE_OCCUPIED') {
      return res.status(400).json({
        success: false,
        error: { code: 'TABLE_OCCUPIED', message: err.message }
      });
    }

    // Handle duplicate idempotency key race
    const cleanIdempotencyKey = req.body && req.body.idempotencyKey && typeof req.body.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : null;
    if (cleanIdempotencyKey && (err.message?.includes('UNIQUE constraint failed') || err.message?.includes('idempotency_key') || err.code === '23505')) {
      try {
        const existingOrder = await db.get('SELECT * FROM orders WHERE idempotency_key = ?', [cleanIdempotencyKey]);
        if (existingOrder) {
          const orderItems = await db.all(
            'SELECT product_name_snapshot AS name, unit_price_snapshot AS unitPrice, quantity, subtotal FROM order_items WHERE order_id = ?',
            [existingOrder.id]
          );
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
              isIdempotentReplay: true
            }
          });
        }
      } catch (_) {}
    }

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

// GET /api/orders/history - Customer Order History (strictly scoped by device order numbers)
router.get('/history', async (req, res) => {
  try {
    const { orderNumbers } = req.query;

    let orders = [];
    if (orderNumbers && typeof orderNumbers === 'string') {
      const numbersList = orderNumbers
        .split(',')
        .map(n => n.trim().toUpperCase())
        .filter(n => /^CAF-\d+$/.test(n))
        .slice(0, 10);

      if (numbersList.length > 0) {
        orders = await db.all(
          `SELECT order_number, order_type, table_number,
                  status, payment_status, payment_method, total, created_at
           FROM orders
           WHERE order_number IN (${numbersList.map(() => '?').join(',')})
           ORDER BY created_at DESC, order_number DESC
           LIMIT 10`,
          numbersList
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

// GET /api/orders/:orderNumber - Customer Live Order Tracking (Token protected for privacy)
router.get('/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const clientToken = req.headers['x-order-token'] || req.query.token;

    const order = await db.get(
      `SELECT id, order_number, customer_name, order_type, table_number, table_numbers, guest_count,
              status, payment_status, payment_method, subtotal, tax, discount, total, notes,
              customer_utr, razorpay_order_id, order_token, created_at
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

    let isAdmin = false;
    try {
      let adminToken = null;
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        adminToken = req.headers.authorization.split(' ')[1];
      } else if (req.cookies && req.cookies.admin_token) {
        adminToken = req.cookies.admin_token;
      }
      if (adminToken) {
        jwt.verify(adminToken, getJwtSecret(), {
          algorithms: ['HS256'],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE
        });
        isAdmin = true;
      }
    } catch (e) {
      isAdmin = false;
    }

    const isAuthorized = Boolean(
      (order.order_token && clientToken && order.order_token === clientToken) ||
      isAdmin
    );

    // Privacy Masking: Protect customer identity and receipts from unauthorized enumeration
    let safeCustomerName = 'Guest';
    if (isAuthorized && order.customer_name) {
      safeCustomerName = order.customer_name;
    } else if (order.customer_name) {
      const parts = order.customer_name.trim().split(/\s+/);
      safeCustomerName = parts.map(p => p[0] + '***').join(' ');
    }

    let tableLabel = null;
    let tableNumbersArray = [];
    if (order.table_numbers && order.table_numbers.includes(',')) {
      tableNumbersArray = order.table_numbers.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      const parts = tableNumbersArray.map(n => n < 10 ? '0' + n : '' + n);
      tableLabel = `Tables ${parts.join(' & ')}`;
    } else if (order.table_number) {
      tableNumbersArray = [order.table_number];
      tableLabel = `Table ${order.table_number < 10 ? '0' + order.table_number : order.table_number}`;
    }

    let items = [];
    if (isAuthorized) {
      items = await db.all(
        `SELECT product_name_snapshot AS name, unit_price_snapshot AS unitPrice,
                quantity, subtotal
         FROM order_items
         WHERE order_id = ?`,
        [order.id]
      );
    }

    // Attach UPI / Razorpay payment instructions & QR only if authorized and pending
    let paymentDetails = null;
    if (isAuthorized && order.payment_method === 'UPI') {
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
        customerName: safeCustomerName,
        orderType: order.order_type,
        tableNumber: order.table_number,
        tableNumbers: tableNumbersArray,
        tableLabel,
        guestCount: order.guest_count || null,
        status: order.status,
        statusLabel: getStatusLabel(order.status, order.payment_status),
        stepIndex: getStepIndex(order.status),
        isTableVacant: order.status === 'COMPLETED' || order.status === 'CANCELLED',
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        subtotal: isAuthorized ? order.subtotal : null,
        tax: isAuthorized ? (order.tax || 0) : null,
        total: order.total,
        notes: isAuthorized ? order.notes : null,
        customerUtr: isAuthorized ? order.customer_utr : null,
        createdAt: order.created_at,
        items,
        payment: paymentDetails,
        isMasked: !isAuthorized
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
module.exports.notifyOrderChange = notifyOrderChange;
module.exports.getStatusLabel = getStatusLabel;
module.exports.getStepIndex = getStepIndex;
