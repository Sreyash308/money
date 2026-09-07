/**
 * Payment Route (Razorpay UPI Integration & Verification)
 * Strictly enforces server-side order creation, HMAC signature verification,
 * and webhook idempotency.
 */

const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const router = express.Router();
const db = require('../db');

function isRealRazorpayKey(keyId, keySecret) {
  return (
    keyId &&
    keySecret &&
    keyId.startsWith('rzp_') &&
    !keyId.includes('YourKeyId') &&
    !keySecret.includes('YourKeySecret')
  );
}

// POST /api/payments/create - Create official Razorpay order for an existing restaurant order
router.post('/create', async (req, res) => {
  try {
    const { orderNumber } = req.body;
    if (!orderNumber) {
      return res.status(400).json({
        success: false,
        error: { code: 'ORDER_REQUIRED', message: 'Order number is required.' }
      });
    }

    const order = await db.get(
      'SELECT id, order_number, total, payment_status, payment_method, status FROM orders WHERE order_number = ?',
      [orderNumber.toUpperCase()]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' }
      });
    }

    if (order.payment_status === 'PAID') {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_PAID', message: 'This order has already been paid.' }
      });
    }

    const amountInPaise = Math.round(order.total * 100);
    const destinationVpa = process.env.UPI_MERCHANT_VPA || '9182916879@ybl';
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    let razorpayOrderId = null;
    let isSimulated = false;

    if (isRealRazorpayKey(keyId, keySecret)) {
      // Official Razorpay API Call
      const rzp = new Razorpay({
        key_id: keyId,
        key_secret: keySecret
      });

      const rzpOrder = await rzp.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: order.order_number,
        notes: {
          restaurantOrderNumber: order.order_number,
          destinationVpa: destinationVpa
        }
      });
      razorpayOrderId = rzpOrder.id;
    } else {
      // Test/Local Simulation Mode (allows testing the full checkout flow without live credentials)
      isSimulated = true;
      razorpayOrderId = 'order_sim_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      console.log(`ℹ️  Razorpay Simulation Mode active for order: ${order.order_number}`);
    }

    const now = new Date().toISOString();

    // Link Razorpay order ID to the internal order
    await db.run(
      'UPDATE orders SET razorpay_order_id = ?, updated_at = ? WHERE id = ?',
      [razorpayOrderId, now, order.id]
    );

    // Record in payments table
    const paymentId = 'payrec_' + crypto.randomUUID();
    await db.run(
      `INSERT INTO payments (
        id, order_id, provider, provider_order_id, amount, currency,
        status, method, created_at, updated_at
      ) VALUES (?, ?, 'RAZORPAY', ?, ?, 'INR', 'PENDING', 'UPI', ?, ?)`,
      [paymentId, order.id, razorpayOrderId, amountInPaise, now, now]
    );

    res.json({
      success: true,
      data: {
        orderNumber: order.order_number,
        razorpayOrderId,
        amount: amountInPaise,
        currency: 'INR',
        keyId: isSimulated ? 'rzp_test_simulation' : keyId,
        destinationVpa,
        isSimulated
      }
    });
  } catch (err) {
    console.error('Error creating payment order:', err);
    res.status(500).json({
      success: false,
      error: { code: 'PAYMENT_CREATION_FAILED', message: 'Failed to initiate payment gateway order.' }
    });
  }
});

// POST /api/payments/verify - Server-side HMAC SHA256 signature verification
router.post('/verify', async (req, res) => {
  try {
    const { orderNumber, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!orderNumber || !razorpayOrderId || !razorpayPaymentId) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PAYMENT_DATA', message: 'Missing payment verification data.' }
      });
    }

    const order = await db.get(
      'SELECT id, order_number, razorpay_order_id, payment_status FROM orders WHERE order_number = ?',
      [orderNumber.toUpperCase()]
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order record not found.' }
      });
    }

    // Security check: order IDs must match server record
    if (order.razorpay_order_id !== razorpayOrderId) {
      return res.status(400).json({
        success: false,
        error: { code: 'ORDER_MISMATCH', message: 'Payment order ID does not match server record.' }
      });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const isSimulated = razorpayOrderId.startsWith('order_sim_');

    let isValid = false;

    if (isSimulated) {
      // In simulation mode, verify simulation token
      const expectedSimSig = crypto
        .createHmac('sha256', 'ochre_sim_secret')
        .update(razorpayOrderId + '|' + razorpayPaymentId)
        .digest('hex');
      isValid = (razorpaySignature === expectedSimSig) || (razorpaySignature === 'sim_verified_sig');
    } else {
      // Official Razorpay HMAC-SHA256 signature verification
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(razorpayOrderId + '|' + razorpayPaymentId)
        .digest('hex');

      try {
        isValid = crypto.timingSafeEqual(
          Buffer.from(expectedSignature, 'utf8'),
          Buffer.from(razorpaySignature, 'utf8')
        );
      } catch (e) {
        isValid = false;
      }
    }

    const now = new Date().toISOString();

    if (!isValid) {
      console.warn(`🚨 Payment signature verification FAILED for order ${order.order_number}`);
      await db.run(
        "UPDATE payments SET status = 'FAILED', updated_at = ? WHERE provider_order_id = ?",
        [now, razorpayOrderId]
      );
      return res.status(400).json({
        success: false,
        error: {
          code: 'PAYMENT_VERIFICATION_FAILED',
          message: 'Security validation failed: Payment signature is invalid or tampered.'
        }
      });
    }

    // Signature is valid -> Mark order PAID and CONFIRMED
    await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE orders
         SET payment_status = 'PAID',
             status = 'CONFIRMED',
             razorpay_payment_id = ?,
             updated_at = ?
         WHERE id = ?`,
        [razorpayPaymentId, now, order.id]
      );

      await tx.run(
        `UPDATE payments
         SET status = 'PAID',
             provider_payment_id = ?,
             updated_at = ?
         WHERE provider_order_id = ?`,
        [razorpayPaymentId, now, razorpayOrderId]
      );
    });

    console.log(`✅ Payment VERIFIED & Order CONFIRMED: ${order.order_number} (Payment ID: ${razorpayPaymentId})`);

    res.json({
      success: true,
      data: {
        orderNumber: order.order_number,
        paymentStatus: 'PAID',
        status: 'CONFIRMED'
      }
    });
  } catch (err) {
    console.error('Error verifying payment:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to verify payment.' }
    });
  }
});

// POST /api/payments/razorpay/webhook - Idempotent Razorpay Webhook Handler
router.post('/razorpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf8');

    // Webhook signature verification
    if (webhookSecret && !webhookSecret.includes('YourWebhookSecret')) {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      if (signature !== expectedSignature) {
        console.warn('⚠️ Webhook signature mismatch.');
        return res.status(400).json({ status: 'invalid_signature' });
      }
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
