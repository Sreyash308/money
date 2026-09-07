/**
 * Payment Providers Registry
 */

const DirectUPIProvider = require('./direct-upi-provider');
const CounterProvider = require('./counter-provider');
const RazorpayProvider = require('./razorpay-provider');

const directUPI = new DirectUPIProvider();
const counter = new CounterProvider();
const razorpay = new RazorpayProvider();

function getProvider(method) {
  switch ((method || '').toUpperCase()) {
    case 'UPI':
    case 'DIRECT_UPI':
      return directUPI;
    case 'COUNTER':
      return counter;
    case 'RAZORPAY':
      return razorpay;
    default:
      return directUPI;
  }
}

function getActiveMethods() {
  const methods = [
    {
      id: 'UPI',
      name: 'Pay Online with UPI',
      description: `Instant UPI transfer to ${directUPI.vpa}`,
      isAvailable: directUPI.isConfigured()
    },
    {
      id: 'COUNTER',
      name: 'Pay at Counter',
      description: 'Cash or Card at the cafe register',
      isAvailable: counter.isConfigured()
    }
  ];

  if (razorpay.isConfigured()) {
    methods.push({
      id: 'RAZORPAY',
      name: 'Card / NetBanking / Gateway',
      description: 'Razorpay Secure Checkout',
      isAvailable: true
    });
  }

  return methods;
}

module.exports = {
  directUPI,
  counter,
  razorpay,
  getProvider,
  getActiveMethods
};
