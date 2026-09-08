/**
 * Production-Hardened Authentication & Authorization Middleware
 * Ochre Coffee Roasters
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_ISSUER = 'ochre-coffee-roasters';
const JWT_AUDIENCE = 'ochre-admin';
let devEphemeralSecret = null;

function getJwtSecret() {
  const envSecret = process.env.ADMIN_JWT_SECRET ? process.env.ADMIN_JWT_SECRET.trim() : '';

  if (process.env.NODE_ENV === 'production') {
    if (!envSecret || envSecret.length < 32) {
      throw new Error('CRITICAL SECURITY ERROR: ADMIN_JWT_SECRET environment variable is missing or too weak (must be >= 32 chars) in production.');
    }
    return envSecret;
  }

  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }

  // Development/Test fallback with warning
  if (!devEphemeralSecret) {
    devEphemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn('⚠️  [SECURITY WARNING] Using ephemeral ADMIN_JWT_SECRET for development/testing.');
  }
  return devEphemeralSecret;
}

/**
 * Generate CSRF Token
 */
function generateCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * CSRF Protection Middleware
 * Verifies CSRF token when authentication relies on ambient HTTP-only cookies.
 */
function verifyCsrfToken(req, res, next) {
  // Safe HTTP methods do not mutate state
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // If request is authenticated via Bearer header (programmatic API / tests), ambient CSRF attack is impossible
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return next();
  }

  // If cookie auth was used, CSRF validation is strictly required
  if (req.cookies && req.cookies.admin_token) {
    const headerToken = req.headers['x-csrf-token'];
    const cookieToken = req.cookies.ochre_csrf;

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'CSRF_INVALID',
          message: 'Invalid or missing CSRF token.'
        }
      });
    }

    // Defense-in-depth: Origin verification
    const origin = req.headers.origin;
    if (origin) {
      const allowedOrigins = [
        process.env.APP_ORIGIN,
        process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []
      ].flat().filter(Boolean);

      // In local dev, allow localhost
      if (process.env.NODE_ENV !== 'production') {
        allowedOrigins.push('http://localhost:8000', 'http://127.0.0.1:8000');
      }

      const originHost = new URL(origin).host;
      const reqHost = req.headers.host;
      if (originHost !== reqHost && !allowedOrigins.includes(origin)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ORIGIN_MISMATCH',
            message: 'Cross-origin request rejected.'
          }
        });
      }
    }
  }

  next();
}

/**
 * Authentication Middleware: Requires valid admin session (Owner or Cashier)
 */
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
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

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

/**
 * Role-Based Access Control: Require specific role
 */
function requireRole(role) {
  return (req, res, next) => {
    const checkRole = () => {
      if (!req.adminUser) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required.' }
        });
      }

      if (req.adminUser.role !== role && req.adminUser.role !== 'OWNER') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Access denied. Requires ${role} role.`
          }
        });
      }

      next();
    };

    if (!req.adminUser) {
      return requireAdmin(req, res, checkRole);
    }
    checkRole();
  };
}

const requireOwner = requireRole('OWNER');

module.exports = {
  requireAdmin,
  requireRole,
  requireOwner,
  getJwtSecret,
  generateCsrfToken,
  verifyCsrfToken,
  JWT_ISSUER,
  JWT_AUDIENCE
};

