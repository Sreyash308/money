/**
 * Admin Authentication Middleware
 * Validates JWT token from Authorization header or HTTP-only cookie.
 */

const jwt = require('jsonwebtoken');

function requireAdmin(req, res, next) {
  let token = null;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Admin authentication required.'
      }
    });
  }

  try {
    const secret = process.env.ADMIN_JWT_SECRET || 'super-secret-jwt-key-ochre-coffee-roasters-2026';
    const decoded = jwt.verify(token, secret);
    req.adminUser = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired session. Please log in again.'
      }
    });
  }
}

module.exports = { requireAdmin };
