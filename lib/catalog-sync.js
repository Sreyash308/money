/**
 * Catalog Sync Module for Ochre Coffee Roasters
 * Ensures all product price, availability, and menu changes made in the Admin Portal
 * are persistently saved to data/menu.json and automatically committed to GitHub.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('../db');

const MENU_FILE_PATH = path.join(__dirname, '../data/menu.json');
const TMP_MENU_PATH = '/tmp/menu.json';
const GITHUB_REPO = process.env.GITHUB_REPO || 'Sreyash308/money';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

let cachedCatalog = null;
let cachedCatalogTime = 0;
const CACHE_TTL_MS = 15000; // 15 seconds in-memory TTL

/**
 * Fetch latest data/menu.json directly from GitHub repository API
 */
async function fetchCatalogFromGitHub() {
  if (process.env.NODE_ENV === 'test') return null;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return null;

  try {
    const filePath = 'data/menu.json';
    const res = await githubApiRequest('GET', `/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`, token);
    if (res.statusCode === 200 && res.body && res.body.content) {
      const decoded = Buffer.from(res.body.content, 'base64').toString('utf8');
      const catalog = JSON.parse(decoded);
      if (catalog && Array.isArray(catalog.products) && catalog.products.length > 0) {
        return catalog;
      }
    }
  } catch (err) {
    console.warn('Could not fetch catalog from GitHub API:', err.message);
  }
  return null;
}

/**
 * Asynchronously load the catalog with real-time GitHub cloud authority and multi-tier fallbacks
 */
async function loadCatalog(options = {}) {
  const force = options.force || false;
  if (!force && cachedCatalog && (Date.now() - cachedCatalogTime < CACHE_TTL_MS)) {
    return cachedCatalog;
  }

  // 1. Primary Authority in Production: Fetch true real-time catalog from GitHub
  if (process.env.NODE_ENV !== 'test') {
    const ghCatalog = await fetchCatalogFromGitHub();
    if (ghCatalog) {
      cachedCatalog = ghCatalog;
      cachedCatalogTime = Date.now();
      saveCatalogToDisk(ghCatalog);
      return ghCatalog;
    }
  }

  // 2. Fallback to /tmp/menu.json (ephemeral but shared across warm invocations in serverless)
  try {
    if (fs.existsSync(TMP_MENU_PATH)) {
      const raw = fs.readFileSync(TMP_MENU_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.products) && parsed.products.length > 0) {
        cachedCatalog = parsed;
        cachedCatalogTime = Date.now();
        return parsed;
      }
    }
  } catch (_) {}

  // 3. Fallback to bundled data/menu.json
  const disk = loadCatalogFromDisk();
  if (disk) {
    cachedCatalog = disk;
    cachedCatalogTime = Date.now();
    return disk;
  }

  return null;
}

/**
 * Load the catalog synchronously from in-memory cache, /tmp, or disk
 */
