const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function getJwtSecret() {
  if (process.env.ADMIN_JWT_SECRET && process.env.ADMIN_JWT_SECRET.trim().length > 0) {
    return process.env.ADMIN_JWT_SECRET.trim();
  }
  if (!global.__ochreAdminJwtSecret) {
    global.__ochreAdminJwtSecret = crypto.randomBytes(32).toString('hex');
  }
  return global.__ochreAdminJwtSecret;
}

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
    const secret = getJwtSecret();
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

module.exports = { requireAdmin, getJwtSecret };
