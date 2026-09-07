-- Ochre Coffee Roasters Database Schema
-- Compatible with SQLite (local development) and PostgreSQL (production)

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  image_url TEXT,
  category_id TEXT NOT NULL REFERENCES categories(id),
  is_veg INTEGER DEFAULT 1,
  is_cold INTEGER DEFAULT 0,
  origin_tag TEXT,
  available INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  table_number INTEGER UNIQUE NOT NULL,
  label TEXT NOT NULL,
  capacity INTEGER DEFAULT 4,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  order_type TEXT NOT NULL,
  table_id TEXT,
  table_number INTEGER,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  payment_method TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax INTEGER DEFAULT 0,
  discount INTEGER DEFAULT 0,
  total INTEGER NOT NULL,
  notes TEXT,
  admin_notes TEXT,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  unit_price_snapshot INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT DEFAULT 'RAZORPAY',
  provider_order_id TEXT,
  provider_payment_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'INR',
  status TEXT NOT NULL,
  method TEXT NOT NULL,
  raw_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'OWNER',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
