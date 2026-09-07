/**
 * Safe Order History Reset Script for Ochre Coffee Roasters
 * 
 * Safely purges all old/demo orders, order items, payment records,
 * and webhook event logs while preserving:
 * - Products & Menu Catalog
 * - Categories
 * - Restaurant Tables
 * - Admin Accounts & Credentials
 * - System Settings
 */

const db = require('./index');

async function resetOrders() {
  console.log('🧹 Starting safe order history purge...');
  await db.initDb();

  await db.transaction(async (tx) => {
    // 1. Delete order items
    const delItems = await tx.run('DELETE FROM order_items');
    console.log(`  - Deleted ${delItems.changes} order items`);

    // 2. Delete payment records
    const delPayments = await tx.run('DELETE FROM payments');
    console.log(`  - Deleted ${delPayments.changes} payment records`);

    // 3. Delete webhook events
    const delWebhooks = await tx.run('DELETE FROM webhook_events');
    console.log(`  - Deleted ${delWebhooks.changes} webhook events`);

    // 4. Delete orders
    const delOrders = await tx.run('DELETE FROM orders');
    console.log(`  - Deleted ${delOrders.changes} orders`);
  });

  // Reset sqlite_sequence for orders if applicable
  if (db.dbType === 'sqlite') {
    try {
      await db.run("DELETE FROM sqlite_sequence WHERE name IN ('orders', 'order_items', 'payments', 'webhook_events')");
    } catch (e) {
      // Ignored if sqlite_sequence does not exist
    }
  }

  const remainingOrders = await db.get('SELECT COUNT(*) as count FROM orders');
  const productsCount = await db.get('SELECT COUNT(*) as count FROM products WHERE active = 1');
  const tablesCount = await db.get('SELECT COUNT(*) as count FROM restaurant_tables WHERE active = 1');

  console.log('✅ Order history purge completed successfully:');
  console.log(`  • Orders in DB: ${remainingOrders.count}`);
  console.log(`  • Active Products retained: ${productsCount.count}`);
  console.log(`  • Restaurant Tables retained: ${tablesCount.count}`);
  console.log('🚀 Ready for genuine production orders!');
}

if (require.main === module) {
  resetOrders()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Purge error:', err);
      process.exit(1);
    });
}

module.exports = { resetOrders };
