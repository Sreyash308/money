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
const GITHUB_REPO = process.env.GITHUB_REPO || 'Sreyash308/money';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

/**
 * Load the catalog from data/menu.json
 */
function loadCatalogFromDisk() {
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
 * Save catalog object to data/menu.json on disk
 */
function saveCatalogToDisk(catalog) {
  try {
    const dir = path.dirname(MENU_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(MENU_FILE_PATH, JSON.stringify(catalog, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn('Could not write data/menu.json to disk (filesystem might be read-only):', err.message);
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
  loadCatalogFromDisk,
  exportCatalogFromDb,
  saveCatalogToDisk,
  syncCatalogToGitHub,
  exportAndSyncCatalog
};
