/**
 * Database Seeder for Ochre Coffee Roasters
 * Idempotently populates initial categories, cafe products, tables, admin user, and settings.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./index');

async function seed() {
  console.log('🌱 Starting database seed...');
  await db.initDb();

  const now = new Date().toISOString();
  const diskCatalog = await require('../lib/catalog-sync').loadCatalog();
  
  // 1. Categories
  const categories = diskCatalog?.categories || [
    { id: 'cat_coffee', name: 'Coffee & Brews', slug: 'coffee', description: 'Single-origin pour overs, slow cold brews & artisanal espresso', sort_order: 1 },
    { id: 'cat_cold', name: 'Coolers & Iced', slug: 'cold', description: 'Handcrafted iced teas, fruit sodas and ceremonial matcha', sort_order: 2 },
    { id: 'cat_tea', name: 'Tea & Infusions', slug: 'tea', description: 'Estate orthodox teas, spiced pots and herbal botanical tisanes', sort_order: 3 },
    { id: 'cat_food', name: 'Kitchen & Bites', slug: 'food', description: 'Slow-fermented sourdough toasties, spicy wraps and seasoned fries', sort_order: 4 },
    { id: 'cat_dessert', name: 'Bakery & Sweet', slug: 'dessert', description: 'Warm dark chocolate brownies and fresh morning bakes', sort_order: 5 },
  ];

  for (const cat of categories) {
    const existing = await db.get('SELECT id FROM categories WHERE slug = ?', [cat.slug]);
    if (!existing) {
      await db.run(
        `INSERT INTO categories (id, name, slug, description, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [cat.id, cat.name, cat.slug, cat.description, cat.sort_order || cat.sortOrder || 1, now, now]
      );
      console.log(`  + Category: ${cat.name}`);
    }
  }

  // 2. Products (Loaded from data/menu.json with fallback)
  const products = diskCatalog?.products || [
    // Coffee & Brews
    {
      id: 'prod_caramel_latte',
      name: 'Caramel Latte',
      slug: 'caramel-latte',
      description: 'Smooth espresso, golden house caramel reduction, and silky steamed whole milk.',
      price: 189,
      imageUrl: 'assets/coffee_mug.png',
      categoryId: 'cat_coffee',
      isVeg: 1,
      isCold: 0,
      originTag: 'Chikmagalur Washed Lot',
      sortOrder: 1
    },
    {
      id: 'prod_hazelnut_mocha',
      name: 'Hazelnut Mocha',
      slug: 'hazelnut-mocha',
      description: 'Rich Valrhona dark cocoa blended with toasted hazelnut puree and espresso.',
      price: 199,
      imageUrl: 'assets/coffee_mug.png',
      categoryId: 'cat_coffee',
      isVeg: 1,
      isCold: 0,
      originTag: 'Dark Roast · Velvety',
      sortOrder: 2
    },
    {
      id: 'prod_spanish_cold_brew',
      name: 'Spanish Cold Brew',
      slug: 'spanish-cold-brew',
      description: '18-hour cold brew concentrate with sweetened condensed milk and slow-melting ice.',
      price: 199,
      imageUrl: 'assets/iced_coffee.png',
      categoryId: 'cat_coffee',
      isVeg: 1,
      isCold: 1,
      originTag: 'Signature Cold Pour',
      sortOrder: 3
    },
    {
      id: 'prod_oat_milk_cappuccino',
      name: 'Oat Milk Cappuccino',
      slug: 'oat-milk-cappuccino',
      description: 'Creamy, cozy & totally dreamy. Barista oat milk microfoam with a dusting of nutmeg.',
      price: 189,
      imageUrl: 'assets/coffee_mug.png',
      categoryId: 'cat_coffee',
      isVeg: 1,
      isCold: 0,
      originTag: 'Dairy-Free · Gentle Roast',
      sortOrder: 4
    },
    {
      id: 'prod_vanilla_cinnamon_latte',
      name: 'Vanilla Cinnamon Latte',
      slug: 'vanilla-cinnamon-latte',
      description: 'Warm Madagascar vanilla infusion with freshly ground Ceylon cinnamon bark.',
      price: 199,
      imageUrl: 'assets/coffee_mug.png',
      categoryId: 'cat_coffee',
      isVeg: 1,
      isCold: 0,
      originTag: 'Spiced & Comforting',
      sortOrder: 5
    },
    {
      id: 'prod_pour_over_v60',
      name: 'Single-Origin Pour Over (V60)',
      slug: 'single-origin-pour-over',
      description: 'Hand-brewed filter coffee showcasing vibrant jasmine, bergamot, and sweet stone fruit notes.',
      price: 210,
      imageUrl: 'assets/coffee_mug.png',
      categoryId: 'cat_coffee',
      isVeg: 1,
      isCold: 0,
      originTag: 'Light Roast · Complex',
      sortOrder: 6
    },
    {
      id: 'prod_aeropress_reserve',
      name: 'AeroPress Reserve',
      slug: 'aeropress-reserve',
      description: 'Immersion brewed cup with round body, black tea sweetness, and crisp green apple finish.',
      price: 210,
      imageUrl: 'assets/coffee_mug.png',
      categoryId: 'cat_coffee',
      isVeg: 1,
      isCold: 0,
      originTag: 'Medium-Light Roast',
      sortOrder: 7
    },

    // Coolers & Iced
    {
      id: 'prod_cascara_fizz',
      name: 'Cascara Coffee Cherry Fizz',
      slug: 'cascara-fizz',
      description: 'Sparkling infusion of upcycled coffee fruit husks, wild mountain honey, and Persian lime.',
      price: 179,
      imageUrl: 'assets/iced_coffee.png',
      categoryId: 'cat_cold',
      isVeg: 1,
      isCold: 1,
      originTag: 'Fruity & Effervescent',
      sortOrder: 8
    },
    {
      id: 'prod_yuzu_espresso_tonic',
      name: 'Yuzu Cold Espresso Tonic',
      slug: 'yuzu-espresso-tonic',
      description: 'Layered double shot espresso over bitter botanical tonic water and Japanese yuzu citrus.',
      price: 199,
      imageUrl: 'assets/iced_coffee.png',
      categoryId: 'cat_cold',
      isVeg: 1,
      isCold: 1,
      originTag: 'Crisp & Uplifting',
      sortOrder: 9
    },
    {
      id: 'prod_ceremonial_matcha',
      name: 'Iced Ceremonial Matcha',
      slug: 'iced-matcha-latte',
      description: 'First-harvest Uji matcha hand-whisked and poured over ice with velvety oat milk.',
      price: 220,
      imageUrl: 'assets/iced_coffee.png',
      categoryId: 'cat_cold',
      isVeg: 1,
      isCold: 1,
      originTag: 'Uji Kyoto · Stone Ground',
      sortOrder: 10
    },

    // Tea & Infusions
    {
      id: 'prod_first_flush_darjeeling',
      name: 'Spring First Flush Darjeeling',
      slug: 'first-flush-darjeeling',
      description: 'Delicate muscatel grape notes with a pale golden liquor from high-altitude Himalayan estates.',
      price: 169,
      imageUrl: 'assets/coffee_mug.png',
      categoryId: 'cat_tea',
      isVeg: 1,
      isCold: 0,
      originTag: 'Whole Leaf · Orthodox',
      sortOrder: 11
    },
    {
      id: 'prod_masala_chai_roasters',
      name: 'Roasters Pot Masala Chai',
      slug: 'masala-chai',
      description: 'Assam orthodox black tea slow-simmered with crushed green cardamom, fresh ginger & whole milk.',
      price: 139,
      imageUrl: 'assets/coffee_mug.png',
      categoryId: 'cat_tea',
      isVeg: 1,
      isCold: 0,
      originTag: 'Fragrant & Comforting',
      sortOrder: 12
    },
    {
      id: 'prod_hibiscus_berry_tisane',
      name: 'Wild Hibiscus Berry Tisane',
      slug: 'hibiscus-berry-tisane',
      description: 'Caffeine-free ruby crimson infusion of Egyptian hibiscus calyces and crushed summer berries.',
      price: 159,
      imageUrl: 'assets/iced_coffee.png',
      categoryId: 'cat_tea',
      isVeg: 1,
      isCold: 1,
      originTag: 'Floral & Tart',
      sortOrder: 13
    },

    // Kitchen & Bites
    {
      id: 'prod_grilled_cheese',
      name: 'Grilled Cheese Sandwich',
      slug: 'grilled-cheese-sandwich',
      description: 'Classic comfort. Sharp cheddar and mozzarella melted inside toasted country sourdough.',
      price: 149,
      imageUrl: 'assets/sandwich_fries.png',
      categoryId: 'cat_food',
      isVeg: 1,
      isCold: 0,
      originTag: 'With Garlic Herb Dip',
      sortOrder: 14
    },
    {
      id: 'prod_paneer_tikka_wrap',
      name: 'Paneer Tikka Wrap',
      slug: 'paneer-tikka-wrap',
      description: 'Tandoor-marinated cottage cheese cubes, charred bell peppers, mint emulsion in whole-wheat flatbread.',
      price: 169,
      imageUrl: 'assets/sandwich_fries.png',
      categoryId: 'cat_food',
      isVeg: 1,
      isCold: 0,
      originTag: 'Spicy, Wholesome & Satisfying',
      sortOrder: 15
    },
    {
      id: 'prod_peri_peri_fries',
      name: 'Crispy Peri Peri Fries',
      slug: 'peri-peri-fries',
      description: 'Thick cut Idaho potatoes twice-fried and tossed in house-blended African peri peri spices.',
      price: 129,
      imageUrl: 'assets/sandwich_fries.png',
      categoryId: 'cat_food',
      isVeg: 1,
      isCold: 0,
      originTag: 'Served in Ceramic Cup',
      sortOrder: 16
    },

    // Bakery & Sweet
    {
      id: 'prod_chocolate_brownie',
      name: 'Fudgy Chocolate Brownie',
      slug: 'chocolate-brownie',
      description: 'Belgian 70% dark chocolate brownie with sea salt flakes. Served warm with vanilla bean gelato.',
      price: 99,
      imageUrl: 'assets/gallery_pastry.jpg',
      categoryId: 'cat_dessert',
      isVeg: 1,
      isCold: 0,
      originTag: 'Melts in Your Mouth',
      sortOrder: 17
    }
  ];

  for (const prod of products) {
    const existing = await db.get('SELECT id FROM products WHERE id = ? OR slug = ?', [prod.id, prod.slug]);
    const isVeg = prod.isVeg !== undefined ? prod.isVeg : (prod.is_veg !== undefined ? prod.is_veg : 1);
    const isCold = prod.isCold !== undefined ? prod.isCold : (prod.is_cold !== undefined ? prod.is_cold : 0);
    const imgUrl = prod.imageUrl || prod.image_url || 'assets/coffee_mug.png';
    const catId = prod.categoryId || prod.category_id || 'cat_coffee';
    const originTag = prod.originTag || prod.origin_tag || '';
    const sortOrder = prod.sortOrder || prod.sort_order || 99;
    const available = prod.available !== undefined ? (prod.available ? 1 : 0) : 1;

    if (!existing) {
      await db.run(
        `INSERT INTO products (
          id, name, slug, description, price, image_url, category_id,
          is_veg, is_cold, origin_tag, available, active, sort_order,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          prod.id, prod.name, prod.slug, prod.description, prod.price, imgUrl, catId,
          isVeg, isCold, originTag, available, sortOrder, now, now
        ]
      );
      console.log(`  + Product: ${prod.name} (₹${prod.price})`);
    } else {
      // Synchronize updated prices/availability from data/menu.json so changes made in admin portal stay intact
      await db.run(
        `UPDATE products
         SET name = ?, description = ?, price = ?, image_url = ?, category_id = ?,
             is_veg = ?, is_cold = ?, origin_tag = ?, available = ?, sort_order = ?, updated_at = ?
         WHERE id = ?`,
        [
          prod.name, prod.description, prod.price, imgUrl, catId,
          isVeg, isCold, originTag, available, sortOrder, now, existing.id
        ]
      );
    }
  }

  // 3. Tables (10 restaurant tables)
  const tables = [
    { number: 1, label: 'Table 01 (Window Nook)', capacity: 2 },
    { number: 2, label: 'Table 02 (Window Nook)', capacity: 2 },
    { number: 3, label: 'Table 03 (Garden View)', capacity: 4 },
    { number: 4, label: 'Table 04 (Garden View)', capacity: 4 },
    { number: 5, label: 'Table 05 (Center Hall)', capacity: 4 },
    { number: 6, label: 'Table 06 (Quiet Booth)', capacity: 6 },
    { number: 7, label: 'Table 07 (Quiet Booth)', capacity: 6 },
    { number: 8, label: 'Table 08 (Espresso Bar)', capacity: 2 },
    { number: 9, label: 'Table 09 (Roastery View)', capacity: 4 },
    { number: 10, label: 'Table 10 (Communal Oak)', capacity: 8 },
  ];

  for (const tbl of tables) {
    const existing = await db.get('SELECT id FROM restaurant_tables WHERE table_number = ?', [tbl.number]);
    if (!existing) {
      const id = `tbl_${tbl.number}`;
      await db.run(
        `INSERT INTO restaurant_tables (id, table_number, label, capacity, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [id, tbl.number, tbl.label, tbl.capacity, now, now]
      );
      console.log(`  + Table: ${tbl.label}`);
    }
  }

  // 4. Admin User
  const adminEmail = process.env.ADMIN_EMAIL || 'owner@ochrecoffee.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'OchreCoffee#2026Secure';
  const existingAdmin = await db.get('SELECT id FROM admin_users WHERE email = ?', [adminEmail]);

  if (!existingAdmin) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(adminPassword, salt);
    const adminId = 'usr_admin_' + crypto.randomUUID().slice(0, 8);
    await db.run(
      `INSERT INTO admin_users (id, username, email, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, 'OWNER', ?)`,
      [adminId, 'ochre_admin', adminEmail, hash, now]
    );
    console.log(`  + Admin User verified: ${adminEmail}`);
  }

  // Cashier User
  const cashierEmail = process.env.CASHIER_EMAIL || 'cashier@ochrecoffee.com';
  const cashierPassword = process.env.CASHIER_PASSWORD || 'ochreCashier2026!';
  const existingCashier = await db.get('SELECT id FROM admin_users WHERE email = ?', [cashierEmail]);

  if (!existingCashier) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(cashierPassword, salt);
    const cashierId = 'usr_cashier_' + crypto.randomUUID().slice(0, 8);
    await db.run(
      `INSERT INTO admin_users (id, username, email, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, 'CASHIER', ?)`,
      [cashierId, 'ochre_cashier', cashierEmail, hash, now]
    );
    console.log(`  + Cashier User verified: ${cashierEmail}`);
  }

  // 5. Settings
  const initialSettings = [
    { key: 'restaurant_status', value: 'OPEN' },
    { key: 'restaurant_name', value: 'Ochre Coffee Roasters' },
    { key: 'phone', value: '+91-98765-43210' },
    { key: 'destination_vpa', value: process.env.UPI_MERCHANT_VPA || '9182916879@ybl' },
    { key: 'currency', value: 'INR' },
    { key: 'currency_symbol', value: '₹' }
  ];

  for (const set of initialSettings) {
    const existing = await db.get('SELECT key FROM settings WHERE key = ?', [set.key]);
    if (!existing) {
      await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [set.key, set.value, now]);
    }
  }

  console.log('✨ Database seeding complete!');
}

if (require.main === module) {
  seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}

module.exports = { seed };
