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
  }

  /**
   * Check if genuine Razorpay credentials are provided
   */
  isConfigured() {
    return Boolean(
      this.keyId &&
      this.keySecret &&
      this.keyId.startsWith('rzp_') &&
      !this.keyId.includes('YourKeyId') &&
      !this.keySecret.includes('YourKeySecret')
    );
  }

  async createPaymentRequest(order) {
    if (!this.isConfigured()) {
      throw new Error('Razorpay is not configured. Live merchant keys are required.');
    }

    const Razorpay = require('razorpay');
    const rzp = new Razorpay({
      key_id: this.keyId,
      key_secret: this.keySecret
    });

    const amountInPaise = Math.round(order.total * 100);
    const rzpOrder = await rzp.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: order.order_number,
      notes: {
        orderNumber: order.order_number
      }
    });

    return {
      provider: 'RAZORPAY',
      keyId: this.keyId,
      razorpayOrderId: rzpOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      paymentStatus: 'PAYMENT_PENDING'
    };
  }

  /**
   * Verify HMAC-SHA256 signature from Razorpay
   */
  verifySignature(orderId, paymentId, signature) {
    if (!this.isConfigured()) return false;
    const expectedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(signature, 'utf8')
      );
    } catch (e) {
      return false;
    }
  }
}

module.exports = RazorpayProvider;
