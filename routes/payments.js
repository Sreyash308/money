/**
 * Payment Route (Provider-Ready Architecture)
 * Supports Direct UPI (9182916879@ybl), Pay at Counter, customer UTR submission,
 * and dormant Razorpay gateway/webhook integration.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { getActiveMethods, directUPI, razorpay } = require('../lib/payments');
const { notifyOrderChange } = require('./orders');
const { syncOrderToCloud } = require('../lib/order-sync');

// GET /api/payments/methods - List currently configured payment methods
router.get('/methods', (req, res) => {
  res.json({
    success: true,
    data: {
      methods: getActiveMethods(),
      destinationVpa: directUPI.vpa,
      merchantName: directUPI.merchantName
    }
  });
});

// GET /api/payments/upi-info - Return UPI Configuration
router.get('/upi-info', (req, res) => {
  res.json({
    success: true,
    data: {
      destinationVpa: directUPI.vpa,
      merchantName: directUPI.merchantName
    }
  });
});

// POST /api/payments/submit-utr - Customer submits 12-digit UPI UTR / Transaction Reference
router.post('/submit-utr', async (req, res) => {
  try {
    const { orderNumber, utr } = req.body;
    const clientToken = req.headers['x-order-token'] || req.body.orderToken;

    if (!orderNumber || !utr) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_DATA', message: 'Order number and UPI UTR / Reference are required.' }
      });
    }

    const cleanUtr = utr.trim().replace(/[^a-zA-Z0-9]/g, '');
    if (cleanUtr.length < 8 || cleanUtr.length > 30) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_UTR', message: 'Please enter a valid UPI reference or UTR number (usually 12 digits).' }
      });
    }

    const order = await db.get(
      'SELECT id, order_number, payment_status, status, order_token FROM orders WHERE order_number = ?',
      [orderNumber.toUpperCase()]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' }
      });
    }

    // Verify token authorization if token was configured on order
    if (order.order_token && clientToken && order.order_token !== clientToken) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Unauthorized to submit UTR for this order.' }
      });
    }

    // Disallow UTR submission on cancelled or already paid orders
    if (order.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: { code: 'ORDER_CANCELLED', message: 'Cannot submit UTR for a cancelled order.' }
      });
    }

    if (order.payment_status === 'PAID') {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_PAID', message: 'Order has already been marked as paid.' }
      });
    }

    // Check for duplicate UTR usage across other orders
    const existingUtr = await db.get(
      'SELECT id, order_number FROM orders WHERE customer_utr = ? AND id != ?',
      [cleanUtr, order.id]
    );

    if (existingUtr) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'DUPLICATE_UTR',
          message: 'This UPI reference / UTR number has already been registered for another order.'
        }
      });
    }

    const now = new Date().toISOString();

    // Attach customer UTR without claiming automatic verification
    // Status strictly remains PAYMENT_PENDING until verified by admin
    await db.run(
      'UPDATE orders SET customer_utr = ?, updated_at = ? WHERE id = ?',
      [cleanUtr, now, order.id]
    );

    try {
      const updatedOrder = await db.get('SELECT * FROM orders WHERE id = ?', [order.id]);
      if (updatedOrder) syncOrderToCloud(updatedOrder).catch(() => {});
    } catch (_) {}

    await db.logAuditEvent({
      actorId: 'CUSTOMER',
      actorRole: 'CUSTOMER',
      action: 'UTR_SUBMITTED',
      entityType: 'ORDER',
      entityId: order.id,
      details: { orderNumber: order.order_number, utr: cleanUtr },
      ipAddress: req.ip
    });

    console.log(`📝 Customer submitted UTR ${cleanUtr} for order ${order.order_number}`);

    res.json({
      success: true,
      data: {
        orderNumber: order.order_number,
        customerUtr: cleanUtr,
        paymentStatus: order.payment_status,
        message: 'UTR reference recorded. Pending cashier verification.'
      }
    });
  } catch (err) {
    console.error('Error submitting UTR:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to record transaction reference.' }
    });
  }
});

// POST /api/payments/create-order or /api/create-order - Create Razorpay Standard Order
async function handleCreateOrder(req, res) {
  try {
    const { amount, currency = 'INR', receipt, notes, orderNumber } = req.body;

    // Minimum amount: 100 paise (₹1.00)
    const amountPaise = Number(amount);
    if (!amount || isNaN(amountPaise) || amountPaise < 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_AMOUNT',
          message: 'Amount is required and must be at least 100 paise (₹1.00).'
        }
      });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'CONFIG_ERROR',
          message: 'Razorpay credentials not configured on server.'
        }
      });
    }

    const Razorpay = require('razorpay');
    const rzp = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });

    const receiptId = (receipt || (orderNumber ? `rcpt_${orderNumber}` : `rcpt_${Date.now()}`)).toString().slice(0, 40);

    let rzpOrder;
    try {
      rzpOrder = await rzp.orders.create({
        amount: Math.round(amountPaise),
        currency: currency || 'INR',
        receipt: receiptId,
        notes: notes || (orderNumber ? { orderNumber } : {})
      });
    } catch (rzpErr) {
      const statusCode = rzpErr.statusCode || (rzpErr.error && rzpErr.error.code === 'BAD_REQUEST_ERROR' ? 401 : 500);
      const isAuthFailure = statusCode === 401 || (rzpErr.error && /authentication/i.test(rzpErr.error.description || ''));

      if (isAuthFailure) {
        console.warn('⚠️ Razorpay Authentication Failed:', rzpErr.error?.description || rzpErr.message);
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_FAILED',
            message: 'Razorpay authentication failed. Please check your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
          }
        });
      }

      console.error('Razorpay API error creating order:', rzpErr);
      return res.status(500).json({
        success: false,
        error: {
          code: 'RAZORPAY_ERROR',
          message: rzpErr.error?.description || rzpErr.message || 'Failed to create Razorpay order.'
        }
      });
    }

    if (orderNumber) {
      try {
        await db.run('UPDATE orders SET razorpay_order_id = ? WHERE order_number = ?', [rzpOrder.id, orderNumber.toUpperCase()]);
      } catch (dbErr) {
        console.warn('Could not update razorpay_order_id on order in DB:', dbErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      order_id: rzpOrder.id,
      id: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      key_id: keyId,
      receipt: rzpOrder.receipt
    });
  } catch (err) {
    console.error('Unexpected error in handleCreateOrder:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Internal server error while creating Razorpay order.'
      }
    });
  }
}

// POST /api/payments/verify-payment or /api/verify-payment - Verify Razorpay Standard Signature
async function handleVerifyPayment(req, res) {
  try {
    const orderId = req.body.razorpay_order_id || req.body.order_id;
    const paymentId = req.body.razorpay_payment_id || req.body.payment_id;
    const signature = req.body.razorpay_signature || req.body.signature;
    const orderNumber = req.body.orderNumber;

    // Missing fields check: return 400
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'order_id (or razorpay_order_id), payment_id (or razorpay_payment_id), and signature (or razorpay_signature) are required.'
        }
      });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'CONFIG_ERROR',
          message: 'Razorpay secret key not configured on server.'
        }
      });
    }

    // Step 3 Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const expectedBuf = Buffer.from(generatedSignature, 'utf8');
    const sigBuf = Buffer.from(signature, 'utf8');

    let isValid = false;
    if (expectedBuf.length === sigBuf.length) {
      try {
        isValid = crypto.timingSafeEqual(expectedBuf, sigBuf);
      } catch (e) {
        isValid = false;
      }
    }

    if (!isValid) {
      console.warn(`⚠️ Razorpay signature mismatch: order_id=${orderId}, payment_id=${paymentId}`);
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Payment signature verification failed. Signature mismatch.'
        }
      });
    }

    // Check if associated with an order in DB
    let order = null;
    if (orderNumber) {
      order = await db.get(
        'SELECT id, order_number, total, payment_status, status, razorpay_order_id, table_number, order_type FROM orders WHERE order_number = ?',
        [orderNumber.toUpperCase()]
      );
    } else {
      order = await db.get(
        'SELECT id, order_number, total, payment_status, status, razorpay_order_id, table_number, order_type FROM orders WHERE razorpay_order_id = ?',
        [orderId]
      );
    }

    if (order) {
      // Security Check: Verify association with order's created razorpay_order_id if recorded
      if (order.razorpay_order_id && order.razorpay_order_id !== orderId) {
        console.warn(`⚠️ Razorpay order mismatch for order ${order.order_number}: expected ${order.razorpay_order_id}, got ${orderId}`);
        return res.status(400).json({
          success: false,
          error: { code: 'ORDER_MISMATCH', message: 'Payment is not associated with this order.' }
        });
      }

      // Idempotent replay if already marked PAID
      if (order.payment_status === 'PAID') {
        return res.status(200).json({
          success: true,
          order_id: orderId,
          payment_id: paymentId,
          data: {
            orderNumber: order.order_number,
            paymentStatus: 'PAID',
            status: order.status,
            message: 'Payment already verified and confirmed.'
          }
        });
      }

      const now = new Date().toISOString();

      // Update order status to PAID and CONFIRMED
      await db.run(
        `UPDATE orders
         SET payment_status = 'PAID',
             status = CASE WHEN status IN ('PENDING', 'RECEIVED') THEN 'CONFIRMED' ELSE status END,
             razorpay_order_id = ?,
             razorpay_payment_id = ?,
             updated_at = ?
         WHERE id = ?`,
        [orderId, paymentId, now, order.id]
      );

      // Update payments record
      await db.run(
        `UPDATE payments
         SET status = 'PAID',
             provider = 'RAZORPAY',
             provider_order_id = ?,
             provider_payment_id = ?,
             updated_at = ?
         WHERE order_id = ?`,
        [orderId, paymentId, now, order.id]
      );

      console.log(`✅ Verified Razorpay payment ${paymentId} for order ${order.order_number} (₹${order.total})`);

      await db.logAuditEvent({
        actorId: 'SYSTEM',
        actorRole: 'PAYMENT_GATEWAY',
        action: 'ORDER_PAYMENT_VERIFIED',
        entityType: 'ORDER',
        entityId: order.id,
        details: { orderNumber: order.order_number, provider: 'RAZORPAY', paymentId, orderId },
        ipAddress: req.ip
      });

      notifyOrderChange({
        action: 'PAID_AND_ACCEPTED',
        orderId: order.id,
        orderNumber: order.order_number,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        tableNumber: order.table_number,
        orderType: order.order_type
      });

      try {
        const updatedOrder = await db.get('SELECT * FROM orders WHERE id = ?', [order.id]);
        if (updatedOrder) syncOrderToCloud(updatedOrder).catch(() => {});
      } catch (_) {}

      return res.status(200).json({
        success: true,
        order_id: orderId,
        payment_id: paymentId,
        data: {
          orderNumber: order.order_number,
          paymentStatus: 'PAID',
          status: 'CONFIRMED',
          paymentId: paymentId,
          message: 'Payment verified successfully.'
        }
      });
    }

    // Standalone verification without linked cafe order
    return res.status(200).json({
      success: true,
      order_id: orderId,
      payment_id: paymentId,
      message: 'Payment verified successfully.'
    });
  } catch (err) {
    console.error('Error verifying Razorpay signature:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Internal error during payment verification.' }
    });
  }
}

// Router mounts for order creation and verification
router.post('/create-order', handleCreateOrder);
router.post('/verify-payment', handleVerifyPayment);
router.post('/verify', handleVerifyPayment);

// POST /api/payments/razorpay/webhook - Idempotent Razorpay Webhook Handler (Active when live keys configured)
router.post('/razorpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(200).json({ status: 'ignored_no_secret' });
    }

    const signature = req.headers['x-razorpay-signature'];
    const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf8');

    // Webhook signature verification using timingSafeEqual
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const sigBuf = Buffer.from(signature || '', 'utf8');

    if (expectedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expectedBuf, sigBuf)) {
      console.warn('⚠️ Webhook signature mismatch.');
      return res.status(400).json({ status: 'invalid_signature' });
    }

    const event = JSON.parse(rawBody);
    const eventId = event.event_id || event.id || crypto.createHash('md5').update(rawBody).digest('hex');

    // Enforce Webhook Idempotency: Check if already processed
    const alreadyProcessed = await db.get(
      'SELECT id FROM webhook_events WHERE provider_event_id = ?',
      [eventId]
    );

    if (alreadyProcessed) {
      return res.status(200).json({ status: 'already_processed' });
    }

    const now = new Date().toISOString();

    // Handle Payment Capture / Order Paid
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const paymentEntity = event.payload.payment ? event.payload.payment.entity : null;
      const orderEntity = event.payload.order ? event.payload.order.entity : null;

      const rzpOrderId = (paymentEntity && paymentEntity.order_id) || (orderEntity && orderEntity.id);
      const rzpPaymentId = paymentEntity ? paymentEntity.id : null;

      if (rzpOrderId) {
        const order = await db.get(
          'SELECT id, order_number, total FROM orders WHERE razorpay_order_id = ?',
          [rzpOrderId]
        );

        if (order) {
          // Verify amount matches if payment entity contains amount (in paise)
          if (paymentEntity && paymentEntity.amount) {
            const expectedPaise = Math.round(order.total * 100);
            if (paymentEntity.amount !== expectedPaise) {
              console.warn(`⚠️ Webhook amount mismatch for order ${order.order_number}: expected ${expectedPaise} paise, received ${paymentEntity.amount}`);
              return res.status(400).json({ status: 'amount_mismatch' });
            }
          }

          await db.run(
            `UPDATE orders
             SET payment_status = 'PAID',
                 status = CASE WHEN status = 'RECEIVED' THEN 'CONFIRMED' ELSE status END,
                 razorpay_payment_id = COALESCE(?, razorpay_payment_id),
                 updated_at = ?
             WHERE id = ?`,
            [rzpPaymentId, now, order.id]
          );

          await db.run(
            `UPDATE payments
             SET status = 'PAID',
                 provider_payment_id = COALESCE(?, provider_payment_id),
                 updated_at = ?
             WHERE provider_order_id = ?`,
            [rzpPaymentId, now, rzpOrderId]
          );

          await db.logAuditEvent({
            actorId: 'SYSTEM',
            actorRole: 'PAYMENT_GATEWAY',
            action: 'PAYMENT_WEBHOOK_PROCESSED',
            entityType: 'ORDER',
            entityId: order.id,
            details: { eventId, event: event.event, rzpOrderId, rzpPaymentId },
            ipAddress: req.ip
          });

          console.log(`🔔 Webhook confirmed payment for order: ${order.order_number}`);
        }
      }
    }

    // Record processed event to guarantee idempotency
    await db.run(
      'INSERT INTO webhook_events (id, provider_event_id, event_type, payload, processed_at) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), eventId, event.event || 'unknown', rawBody.slice(0, 1000), now]
    );

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Error handling webhook:', err);
    res.status(500).json({ status: 'error' });
  }
});

router.handleCreateOrder = handleCreateOrder;
router.handleVerifyPayment = handleVerifyPayment;

module.exports = router;
module.exports.router = router;
module.exports.handleCreateOrder = handleCreateOrder;
module.exports.handleVerifyPayment = handleVerifyPayment;

