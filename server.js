/**
 * Ochre Coffee Roasters Server
 * Express application serving static frontend and REST API routes.
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

dotenv.config();

const db = require('./db');
const { seed } = require('./db/seed');

const menuRouter = require('./routes/menu');
const tablesRouter = require('./routes/tables');
const ordersRouter = require('./routes/orders');
const paymentsRouter = require('./routes/payments');
const adminRouter = require('./routes/admin');

const app = express();

// Global Middlewares
app.use(cors());
app.use(cookieParser());

// Webhook raw body handling before json parser
app.use('/api/payments/razorpay/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Route Mounts
app.use('/api/menu', menuRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', adminRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve Static Assets & Pages
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/style.css', express.static(path.join(__dirname, 'style.css')));
app.use('/app.js', express.static(path.join(__dirname, 'app.js')));

// Clean HTML Route Handlers
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/cashier', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/order/:orderNumber', (req, res) => {
  res.sendFile(path.join(__dirname, 'order.html'));
});

app.get('/order', (req, res) => {
  res.sendFile(path.join(__dirname, 'order.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback static file serving
app.use(express.static(path.join(__dirname)));

// Auto-seed and start server if executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 8000;
  
  (async () => {
    try {
      await db.initDb();
      await seed();
      app.listen(PORT, () => {
        console.log(`☕ Ochre Coffee Roasters Server running at: http://localhost:${PORT}`);
        console.log(`📱 Customer Menu: http://localhost:${PORT}/`);
        console.log(`🔐 Admin Dashboard: http://localhost:${PORT}/admin`);
        console.log(`💳 UPI Target VPA: ${process.env.UPI_MERCHANT_VPA || '9182916879@ybl'}`);
      });
    } catch (err) {
      console.error('Server startup failed:', err);
      process.exit(1);
    }
  })();
}

module.exports = app;
