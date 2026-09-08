/**
 * Vercel Serverless Function Entry Point
 * Routes all API requests to the Express server with cold-start DB initialization.
 */

const app = require('../server');
const db = require('../db');
const { seed } = require('../db/seed');

let isInitialized = false;

module.exports = async (req, res) => {
  if (!isInitialized) {
    try {
      await db.initDb();
      await seed();
      isInitialized = true;
    } catch (e) {
      if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL && process.env.ENFORCE_PRODUCTION_POSTGRES === 'true') {
        return res.status(500).json({
          success: false,
          error: {
            code: 'DATABASE_CONFIGURATION_REQUIRED',
            message: 'Production deployment requires a valid DATABASE_URL (PostgreSQL). Ephemeral storage is disabled.'
          }
        });
      }
      console.warn('Serverless DB cold start init check:', e.message);
    }
  }
  return app(req, res);
};
