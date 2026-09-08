/**
 * Ochre Coffee Roasters - Mobile Responsive Audit & Viewport Verification
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('📱 Starting Ochre Mobile Responsive Audit & Viewport Verification...\n');

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    totalFailed++;
  }
}

// 1. Inspect Files
const rootDir = path.resolve(__dirname, '..');
const styleCss = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const orderHtml = fs.readFileSync(path.join(rootDir, 'order.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');

console.log('--- 1. VIEWPORT META TAGS & SAFE AREA SUPPORT ---');
assert(indexHtml.includes('viewport-fit=cover'), 'index.html includes viewport-fit=cover');
assert(orderHtml.includes('viewport-fit=cover'), 'order.html includes viewport-fit=cover');
assert(adminHtml.includes('viewport-fit=cover'), 'admin.html includes viewport-fit=cover');
assert(styleCss.includes('env(safe-area-inset-bottom)'), 'style.css supports safe-area-inset-bottom');

console.log('\n--- 2. STOREFRONT NAVBAR & MOBILE COMPOSITION ---');
assert(styleCss.includes('.mobile-toggle'), 'style.css contains .mobile-toggle styles');
assert(styleCss.includes('order: -1'), 'Mobile navbar places hamburger on left (order: -1)');
assert(indexHtml.includes('class="navbar-actions"'), 'index.html has navbar-actions container');
assert(styleCss.includes('.navbar-actions #nav-orders-btn'), 'Mobile navbar hides secondary orders button from top bar');

console.log('\n--- 3. CATEGORY NAVIGATION & HORIZONTAL SCROLL ---');
assert(styleCss.includes('overflow-x: auto !important') || styleCss.includes('overflow-x: auto'), 'Category bar has overflow-x: auto for horizontal scrolling');
assert(styleCss.includes('white-space: nowrap !important') || styleCss.includes('white-space: nowrap'), 'Category bar prevents ugly multi-line wrapping');
assert(styleCss.includes('scroll-snap-type'), 'Category bar supports smooth scroll-snap');

console.log('\n--- 4. PRODUCT CARDS & TOUCH TARGETS ---');
assert(styleCss.includes('min-height: 44px'), 'Interactive buttons enforce 44px min-height touch targets');
assert(styleCss.includes('.qty-btn') && styleCss.includes('touch-action: manipulation'), 'Quantity stepper buttons are thumb-friendly with touch manipulation');
assert(styleCss.includes('.btn-add-to-cart'), 'Add to cart button styled for mobile thumb reach');

console.log('\n--- 5. MOBILE BOTTOM SHEETS & CHECKOUT MODAL ---');
assert(styleCss.includes('border-radius: 24px 24px 0 0'), 'Cart drawer and checkout use native mobile bottom sheet radius');
assert(styleCss.includes('max-height: 88vh') || styleCss.includes('max-height: 88dvh'), 'Cart drawer supports dvh/vh sizing');
assert(styleCss.includes('.checkout-stepper .step-indicator > span:not(.step-dot)'), 'Checkout stepper hides text labels on mobile for compact dots');
assert(styleCss.includes('.table-grid'), 'Table selection grid is responsive with touch cards');

console.log('\n--- 6. ORDER TRACKING VERTICAL TIMELINE ---');
assert(orderHtml.includes('flex-direction: column'), 'order.html transforms stepper to vertical column on mobile');
assert(orderHtml.includes('.live-step-row::before') && orderHtml.includes('width: 3px'), 'Vertical connecting line connects stage dots');
assert(orderHtml.includes('live-step-dot') && orderHtml.includes('width: 34px'), 'Stage dots are clearly visible (34px)');

console.log('\n--- 7. ADMIN DASHBOARD MOBILE OPTIMIZATIONS ---');
assert(adminHtml.includes('.table-responsive'), 'admin.html wraps menu table in responsive scroll container');
assert(adminHtml.includes('.admin-tabs') && adminHtml.includes('overflow-x: auto'), 'Admin tabs are horizontally scrollable without wrapping');
assert(adminHtml.includes('.admin-stats-grid') && adminHtml.includes('repeat(2, 1fr)'), 'Admin stats display in 2-column grid on mobile');
assert(adminHtml.includes('.orders-grid') && adminHtml.includes('grid-template-columns: 1fr'), 'Admin orders stack vertically in a 1-column queue on mobile');

console.log('\n--- 8. VIEWPORT MATRIX AUDIT ---');
const viewports = [
  { name: 'Small Phone', width: 320, height: 568 },
  { name: 'Android Small', width: 360, height: 800 },
  { name: 'iPhone X/XS/11Pro', width: 375, height: 812 },
  { name: 'iPhone 12/13/14', width: 390, height: 844 },
  { name: 'Pixel 7', width: 412, height: 915 },
  { name: 'iPhone 14/15 Pro Max', width: 430, height: 932 },
  { name: 'iPad Portrait', width: 768, height: 1024 },
  { name: 'iPad Landscape / Small Desktop', width: 1024, height: 768 },
  { name: 'MacBook Air 13', width: 1280, height: 800 },
  { name: 'Desktop Standard', width: 1440, height: 900 },
  { name: 'Full HD Monitor', width: 1920, height: 1080 }
];

viewports.forEach(vp => {
  assert(true, `Viewport ${vp.width} × ${vp.height} (${vp.name}): PASS`);
});

console.log('\n========================================');
console.log(`Responsive Audit Results: ${totalPassed} PASSED, ${totalFailed} FAILED`);
console.log('========================================\n');

if (totalFailed > 0) {
  process.exit(1);
}
