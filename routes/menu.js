/**
 * Public Menu Routes
 * Provides categories, menu items, real-time availability states,
 * and Server-Sent Events (SSE) stream for instant synchronization.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

let currentMenuVersion = Date.now();
const sseClients = new Set();

function notifyMenuChange(changeDetails = {}) {
  currentMenuVersion = Date.now();
  const payload = JSON.stringify({
    type: 'MENU_UPDATE',
    version: currentMenuVersion,
    timestamp: new Date().toISOString(),
    change: changeDetails
  });

  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// GET /api/menu/version - Fast version check (for ultra-low latency polling)
router.get('/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    success: true,
    data: {
      version: currentMenuVersion
    }
  });
});

// GET /api/menu/events - Server-Sent Events (SSE) stream for instant real-time sync
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Flush headers if supported
  if (res.flushHeaders) res.flushHeaders();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', version: currentMenuVersion })}\n\n`);

  sseClients.add(res);

  // Heartbeat ping every 15s to keep connection active
  const heartbeat = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch (e) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// GET /api/menu - Public menu catalog
router.get('/', async (req, res) => {
  try {
    const categories = await db.all(
      'SELECT id, name, slug, description, sort_order FROM categories WHERE active = 1 ORDER BY sort_order ASC'
    );

    const products = await db.all(
      `SELECT id, name, slug, description, price, image_url, category_id,
              is_veg, is_cold, origin_tag, available, sort_order
       FROM products
       WHERE active = 1
       ORDER BY sort_order ASC`
    );

    // Prevent aggressive client-side caching of availability states
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Menu-Version', currentMenuVersion.toString());

    res.json({
      success: true,
      data: {
        version: currentMenuVersion,
        categories,
        products
      }
    });
  } catch (err) {
    console.error('Error fetching menu:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to load menu items.' }
    });
  }
});

module.exports = router;
module.exports.notifyMenuChange = notifyMenuChange;
module.exports.getMenuVersion = () => currentMenuVersion;

