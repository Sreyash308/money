/**
 * Direct UPI Payment Provider (NPCI Standard Protocol)
 * Generates dynamic UPI intent links and instant QR codes with server-calculated amounts
 * for destination VPA: 9182916879@ybl.
 */

const QRCode = require('qrcode');
const PaymentProvider = require('./payment-provider');

class DirectUPIProvider extends PaymentProvider {
  constructor() {
    super('DIRECT_UPI');
    this.vpa = process.env.UPI_MERCHANT_VPA || '9182916879@ybl';
    this.merchantName = process.env.UPI_MERCHANT_NAME || 'Ochre Coffee Roasters';
  }

  isConfigured() {
    return Boolean(this.vpa && this.vpa.includes('@'));
  }

  /**
   * Generates a standard NPCI UPI Payment URI:
   * upi://pay?pa=9182916879@ybl&pn=Ochre%20Coffee%20Roasters&am=249.00&cu=INR&tr=CAF-1001&tn=Order%20CAF-1001
   */
  generateUpiUri(orderNumber, amount, note = '') {
    const formattedAmount = Number(amount).toFixed(2);
    const txnNote = note || `Order ${orderNumber} Ochre Coffee`;
    const params = new URLSearchParams();

    params.set('pa', this.vpa);
    params.set('pn', this.merchantName);
    params.set('am', formattedAmount);
    params.set('cu', 'INR');
    params.set('tr', orderNumber);
    params.set('tn', txnNote);

    return `upi://pay?${params.toString()}`;
  }

  /**
   * Create payment request with dynamic QR code & mobile intent
   */
  async createPaymentRequest(order) {
    const amount = order.total;
    const upiUri = this.generateUpiUri(order.order_number, amount);

    // Generate crisp QR code data URL (Zero-network pure JS generation)
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(upiUri, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 300,
        color: {
          dark: '#1c1714',
          light: '#ffffff'
        }
      });
    } catch (qrErr) {
      console.error('Failed to generate QR Code:', qrErr);
    }

    return {
      provider: 'DIRECT_UPI',
      destinationVpa: this.vpa,
      merchantName: this.merchantName,
      amount: amount,
      currency: 'INR',
      upiUri: upiUri,
      qrDataUrl: qrDataUrl,
      paymentStatus: 'PAYMENT_PENDING',
      verificationType: 'ADMIN_MANUAL_OR_UTR',
      instructions: `Transfer ₹${amount} to UPI ID: ${this.vpa}. Keep your 12-digit UTR ready for fast verification.`
    };
  }
}

module.exports = DirectUPIProvider;
