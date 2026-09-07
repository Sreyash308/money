/**
 * Universal Database Layer for Ochre Coffee Roasters
 * Automatically uses Node 26 native SQLite for local zero-config dev
 * and standard PostgreSQL pool when DATABASE_URL is provided (e.g. Vercel/Supabase/Neon).
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

let dbType = 'sqlite';
let sqliteDb = null;
let pgPool = null;

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
  dbType = 'postgres';
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('✅ Database: Connected via PostgreSQL');
} else {
  dbType = 'sqlite';
  const { DatabaseSync } = require('node:sqlite');
  
  let dbPath;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // Vercel Serverless environment: filesystem under /var/task is read-only, use /tmp
    dbPath = '/tmp/ochre.db';
    const bundledDb = path.join(__dirname, '..', 'data', 'ochre.db');
    if (!fs.existsSync(dbPath) && fs.existsSync(bundledDb)) {
      try {
        fs.copyFileSync(bundledDb, dbPath);
      } catch (e) {
        console.warn('Could not copy bundled db to /tmp, will initialize fresh:', e.message);
      }
    }
  } else {
    // Local environment: use local data/ directory
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    dbPath = path.join(dataDir, 'ochre.db');
  }

  sqliteDb = new DatabaseSync(dbPath);
  try {
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
  } catch (e) {
    // Some tmp filesystems don't support WAL, ignore error
  }
  console.log(`✅ Database: Connected via native SQLite (${dbPath})`);
}

/**
 * Normalizes SQL queries:
 * In SQLite: ? is standard.
 * In Postgres: ? is converted to $1, $2, $3...
 */
function normalizeSql(sql, targetType) {
  if (targetType !== 'postgres') return sql;
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

/**
 * Execute a query that returns multiple rows
 */
async function all(sql, params = []) {
  if (dbType === 'sqlite') {
    const stmt = sqliteDb.prepare(sql);
    return stmt.all(...params);
  } else {
    const pSql = normalizeSql(sql, 'postgres');
    const res = await pgPool.query(pSql, params);
    return res.rows;
  }
}

/**
 * Execute a query that returns a single row
 */
async function get(sql, params = []) {
  if (dbType === 'sqlite') {
    const stmt = sqliteDb.prepare(sql);
    return stmt.get(...params) || null;
  } else {
    const pSql = normalizeSql(sql, 'postgres');
    const res = await pgPool.query(pSql, params);
    return res.rows[0] || null;
  }
}

/**
 * Execute an INSERT, UPDATE, or DELETE query
 */
async function run(sql, params = []) {
  if (dbType === 'sqlite') {
    const stmt = sqliteDb.prepare(sql);
    const result = stmt.run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  } else {
    const pSql = normalizeSql(sql, 'postgres');
    const res = await pgPool.query(pSql, params);
    return { changes: res.rowCount, lastInsertRowid: null };
  }
}

/**
 * Execute raw DDL statements (e.g. schema migrations)
 */
async function exec(sql) {
  if (dbType === 'sqlite') {
    sqliteDb.exec(sql);
  } else {
    await pgPool.query(sql);
  }
}

/**
 * Run a callback inside a transaction
 */
async function transaction(callback) {
  if (dbType === 'sqlite') {
    sqliteDb.exec('BEGIN TRANSACTION');
    try {
      const result = await callback({ all, get, run });
      sqliteDb.exec('COMMIT');
      return result;
    } catch (err) {
      sqliteDb.exec('ROLLBACK');
      throw err;
    }
  } else {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const txHelpers = {
        all: async (sql, params = []) => (await client.query(normalizeSql(sql, 'postgres'), params)).rows,
        get: async (sql, params = []) => (await client.query(normalizeSql(sql, 'postgres'), params)).rows[0] || null,
        run: async (sql, params = []) => {
          const r = await client.query(normalizeSql(sql, 'postgres'), params);
          return { changes: r.rowCount };
        }
      };
      const result = await callback(txHelpers);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * Initialize database schema if not already present
 */
async function initDb() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  
  if (dbType === 'sqlite') {
    // 1. Safe column migrations if orders table already exists
    try {
      const hasOrders = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'").get();
      if (hasOrders) {
        const tableInfo = sqliteDb.prepare("PRAGMA table_info(orders)").all();
        const columnNames = tableInfo.map(c => c.name);

        if (!columnNames.includes('customer_utr')) {
          sqliteDb.exec("ALTER TABLE orders ADD COLUMN customer_utr TEXT;");
        }
        if (!columnNames.includes('idempotency_key')) {
          sqliteDb.exec("ALTER TABLE orders ADD COLUMN idempotency_key TEXT;");
        }
      }
    } catch (migErr) {
      console.warn('Migration note:', migErr.message);
    }

    // 2. Execute schema (tables and indexes)
    sqliteDb.exec(schemaSql);
  } else {
    await pgPool.query(schemaSql);
  }
  console.log('✅ Database schema verified.');
}

module.exports = {
  dbType,
  all,
  get,
  run,
  exec,
  transaction,
  initDb
};
