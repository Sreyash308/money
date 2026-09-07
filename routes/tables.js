/**
 * Restaurant Tables Route
 * Returns active tables and live occupancy state.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/tables - Active tables list with real-time occupancy status
router.get('/', async (req, res) => {
  try {
    const tables = await db.all(
      'SELECT id, table_number, label, capacity FROM restaurant_tables WHERE active = 1 ORDER BY table_number ASC'
    );

    // Fetch active dine-in orders that are currently occupying tables
    const activeOrders = await db.all(
      `SELECT table_number, order_number
       FROM orders
       WHERE order_type = 'DINE_IN'
         AND status IN ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY')`
    );

    const activeMap = {};
    for (const ord of activeOrders) {
      if (ord.table_number) {
        activeMap[ord.table_number] = ord.order_number;
      }
    }

    const tablesWithStatus = tables.map(tbl => ({
      id: tbl.id,
      tableNumber: tbl.table_number,
      label: tbl.label,
      capacity: tbl.capacity,
      isOccupied: Boolean(activeMap[tbl.table_number]),
      activeOrderNumber: activeMap[tbl.table_number] || null
    }));

    res.json({
      success: true,
      data: tablesWithStatus
    });
  } catch (err) {
    console.error('Error fetching tables:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to load restaurant tables.' }
    });
  }
});

module.exports = router;
