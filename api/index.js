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
      console.warn('Serverless DB cold start init check:', e.message);
    }
  }
  return app(req, res);
};
