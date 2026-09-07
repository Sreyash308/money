/**
 * Counter Payment Provider
 * Cash or POS card payment at cafe counter.
 */

const PaymentProvider = require('./payment-provider');

class CounterProvider extends PaymentProvider {
  constructor() {
    super('COUNTER');
  }

  isConfigured() {
    return true;
  }

  async createPaymentRequest(order) {
    return {
      provider: 'COUNTER',
      amount: order.total,
      currency: 'INR',
      paymentStatus: 'PAYMENT_PENDING',
      verificationType: 'ADMIN_AT_COUNTER',
      instructions: `Please pay ₹${order.total} at the counter upon pickup or dining.`
    };
  }
}

module.exports = CounterProvider;
