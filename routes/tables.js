/**
 * Restaurant Tables Route
 * Returns active tables and live occupancy state.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper to extract all table numbers associated with an order
function parseTableNumbers(ord) {
  const nums = new Set();
  if (ord.table_number) nums.add(parseInt(ord.table_number, 10));
  if (ord.table_numbers) {
    String(ord.table_numbers)
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n))
      .forEach(n => nums.add(n));
  }
  return Array.from(nums);
}

// GET /api/tables - Active tables list with real-time occupancy status (Fully Vacant, Half Occupied, Occupied)
router.get('/', async (req, res) => {
  try {
    const tables = await db.all(
      'SELECT id, table_number, label, capacity FROM restaurant_tables WHERE active = 1 ORDER BY table_number ASC'
    );

    // Fetch active dine-in orders occupying tables
    const activeOrders = await db.all(
      `SELECT id, order_number, table_number, table_numbers, guest_count
       FROM orders
       WHERE order_type = 'DINE_IN'
         AND status IN ('RECEIVED', 'CONFIRMED', 'PREPARING', 'READY')`
    );

    // Map each table to its occupying orders
    const tableOrdersMap = {};
    for (const ord of activeOrders) {
      const associatedTables = parseTableNumbers(ord);
      const isMulti = associatedTables.length > 1;

      for (const tNum of associatedTables) {
        if (!tableOrdersMap[tNum]) tableOrdersMap[tNum] = [];
        tableOrdersMap[tNum].push({
          orderNumber: ord.order_number,
          guestCount: ord.guest_count || null,
          isMultiTable: isMulti,
          linkedTables: associatedTables
        });
      }
    }

    const tablesWithStatus = tables.map(tbl => {
      const ordersAtTable = tableOrdersMap[tbl.table_number] || [];
      const totalCapacity = tbl.capacity;

      let occupiedSeats = 0;
      for (const o of ordersAtTable) {
        if (o.guestCount && o.guestCount > 0) {
          // If order booked multiple tables, distribute guests across them or cap at table capacity
          occupiedSeats += Math.min(o.guestCount, totalCapacity);
        } else {
          // Default to occupying full table if guest count unspecified
          occupiedSeats = totalCapacity;
        }
      }

      // Constrain occupied seats between 0 and totalCapacity
      occupiedSeats = Math.min(occupiedSeats, totalCapacity);
      const availableSeats = Math.max(0, totalCapacity - occupiedSeats);

      let occupancyStatus = 'FULLY_VACANT';
      let statusLabel = 'Fully Vacant';

      if (ordersAtTable.length > 0) {
        if (availableSeats === 0 || occupiedSeats >= totalCapacity) {
          occupancyStatus = 'OCCUPIED';
          statusLabel = 'Occupied';
        } else {
          occupancyStatus = 'HALF_OCCUPIED';
          statusLabel = 'Half Occupied';
        }
      }

      return {
        id: tbl.id,
        tableNumber: tbl.table_number,
        label: tbl.label,
        capacity: totalCapacity,
        occupiedSeats,
        availableSeats,
        occupancyStatus, // 'FULLY_VACANT' | 'HALF_OCCUPIED' | 'OCCUPIED'
        statusLabel,
        isOccupied: ordersAtTable.length > 0,
        isFullyOccupied: occupancyStatus === 'OCCUPIED',
        isHalfOccupied: occupancyStatus === 'HALF_OCCUPIED',
        isFullyVacant: occupancyStatus === 'FULLY_VACANT',
        activeOrderNumber: ordersAtTable.length > 0 ? ordersAtTable[0].orderNumber : null,
        activeOrders: ordersAtTable
      };
    });

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
