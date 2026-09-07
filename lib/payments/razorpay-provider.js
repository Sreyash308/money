/**
 * Razorpay Payment Provider (Future Gateway Integration)
 * Only activates when genuine production/test credentials are configured in environment variables.
 * Does NOT generate mock IDs or simulate fake checkouts.
 */

const crypto = require('crypto');
const PaymentProvider = require('./payment-provider');

class RazorpayProvider extends PaymentProvider {
  constructor() {
    super('RAZORPAY');
    this.keyId = process.env.RAZORPAY_KEY_ID;
    this.keySecret = process.env.RAZORPAY_KEY_SECRET;
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    this.vpa = process.env.UPI_MERCHANT_VPA || '9182916879@ybl';
  }

  /**
   * Check if genuine Razorpay credentials are provided
   */
  isConfigured() {
    const keyId = process.env.RAZORPAY_KEY_ID || this.keyId;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || this.keySecret;
    return Boolean(
      keyId &&
      keySecret &&
      keyId.startsWith('rzp_') &&
      !keyId.includes('YourKeyId') &&
      !keySecret.includes('YourKeySecret')
    );
  }

  async createPaymentRequest(order) {
    if (!this.isConfigured()) {
      throw new Error('Razorpay is not configured. Live merchant keys are required.');
    }

    const keyId = process.env.RAZORPAY_KEY_ID || this.keyId;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || this.keySecret;
    const destinationVpa = process.env.UPI_MERCHANT_VPA || this.vpa || '9182916879@ybl';

    const Razorpay = require('razorpay');
    const rzp = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });

    const amountInPaise = Math.round(order.total * 100);
    const rzpOrder = await rzp.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: order.order_number,
      notes: {
        orderNumber: order.order_number,
        destinationVpa: destinationVpa
      }
    });

    return {
      provider: 'RAZORPAY',
      keyId: keyId,
      razorpayOrderId: rzpOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      destinationVpa: destinationVpa,
      paymentStatus: 'PAYMENT_PENDING'
    };
  }

  /**
   * Verify HMAC-SHA256 signature from Razorpay
   */
  verifySignature(orderId, paymentId, signature) {
    const keySecret = process.env.RAZORPAY_KEY_SECRET || this.keySecret;
    if (!keySecret || !orderId || !paymentId || !signature) return false;

    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const sigBuf = Buffer.from(signature, 'utf8');

    if (expectedBuf.length !== sigBuf.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(expectedBuf, sigBuf);
    } catch (e) {
      return false;
    }
  }
}

module.exports = RazorpayProvider;
