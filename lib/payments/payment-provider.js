/**
 * Base Payment Provider Interface
 */
class PaymentProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Check if this payment provider is currently active/configured
   */
  isConfigured() {
    return true;
  }

  /**
   * Create payment request / instructions for an order
   * @param {Object} order - internal order row
   * @returns {Promise<Object>} provider payment payload
   */
  async createPaymentRequest(order) {
    throw new Error('createPaymentRequest not implemented');
  }

  /**
   * Verify an incoming payment callback / webhook
   * @param {Object} payload
   */
  async verifyPayment(payload) {
    throw new Error('verifyPayment not implemented');
  }
}

module.exports = PaymentProvider;