function loadCatalogFromDisk() {
  if (cachedCatalog) return cachedCatalog;
  try {
    if (fs.existsSync(TMP_MENU_PATH)) {
      const raw = fs.readFileSync(TMP_MENU_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.products)) {
        return parsed;
      }
    }
  } catch (_) {}
  try {
    if (fs.existsSync(MENU_FILE_PATH)) {
      const raw = fs.readFileSync(MENU_FILE_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not read data/menu.json:', err.message);
  }
  return null;
}

/**
 * Export current database catalog to a JSON object
 */
async function exportCatalogFromDb() {
  const categories = await db.all(
    'SELECT id, name, slug, description, sort_order FROM categories WHERE active = 1 ORDER BY sort_order ASC'
  );
  const products = await db.all(
    'SELECT id, name, slug, description, price, image_url, category_id, is_veg, is_cold, origin_tag, sort_order, available FROM products WHERE active = 1 ORDER BY sort_order ASC'
  );
  const tables = await db.all(
    'SELECT table_number, label, capacity FROM restaurant_tables WHERE active = 1 ORDER BY table_number ASC'
  );
  const settingsRows = await db.all('SELECT key, value FROM settings');
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

  return {
    last_synced_at: new Date().toISOString(),
    categories,
    products,
    tables,
    settings
  };
}

/**
 * Save catalog object to in-memory cache, /tmp/menu.json, and data/menu.json on disk
 */
function saveCatalogToDisk(catalog) {
  if (!catalog) return false;
  cachedCatalog = catalog;
  cachedCatalogTime = Date.now();

  // 1. Always save to /tmp/menu.json (always writable in serverless runtime)
  try {
    fs.writeFileSync(TMP_MENU_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  } catch (_) {}

  // 2. Save to local data/menu.json if filesystem is writable
  try {
    const dir = path.dirname(MENU_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(MENU_FILE_PATH, JSON.stringify(catalog, null, 2), 'utf8');
    return true;
  } catch (err) {
    // Read-only filesystem in serverless deployment — handled gracefully
    return false;
  }
}

/**
 * Helper to make HTTPS requests to GitHub API
 */
function githubApiRequest(method, endpoint, token, data = null) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        'User-Agent': 'Ochre-Coffee-Admin-Sync',
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        ...(payload && {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        })
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: parsed });
          } else {
            resolve({ statusCode: res.statusCode, error: parsed });
          }
        } catch (e) {
          resolve({ statusCode: res.statusCode, error: body });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Commit updated data/menu.json directly to GitHub repository
 */
async function syncCatalogToGitHub(catalog, commitMessage = 'chore(menu): update catalog from admin portal') {
  if (process.env.NODE_ENV === 'test') {
    return { success: true, skipped: true };
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    return { success: false, reason: 'GITHUB_TOKEN not configured on server' };
  }

  try {
    const filePath = 'data/menu.json';
    const content = Buffer.from(JSON.stringify(catalog, null, 2), 'utf8').toString('base64');

    // 1. Get current SHA if file exists on GitHub
    let sha = null;
    const getRes = await githubApiRequest('GET', `/repos/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`, token);
    if (getRes.statusCode === 200 && getRes.body && getRes.body.sha) {
      sha = getRes.body.sha;
    }

    // 2. Put file to GitHub
    const putPayload = {
      message: commitMessage,
      content: content,
      branch: GITHUB_BRANCH,
      ...(sha && { sha })
    };

    const putRes = await githubApiRequest('PUT', `/repos/${GITHUB_REPO}/contents/${filePath}`, token, putPayload);

    if (putRes.statusCode === 200 || putRes.statusCode === 201) {
      const commitSha = putRes.body?.commit?.sha || 'synced';
      console.log(`🚀 Catalog automatically synced to GitHub: ${GITHUB_REPO}@${GITHUB_BRANCH} (${commitSha.slice(0, 7)})`);
      return {
        success: true,
        sha: commitSha,
        url: putRes.body?.commit?.html_url
      };
    } else {
      console.warn('⚠️ GitHub API sync warning:', putRes.statusCode, putRes.error?.message || putRes.error);
      return { success: false, error: putRes.error };
    }
  } catch (err) {
    console.error('Error syncing catalog to GitHub:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * High-level helper: export current DB catalog, write to disk, and sync to GitHub
 */
async function exportAndSyncCatalog(options = {}) {
  const catalog = await exportCatalogFromDb();
  saveCatalogToDisk(catalog);

  const commitMsg = options.commitMessage || 'chore(menu): update catalog from admin portal';
  const gitResult = await syncCatalogToGitHub(catalog, commitMsg);

  return {
    catalog,
    git: gitResult
  };
}

module.exports = {
  loadCatalog,
  loadCatalogFromDisk,
  fetchCatalogFromGitHub,
  exportCatalogFromDb,
  saveCatalogToDisk,
  syncCatalogToGitHub,
  exportAndSyncCatalog
};
