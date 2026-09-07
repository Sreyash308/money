/**
 * Public Menu Routes
 * Provides categories, menu items, and real-time availability states.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

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

    res.json({
      success: true,
      data: {
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
