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

    const now = new Date().toISOString();

    // Attach customer UTR without claiming automatic verification
    // Status strictly remains PAYMENT_PENDING until verified by admin
    await db.run(
      'UPDATE orders SET customer_utr = ?, updated_at = ? WHERE id = ?',
      [cleanUtr, now, order.id]
    );

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

// POST /api/payments/verify - Verify Razorpay Standard Checkout HMAC Signature
router.post('/verify', async (req, res) => {
  try {
    const { orderNumber, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!orderNumber || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_DATA', message: 'Order number, payment ID, order ID, and signature are required.' }
      });
    }

    const order = await db.get(
      'SELECT id, order_number, total, payment_status, status, razorpay_order_id, table_number, order_type FROM orders WHERE order_number = ?',
      [orderNumber.toUpperCase()]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' }
      });
    }

    // Security Check 1: Verify HMAC-SHA256 signature using Razorpay secret
    const isValid = razorpay.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      console.warn(`⚠️ Invalid Razorpay signature for order ${order.order_number}`);
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Payment signature verification failed.' }
      });
    }

    // Security Check 2: Verify association with order's created razorpay_order_id
    if (order.razorpay_order_id && order.razorpay_order_id !== razorpay_order_id) {
      console.warn(`⚠️ Razorpay order mismatch for order ${order.order_number}: expected ${order.razorpay_order_id}, got ${razorpay_order_id}`);
      return res.status(400).json({
        success: false,
        error: { code: 'ORDER_MISMATCH', message: 'Payment is not associated with this order.' }
      });
    }

    // Security Check 3: Idempotent replay if already marked PAID
    if (order.payment_status === 'PAID') {
      return res.status(200).json({
        success: true,
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
      [razorpay_order_id, razorpay_payment_id, now, order.id]
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
      [razorpay_order_id, razorpay_payment_id, now, order.id]
    );

    console.log(`✅ Verified Razorpay payment ${razorpay_payment_id} for order ${order.order_number} (₹${order.total})`);

    notifyOrderChange({
      action: 'PAID_AND_ACCEPTED',
      orderId: order.id,
      orderNumber: order.order_number,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      tableNumber: order.table_number,
      orderType: order.order_type
    });

    res.json({
      success: true,
      data: {
        orderNumber: order.order_number,
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        paymentId: razorpay_payment_id,
        message: 'Payment verified successfully.'
      }
    });
  } catch (err) {
    console.error('Error verifying Razorpay signature:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Internal error during payment verification.' }
    });
  }
});

// POST /api/payments/razorpay/webhook - Idempotent Razorpay Webhook Handler (Active when live keys configured)
router.post('/razorpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(200).json({ status: 'ignored_no_secret' });
    }

    const signature = req.headers['x-razorpay-signature'];
    const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf8');

    // Webhook signature verification
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
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
          'SELECT id, order_number FROM orders WHERE razorpay_order_id = ?',
          [rzpOrderId]
        );

        if (order) {
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

module.exports = router;
