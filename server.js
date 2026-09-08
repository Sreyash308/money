/**
 * Ochre Coffee Roasters Server
 * Express application serving static frontend and REST API routes.
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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

// Security Headers via Helmet with tailored CSP for Ochre frontend assets
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // Required for inline initialization scripts in index/order/admin HTML
          "https://checkout.razorpay.com"
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "data:"
        ],
        imgSrc: [
          "'self'",
          "data:",
          "https:"
        ],
        connectSrc: [
          "'self'",
          "https://api.razorpay.com",
          "https://checkout.razorpay.com",
          "wss:",
          "ws:"
        ],
        frameSrc: [
          "'self'",
          "https://api.razorpay.com"
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// Request ID & Correlation Tracking
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Environment-aware Strict CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  : [process.env.APP_ORIGIN].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-order-token', 'x-csrf-token', 'x-idempotency-key']
};
app.use(cors(corsOptions));
app.use(cookieParser());

// Webhook raw body handling before json parser (must preserve exact unparsed payload for HMAC)
app.use('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '500kb' }));

// Request body size limits to prevent payload exhaustion attacks
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Rate Limiters for High-Risk Endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Please try again in 15 minutes.' }
  }
});

const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many order requests. Please slow down.' }
  }
});

const utrLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many payment verification requests. Please try again later.' }
  }
});

// Mount Rate Limiters
app.use('/api/admin/login', loginLimiter);
app.use('/api/orders', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/') {
    return orderLimiter(req, res, next);
  }
  next();
});
app.use('/api/payments/submit-utr', utrLimiter);

// API Route Mounts
app.use('/api/menu', menuRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', adminRouter);

// Razorpay Standard Checkout Direct API Endpoints
app.post('/api/create-order', paymentsRouter.handleCreateOrder);
app.post('/api/verify-payment', paymentsRouter.handleVerifyPayment);


// Health & Readiness Endpoints (Safe disclosure, no secrets)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/health/live', (req, res) => {
  res.json({ status: 'live' });
});

app.get('/api/health/ready', async (req, res) => {
  try {
    await db.get('SELECT 1');
    res.json({ status: 'ready', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'unavailable', error: 'Database disconnected' });
  }
});

// Robots.txt & Security.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    'User-agent: *\nDisallow: /admin\nDisallow: /cashier\nDisallow: /order/\nDisallow: /api/\nAllow: /\n'
  );
});

app.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain').send(
    'Contact: mailto:security@ochrecoffee.com\nExpires: 2027-12-31T23:59:59.000Z\nPreferred-Languages: en\n'
  );
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

// Centralized Express Error Handling Middleware
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required.' }
    });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: { code: 'CORS_ERROR', message: 'Origin not allowed.' }
    });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload too large.' }
    });
  }

  // Safe server log (no secrets or sensitive PII)
  console.error(`[Server Error] [Req: ${req.id || 'N/A'}] ${req.method} ${req.path}:`, err.message);

  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'SERVER_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred. Please try again.'
        : (err.message || 'Internal server error.')
    }
  });
});

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
