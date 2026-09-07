/**
 * Ochre Coffee Roasters - Complete Restaurant Ordering & Cart System
 * Vanilla JavaScript (Zero Dependencies, Performance Optimized)
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initMenuFiltersAndSearch();
  initScrollAnimations();
  initScrollspy();
  initDynamicMenuAndCart();
});

/**
 * Toast Notification Utility
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('ochre-toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `ochre-toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * Cart State Management Module
 */
const OchreCart = (() => {
  const STORAGE_KEY = 'ochre_cart_v1';
  let cart = [];

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) cart = JSON.parse(saved);
  } catch (e) {
    cart = [];
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch (e) {
      console.error('Storage save error:', e);
    }
    renderAll();
  }

  function getItems() {
    return cart;
  }

  function getItem(productId) {
    return cart.find(item => item.id === productId);
  }

  function addItem(product) {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      if (existing.quantity < 20) {
        existing.quantity += 1;
      } else {
        showToast('Maximum quantity of 20 reached for this item.', 'info');
        return;
      }
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        imageUrl: product.imageUrl || 'assets/coffee_mug.png',
        quantity: 1
      });
    }
    showToast(`Added "${product.name}" to cart`, 'success');
    save();
  }

  function updateQuantity(productId, delta) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
      removeItem(productId);
    } else if (item.quantity > 20) {
      item.quantity = 20;
      showToast('Maximum quantity of 20 reached.', 'info');
      save();
    } else {
      save();
    }
  }

  function removeItem(productId) {
    cart = cart.filter(i => i.id !== productId);
    save();
  }

  function clearCart() {
    cart = [];
    save();
  }

  function getCount() {
    return cart.reduce((total, item) => total + item.quantity, 0);
  }

  function getSubtotal() {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  }

  function renderAll() {
    const totalCount = getCount();
    const subtotal = getSubtotal();

    // 1. Update badges
    const navBadge = document.getElementById('nav-cart-badge');
    const mobileBadge = document.getElementById('mobile-cart-badge');
    const drawerBadge = document.getElementById('cart-drawer-badge');

    if (navBadge) {
      navBadge.textContent = totalCount;
      navBadge.classList.toggle('has-items', totalCount > 0);
    }
    if (mobileBadge) mobileBadge.textContent = totalCount;
    if (drawerBadge) drawerBadge.textContent = totalCount;

    // 2. Update Sticky Mobile Cart Pill
    const stickyCart = document.getElementById('mobile-sticky-cart');
    const stickySummary = document.getElementById('sticky-cart-summary');
    if (stickyCart && stickySummary) {
      if (totalCount > 0) {
        stickyCart.style.display = 'flex';
        stickySummary.textContent = `${totalCount} ${totalCount === 1 ? 'item' : 'items'} · ₹${subtotal}`;
      } else {
        stickyCart.style.display = 'none';
      }
    }

    // 3. Render Drawer Items
    const drawerItemsContainer = document.getElementById('cart-drawer-items');
    const drawerFooter = document.getElementById('cart-drawer-footer');
    const subtotalVal = document.getElementById('cart-subtotal-val');
    const totalVal = document.getElementById('cart-total-val');

    if (drawerItemsContainer) {
      if (cart.length === 0) {
        drawerItemsContainer.innerHTML = `
          <div class="cart-empty-state">
            <div class="cart-empty-icon">☕</div>
            <h4>Your cart is empty</h4>
            <p>Explore our single-origin pour-overs, chilled coolers and artisan bites.</p>
            <a href="#menu" class="btn btn-secondary btn-sm" onclick="closeCartDrawer()">Explore Menu</a>
          </div>
        `;
        if (drawerFooter) drawerFooter.style.display = 'none';
      } else {
        drawerItemsContainer.innerHTML = cart.map(item => `
          <div class="cart-item-row" data-id="${item.id}">
            <img src="${item.imageUrl}" alt="${item.name}" class="cart-item-img">
            <div class="cart-item-meta">
              <div class="cart-item-title">${item.name}</div>
              <div class="cart-item-price">₹${item.price} × ${item.quantity} = ₹${item.price * item.quantity}</div>
            </div>
            <div class="cart-item-actions">
              <div class="qty-stepper">
                <button class="qty-btn" onclick="OchreCart.updateQuantity('${item.id}', -1)" aria-label="Decrease quantity">−</button>
                <span class="qty-val">${item.quantity}</span>
                <button class="qty-btn" onclick="OchreCart.updateQuantity('${item.id}', 1)" aria-label="Increase quantity">+</button>
              </div>
              <button class="cart-item-remove" onclick="OchreCart.removeItem('${item.id}')" aria-label="Remove item" title="Remove">&times;</button>
            </div>
          </div>
        `).join('');

        if (subtotalVal) subtotalVal.textContent = `₹${subtotal}`;
        if (totalVal) totalVal.textContent = `₹${subtotal}`;
        if (drawerFooter) drawerFooter.style.display = 'block';
      }
    }

    // 4. Update Product Cards in Menu Grid & Favorites in exact synchronization
    document.querySelectorAll('[data-product-id]').forEach(elem => {
      const pId = elem.getAttribute('data-product-id');
      const cartItem = getItem(pId);
      const actionWrap = elem.querySelector('.item-card-action');
      if (actionWrap && !actionWrap.classList.contains('unavailable-action')) {
        const isFavorite = elem.classList.contains('favorite-card');
        if (cartItem && cartItem.quantity > 0) {
          actionWrap.innerHTML = `
            <div class="qty-stepper" ${isFavorite ? 'style="width: 100%; justify-content: space-between; padding: 0.35rem 0.75rem; min-height: 44px;"' : ''}>
              <button class="qty-btn" onclick="OchreCart.updateQuantity('${pId}', -1)" aria-label="Decrease quantity">−</button>
              <span class="qty-val" ${isFavorite ? 'style="font-size: 1.05rem;"' : ''}>${cartItem.quantity}</span>
              <button class="qty-btn" onclick="OchreCart.updateQuantity('${pId}', 1)" aria-label="Increase quantity">+</button>
            </div>
          `;
        } else {
          if (isFavorite) {
            actionWrap.innerHTML = `
              <button class="btn btn-primary btn-sm" style="width: 100%; min-height: 44px;" onclick="handleAddToCartClick('${pId}')">
                <span>+ Add to Cart</span>
              </button>
            `;
          } else {
            actionWrap.innerHTML = `
              <button class="btn-add-to-cart" onclick="handleAddToCartClick('${pId}')">
                <span>+ Add</span>
              </button>
            `;
          }
        }
      }
    });
  }

  function reloadFromStorage() {
    cart = getSavedCart();
    renderAll();
  }

  return {
    getItems,
    getItem,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    getCount,
    getSubtotal,
    renderAll,
    reloadFromStorage
  };
})();

// Global reference for inline event handlers
window.OchreCart = OchreCart;

/**
 * Global product lookup map loaded from backend (pre-seeded for zero-latency clicks)
 */
const FALLBACK_PRODUCTS = [
  { id: 'prod_caramel_latte', name: 'Caramel Latte', price: 189, imageUrl: 'assets/coffee_mug.png', image_url: 'assets/coffee_mug.png', category_id: 'cat_coffee', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'Chikmagalur Washed Lot' },
  { id: 'prod_hazelnut_mocha', name: 'Hazelnut Mocha', price: 199, imageUrl: 'assets/coffee_mug.png', image_url: 'assets/coffee_mug.png', category_id: 'cat_coffee', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'Dark Roast · Velvety' },
  { id: 'prod_spanish_cold_brew', name: 'Spanish Cold Brew', price: 199, imageUrl: 'assets/iced_coffee.png', image_url: 'assets/iced_coffee.png', category_id: 'cat_coffee', is_veg: 1, is_cold: 1, available: 1, origin_tag: 'Signature Cold Pour' },
  { id: 'prod_oat_milk_cappuccino', name: 'Oat Milk Cappuccino', price: 189, imageUrl: 'assets/coffee_mug.png', image_url: 'assets/coffee_mug.png', category_id: 'cat_coffee', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'Dairy-Free · Gentle Roast' },
  { id: 'prod_vanilla_cinnamon_latte', name: 'Vanilla Cinnamon Latte', price: 199, imageUrl: 'assets/coffee_mug.png', image_url: 'assets/coffee_mug.png', category_id: 'cat_coffee', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'Spiced & Comforting' },
  { id: 'prod_pour_over_v60', name: 'Single-Origin Pour Over (V60)', price: 210, imageUrl: 'assets/gallery_pourover.jpg', image_url: 'assets/gallery_pourover.jpg', category_id: 'cat_coffee', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'Araku Valley Micro-lot · Light Roast' },
  { id: 'prod_iced_matcha_latte', name: 'Iced Matcha Latte', price: 199, imageUrl: 'assets/matcha_cooler.png', image_url: 'assets/matcha_cooler.png', category_id: 'cat_cold', is_veg: 1, is_cold: 1, available: 1, origin_tag: 'Antioxidant Rich · Stone Ground' },
  { id: 'prod_blueberry_lemonade', name: 'Blueberry Lemonade', price: 179, imageUrl: 'assets/matcha_cooler.png', image_url: 'assets/matcha_cooler.png', category_id: 'cat_cold', is_veg: 1, is_cold: 1, available: 1, origin_tag: 'Tangy, Fruity & Refreshing' },
  { id: 'prod_watermelon_cooler', name: 'Watermelon Cooler', price: 169, imageUrl: 'assets/matcha_cooler.png', image_url: 'assets/matcha_cooler.png', category_id: 'cat_cold', is_veg: 1, is_cold: 1, available: 1, origin_tag: 'Hydrating · Pure Juice' },
  { id: 'prod_peach_iced_tea', name: 'Peach Iced Tea', price: 169, imageUrl: 'assets/iced_coffee.png', image_url: 'assets/iced_coffee.png', category_id: 'cat_cold', is_veg: 1, is_cold: 1, available: 1, origin_tag: 'Light & Perfectly Chilled' },
  { id: 'prod_espresso_tonic', name: 'Cold Brew Espresso Tonic', price: 185, imageUrl: 'assets/iced_coffee.png', image_url: 'assets/iced_coffee.png', category_id: 'cat_cold', is_veg: 1, is_cold: 1, available: 1, origin_tag: 'Effervescent · Citrusy' },
  { id: 'prod_masala_chai_pot', name: 'Estate Masala Chai Pot', price: 140, imageUrl: 'assets/coffee_mug.png', image_url: 'assets/coffee_mug.png', category_id: 'cat_tea', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'Served in Clay Kulhad Pot' },
  { id: 'prod_hibiscus_rose_tisane', name: 'Hibiscus Rose Tisane', price: 150, imageUrl: 'assets/matcha_cooler.png', image_url: 'assets/matcha_cooler.png', category_id: 'cat_tea', is_veg: 1, is_cold: 1, available: 1, origin_tag: 'Floral & Tart' },
  { id: 'prod_grilled_cheese', name: 'Grilled Cheese Sandwich', price: 149, imageUrl: 'assets/sandwich_fries.png', image_url: 'assets/sandwich_fries.png', category_id: 'cat_food', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'With Garlic Herb Dip' },
  { id: 'prod_paneer_tikka_wrap', name: 'Paneer Tikka Wrap', price: 169, imageUrl: 'assets/sandwich_fries.png', image_url: 'assets/sandwich_fries.png', category_id: 'cat_food', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'Spicy, Wholesome & Satisfying' },
  { id: 'prod_peri_peri_fries', name: 'Crispy Peri Peri Fries', price: 129, imageUrl: 'assets/sandwich_fries.png', image_url: 'assets/sandwich_fries.png', category_id: 'cat_food', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'Served in Ceramic Cup' },
  { id: 'prod_chocolate_brownie', name: 'Fudgy Chocolate Brownie', price: 99, imageUrl: 'assets/gallery_pastry.jpg', image_url: 'assets/gallery_pastry.jpg', category_id: 'cat_dessert', is_veg: 1, is_cold: 0, available: 1, origin_tag: 'Melts in Your Mouth' }
];

let menuProductsMap = {};
FALLBACK_PRODUCTS.forEach(p => {
  menuProductsMap[p.id] = p;
});

window.handleAddToCartClick = function(productId) {
  const prod = menuProductsMap[productId];
  if (!prod) {
    showToast('Product information loading...', 'info');
    return;
  }
  if (!prod.available) {
    showToast(`"${prod.name}" is currently unavailable.`, 'error');
    return;
  }
  OchreCart.addItem(prod);
};

/**
 * Cart Drawer Drawer UI Controls
 */
function openCartDrawer() {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-drawer-overlay');
  if (drawer && overlay) {
    drawer.classList.add('is-open');
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
}

function closeCartDrawer() {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-drawer-overlay');
  if (drawer && overlay) {
    drawer.classList.remove('is-open');
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }
}

window.openCartDrawer = openCartDrawer;
window.closeCartDrawer = closeCartDrawer;

/**
 * Dynamic Menu Loading & Cart Initialization
 */
async function initDynamicMenuAndCart() {
  // 1. Cart triggers
  const navCartBtn = document.getElementById('nav-cart-btn');
  const mobileCartLink = document.getElementById('mobile-cart-link');
  const drawerCloseBtn = document.getElementById('cart-drawer-close');
  const drawerOverlay = document.getElementById('cart-drawer-overlay');
  const stickyCartBtn = document.getElementById('sticky-cart-btn');
  const checkoutBtn = document.getElementById('cart-checkout-btn');

  if (navCartBtn) navCartBtn.addEventListener('click', openCartDrawer);
  if (mobileCartLink) mobileCartLink.addEventListener('click', () => {
    const mobileDrawer = document.getElementById('mobile-drawer');
    if (mobileDrawer) mobileDrawer.classList.remove('is-open');
    openCartDrawer();
  });
  if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeCartDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeCartDrawer);
  if (stickyCartBtn) stickyCartBtn.addEventListener('click', openCartDrawer);
  if (checkoutBtn) checkoutBtn.addEventListener('click', () => {
    closeCartDrawer();
    openCheckoutModal();
  });

  // 2. Fetch live menu from API
  try {
    const res = await fetch('/api/menu');
    const result = await res.json();

    if (result.success && result.data && result.data.products) {
      const { products, categories } = result.data;

      // Populate global lookup
      products.forEach(p => {
        menuProductsMap[p.id] = p;
      });

      // Render dynamic menu cards
      renderMenuCards(products);

      // Connect favorites cards
      connectFavoritesCards();
    }
  } catch (err) {
    console.warn('Could not fetch live menu from backend, using fallback data:', err);
  }

  // Initial cart render
  OchreCart.renderAll();

  // Setup Multi-Step Checkout Modal
  initCheckoutFlow();

  // Setup Real-Time Sync (Cross-Tab Storage + Live Polling)
  initSyncListeners();
}

/**
 * Renders product cards into #menu-grid with proper, small reference thumbnail images
 */
function renderMenuCards(products) {
  const menuGrid = document.getElementById('menu-grid');
  if (!menuGrid) return;

  menuGrid.innerHTML = products.map(prod => {
    const isAvailable = Boolean(prod.available);
    const cartItem = OchreCart.getItem(prod.id);
    const thumbUrl = prod.image_url || prod.imageUrl || 'assets/coffee_mug.png';

    return `
      <article class="menu-item-card ${!isAvailable ? 'is-unavailable' : ''}"
               data-category="${prod.category_id.replace('cat_', '')}"
               data-veg="${prod.is_veg === 1}"
               data-cold="${prod.is_cold === 1}"
               data-product-id="${prod.id}">
        <div class="item-card-content">
          <div class="item-card-header">
            <div class="item-name-group">
              <h3 class="item-card-title">${prod.name}</h3>
              ${prod.is_cold ? '<span class="pill-tag tag-cold">COLD</span>' : ''}
              ${prod.is_veg ? '<span class="veg-icon-dot" title="Vegetarian"></span>' : ''}
            </div>
            <span class="item-card-price">&#8377;${prod.price}</span>
          </div>

          <p class="item-card-desc">${prod.description || ''}</p>

          <div class="item-card-footer">
            ${prod.origin_tag ? `<span class="tag-origin">${prod.origin_tag}</span>` : '<span></span>'}
          </div>
        </div>

        <div class="item-card-media">
          <div class="item-card-thumb-box">
            <img src="${thumbUrl}" alt="${prod.name}" class="item-card-thumb" loading="lazy">
          </div>
          <div class="item-card-action ${!isAvailable ? 'unavailable-action' : ''}">
            ${!isAvailable 
              ? '<span class="badge-unavailable">Unavailable</span>'
              : cartItem && cartItem.quantity > 0
                ? `
                  <div class="qty-stepper">
                    <button class="qty-btn" onclick="OchreCart.updateQuantity('${prod.id}', -1)" aria-label="Decrease quantity">−</button>
                    <span class="qty-val">${cartItem.quantity}</span>
                    <button class="qty-btn" onclick="OchreCart.updateQuantity('${prod.id}', 1)" aria-label="Increase quantity">+</button>
                  </div>
                `
                : `
                  <button class="btn-add-to-cart" onclick="handleAddToCartClick('${prod.id}')">
                    <span>+ Add</span>
                  </button>
                `
            }
          </div>
        </div>
      </article>
    `;
  }).join('') + `
    <div class="menu-empty-message" id="menu-empty-notice" style="display: none;">
      <h4>No items match your active search or filters.</h4>
      <p>Try clearing your search or switching categories.</p>
    </div>
  `;

  // Apply current active category tab, dietary checkboxes, and search filters
  applyMenuFilters();
}

/**
 * Connects action buttons to the 4 Featured Favorites cards
 */
function connectFavoritesCards() {
  const mapping = [
    { selector: '.favorite-card:nth-child(1)', id: 'prod_spanish_cold_brew' },
    { selector: '.favorite-card:nth-child(2)', id: 'prod_caramel_latte' },
    { selector: '.favorite-card:nth-child(3)', id: 'prod_iced_matcha_latte' },
    { selector: '.favorite-card:nth-child(4)', id: 'prod_grilled_cheese' }
  ];

  mapping.forEach(m => {
    const card = document.querySelector(m.selector);
    if (card) {
      card.setAttribute('data-product-id', m.id);
      let actionWrap = card.querySelector('.item-card-action');
      if (!actionWrap) {
        actionWrap = document.createElement('div');
        actionWrap.className = 'item-card-action';
        actionWrap.style.padding = '0 1.25rem 1rem';
        card.appendChild(actionWrap);
      }
      const prod = menuProductsMap[m.id];
      const isAvailable = prod ? Boolean(prod.available) : true;

      if (!isAvailable) {
        actionWrap.className = 'item-card-action unavailable-action';
        actionWrap.innerHTML = '<span class="badge-unavailable">Currently Unavailable</span>';
      } else {
        const cartItem = OchreCart.getItem(m.id);
        if (cartItem && cartItem.quantity > 0) {
          actionWrap.innerHTML = `
            <div class="qty-stepper" style="width: 100%; justify-content: space-between; padding: 0.35rem 0.75rem; min-height: 44px;">
              <button class="qty-btn" onclick="OchreCart.updateQuantity('${m.id}', -1)" aria-label="Decrease quantity">−</button>
              <span class="qty-val" style="font-size: 1.05rem;">${cartItem.quantity}</span>
              <button class="qty-btn" onclick="OchreCart.updateQuantity('${m.id}', 1)" aria-label="Increase quantity">+</button>
            </div>
          `;
        } else {
          actionWrap.innerHTML = `
            <button class="btn btn-primary btn-sm" style="width: 100%; min-height: 44px;" onclick="handleAddToCartClick('${m.id}')">
              <span>+ Add to Cart</span>
            </button>
          `;
        }
      }
    }
  });
}

/**
 * Real-time synchronization controller
 */
function initSyncListeners() {
  // 1. Multi-tab synchronization
  window.addEventListener('storage', (e) => {
    if (e.key === 'ochre_cart') {
      OchreCart.reloadFromStorage();
    }
    if (e.key === 'ochre_customer_orders') {
      const modal = document.getElementById('orders-modal-overlay');
      if (modal && modal.classList.contains('is-open')) {
        openOrdersModal();
      }
    }
  });

  // 2. Background live menu availability & price sync
  let isSyncing = false;
  async function syncLiveMenu() {
    if (isSyncing || document.hidden) return;
    isSyncing = true;
    try {
      const res = await fetch('/api/menu');
      const json = await res.json();
      if (json.success && json.data && json.data.products) {
        let hasChanges = false;
        json.data.products.forEach(p => {
          const old = menuProductsMap[p.id];
          if (!old || old.available !== p.available || old.price !== p.price) {
            hasChanges = true;
          }
          menuProductsMap[p.id] = p;
        });

        if (hasChanges) {
          renderMenuCards(json.data.products);
          connectFavoritesCards();
          OchreCart.renderAll();
        }
      }
    } catch (e) {
      // Quiet fail on network loss
    } finally {
      isSyncing = false;
    }
  }

  // Poll every 6 seconds for admin catalog changes
  setInterval(syncLiveMenu, 6000);

  // Sync immediately when tab regains focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncLiveMenu();
  });
}



/**
 * Multi-Step Checkout Controller
 */
function initCheckoutFlow() {
  let currentStep = 1;
  let orderType = 'DINE_IN';
  let selectedTableNumber = null;
  let paymentMethod = 'UPI';

  const overlay = document.getElementById('checkout-modal-overlay');
  const closeBtn = document.getElementById('checkout-modal-close');
  const nextBtn = document.getElementById('checkout-next-btn');
  const backBtn = document.getElementById('checkout-back-btn');
  const errorMsg = document.getElementById('checkout-error-msg');

  if (closeBtn) closeBtn.addEventListener('click', closeCheckoutModal);

  // 1. Order Type Selection (Step 1)
  const optDineIn = document.getElementById('opt-dine-in');
  const optTakeaway = document.getElementById('opt-takeaway');
  const stepNavTable = document.getElementById('step-nav-table');

  if (optDineIn && optTakeaway) {
    optDineIn.addEventListener('click', () => {
      orderType = 'DINE_IN';
      optDineIn.classList.add('is-selected');
      optTakeaway.classList.remove('is-selected');
      if (stepNavTable) stepNavTable.style.display = 'inline-flex';
    });

    optTakeaway.addEventListener('click', () => {
      orderType = 'TAKEAWAY';
      optTakeaway.classList.add('is-selected');
      optDineIn.classList.remove('is-selected');
      selectedTableNumber = null;
      if (stepNavTable) stepNavTable.style.display = 'none';
    });
  }

  // 2. Payment Method Selection (Step 4)
  const optPayUpi = document.getElementById('opt-pay-upi');
  const optPayCounter = document.getElementById('opt-pay-counter');

  if (optPayUpi && optPayCounter) {
    optPayUpi.addEventListener('click', () => {
      paymentMethod = 'UPI';
      optPayUpi.classList.add('is-selected');
      optPayCounter.classList.remove('is-selected');
    });

    optPayCounter.addEventListener('click', () => {
      paymentMethod = 'COUNTER';
      optPayCounter.classList.add('is-selected');
      optPayUpi.classList.remove('is-selected');
    });
  }

  // Next / Continue button
  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      if (errorMsg) errorMsg.style.display = 'none';

      if (currentStep === 1) {
        goToStep(2);
      } else if (currentStep === 2) {
        const nameInput = document.getElementById('checkout-name');
        const phoneInput = document.getElementById('checkout-phone');
        const name = (nameInput?.value || '').trim();
        const phone = (phoneInput?.value || '').trim().replace(/\D/g, '');

        if (!name) {
          showToast('Please enter your full name.', 'error');
          nameInput?.focus();
          return;
        }
        if (!/^[6-9]\d{9}$/.test(phone)) {
          showToast('Please enter a valid 10-digit Indian mobile number.', 'error');
          phoneInput?.focus();
          return;
        }

        // If Dine In, proceed to Table selection (Step 3). If Takeaway, skip to Payment (Step 4).
        if (orderType === 'DINE_IN') {
          loadTablesForSelection();
          goToStep(3);
        } else {
          goToStep(4);
        }
      } else if (currentStep === 3) {
        if (!selectedTableNumber) {
          showToast('Please select a table to sit at.', 'error');
          return;
        }
        goToStep(4);
      } else if (currentStep === 4) {
        populateOrderReview();
        goToStep(5);
      } else if (currentStep === 5) {
        await handleOrderSubmission();
      }
    });
  }

  // Back button
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (currentStep === 5) {
        goToStep(4);
      } else if (currentStep === 4) {
        if (orderType === 'DINE_IN') goToStep(3);
        else goToStep(2);
      } else if (currentStep === 3) {
        goToStep(2);
      } else if (currentStep === 2) {
        goToStep(1);
      }
    });
  }

  function goToStep(step) {
    currentStep = step;

    // Update panels
    document.querySelectorAll('.checkout-step-panel').forEach((panel, idx) => {
      panel.classList.toggle('is-active', idx + 1 === step);
    });

    // Update steppers
    document.querySelectorAll('.checkout-stepper .step-indicator').forEach(ind => {
      const stepNum = parseInt(ind.getAttribute('data-step'), 10);
      ind.classList.toggle('active', stepNum === step);
      ind.classList.toggle('completed', stepNum < step);
    });

    // Update buttons
    if (backBtn) backBtn.style.visibility = step > 1 ? 'visible' : 'hidden';

    if (nextBtn) {
      if (step === 5) {
        const total = OchreCart.getSubtotal();
        if (paymentMethod === 'UPI') {
          nextBtn.innerHTML = `<span>Pay ₹${total} via UPI</span> <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 10h10M11 6l4 4-4 4"/></svg>`;
        } else {
          nextBtn.innerHTML = `<span>Place Order — Pay at Counter</span> <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 10h10M11 6l4 4-4 4"/></svg>`;
        }
      } else {
        nextBtn.innerHTML = `<span>Continue &rarr;</span>`;
      }
    }
  }

  async function loadTablesForSelection() {
    const grid = document.getElementById('checkout-tables-grid');
    if (!grid) return;

    try {
      const res = await fetch('/api/tables');
      const json = await res.json();

      if (json.success && json.data) {
        grid.innerHTML = json.data.map(tbl => `
          <div class="table-card ${tbl.isOccupied ? 'is-occupied' : ''} ${selectedTableNumber === tbl.tableNumber ? 'is-selected' : ''}"
               data-table-num="${tbl.tableNumber}">
            <div class="table-card-num">T-${tbl.tableNumber < 10 ? '0' + tbl.tableNumber : tbl.tableNumber}</div>
            <div class="table-card-meta">${tbl.capacity} Seats · ${tbl.isOccupied ? 'Occupied' : 'Open'}</div>
          </div>
        `).join('');

        grid.querySelectorAll('.table-card').forEach(card => {
          card.addEventListener('click', () => {
            const num = parseInt(card.getAttribute('data-table-num'), 10);
            selectedTableNumber = num;
            grid.querySelectorAll('.table-card').forEach(c => c.classList.remove('is-selected'));
            card.classList.add('is-selected');
          });
        });
      }
    } catch (e) {
      grid.innerHTML = '<div style="color: #c5221f; padding: 1rem;">Failed to load tables. Please check your connection.</div>';
    }
  }

  function populateOrderReview() {
    const typeLabel = document.getElementById('review-order-type');
    const tableRow = document.getElementById('review-table-row');
    const tableNum = document.getElementById('review-table-num');
    const guestName = document.getElementById('review-guest-name');
    const guestPhone = document.getElementById('review-guest-phone');
    const payMethod = document.getElementById('review-payment-method');
    const itemsList = document.getElementById('review-items-list');
    const totalPrice = document.getElementById('review-total-price');

    const name = document.getElementById('checkout-name')?.value || '';
    const phone = document.getElementById('checkout-phone')?.value || '';

    if (typeLabel) typeLabel.textContent = orderType === 'DINE_IN' ? '🍽️ Dine In' : '🛍️ Takeaway';
    if (tableRow) tableRow.style.display = orderType === 'DINE_IN' ? 'block' : 'none';
    if (tableNum) tableNum.textContent = `Table ${selectedTableNumber < 10 ? '0' + selectedTableNumber : selectedTableNumber}`;
    if (guestName) guestName.textContent = name;
    if (guestPhone) guestPhone.textContent = phone;
    if (payMethod) payMethod.textContent = paymentMethod === 'UPI' ? '⚡ UPI (Razorpay)' : '💵 Pay at Counter';

    const cartItems = OchreCart.getItems();
    if (itemsList) {
      itemsList.innerHTML = cartItems.map(item => `
        <div class="review-item">
          <span>${item.name} × ${item.quantity}</span>
          <span style="font-weight: 700; color: var(--color-text-primary);">₹${item.price * item.quantity}</span>
        </div>
      `).join('');
    }

    if (totalPrice) totalPrice.textContent = `₹${OchreCart.getSubtotal()}`;
  }

  async function handleOrderSubmission() {
    const items = OchreCart.getItems().map(i => ({
      productId: i.id,
      quantity: i.quantity
    }));

    if (items.length === 0) {
      showToast('Your cart is empty.', 'error');
      return;
    }

    const customerName = (document.getElementById('checkout-name')?.value || '').trim();
    const customerPhone = (document.getElementById('checkout-phone')?.value || '').trim();
    const notes = (document.getElementById('checkout-notes')?.value || '').trim();

    nextBtn.disabled = true;
    nextBtn.innerHTML = `<span>Placing Order...</span>`;

    try {
      // Client-side idempotency key prevents duplicate orders on rapid clicks or network retries
      if (!window._currentCheckoutIdempotencyKey) {
        window._currentCheckoutIdempotencyKey = 'idemp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      }

      const orderPayload = {
        customerName,
        customerPhone,
        orderType,
        tableNumber: orderType === 'DINE_IN' ? selectedTableNumber : null,
        paymentMethod,
        notes,
        items,
        idempotencyKey: window._currentCheckoutIdempotencyKey
      };

      // Single fast server round-trip: validates cart, calculates totals, creates order & payment payload
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      });

      const json = await res.json();

      if (!json.success) {
        if (errorMsg) {
          errorMsg.textContent = json.error?.message || 'Failed to create order.';
          errorMsg.style.display = 'block';
        }
        showToast(json.error?.message || 'Order failed. Please try again.', 'error');
        nextBtn.disabled = false;
        nextBtn.innerHTML = `<span>Try Again</span>`;
        return;
      }

      const orderData = json.data;
      window._currentCheckoutIdempotencyKey = null; // Reset key after successful order

      // Save genuine placed order to customer's browser session history
      saveCustomerOrder({
        orderNumber: orderData.orderNumber,
        orderType: orderData.orderType,
        tableNumber: orderData.tableNumber,
        total: orderData.total,
        paymentMethod: orderData.paymentMethod,
        createdAt: new Date().toISOString()
      });

      // Handle Pay at Counter
      if (paymentMethod === 'COUNTER') {
        OchreCart.clearCart();
        closeCheckoutModal();
        showToast(`Order ${orderData.orderNumber} placed successfully!`, 'success');
        window.location.href = `/order.html?orderNumber=${orderData.orderNumber}`;
        return;
      }

      // Handle Real Direct UPI & Razorpay Flow
      if (paymentMethod === 'UPI') {
        OchreCart.clearCart();
        closeCheckoutModal();

        const payment = orderData.payment || {};
        if (payment.razorpayOrderId && typeof Razorpay !== 'undefined') {
          launchRazorpayCheckout(orderData);
        } else {
          showRealUpiModal(orderData);
        }
      }
    } catch (err) {
      console.error('Submission error:', err);
      showToast('Something went wrong. Your order was not duplicated. Please try again.', 'error');
      nextBtn.disabled = false;
      nextBtn.innerHTML = `<span>Try Again</span>`;
    }
  }

  // Official Razorpay Standard Checkout (UPI Apps, QR, Cards, NetBanking)
  function launchRazorpayCheckout(orderData) {
    const payment = orderData.payment || {};
    const customerName = document.getElementById('checkout-name')?.value || orderData.customerName || 'Guest';
    const customerPhone = document.getElementById('checkout-phone')?.value || orderData.customerPhone || '';

    const options = {
      key: payment.keyId || 'rzp_test_TZ7M8842SL8yiG',
      amount: payment.amount || Math.round(orderData.total * 100),
      currency: payment.currency || 'INR',
      name: 'Ochre Coffee Roasters',
      description: `Order #${orderData.orderNumber}`,
      image: 'https://money-iota-woad.vercel.app/assets/hero_cafe.jpg',
      order_id: payment.razorpayOrderId,
      prefill: {
        name: customerName,
        contact: customerPhone
      },
      notes: {
        orderNumber: orderData.orderNumber,
        destinationVpa: payment.destinationVpa || '9182916879@ybl'
      },
      theme: {
        color: '#b85d39'
      },
      modal: {
        ondismiss: function() {
          console.log('Razorpay modal closed. Showing direct UPI option.');
          showRealUpiModal(orderData);
        }
      },
      handler: async function(response) {
        showToast('Verifying payment with banking gateway...', 'info');

        try {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderNumber: orderData.orderNumber,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            })
          });

          const verifyJson = await verifyRes.json();
          if (verifyJson.success) {
            showToast('Payment verified successfully! Your order is confirmed.', 'success');
            setTimeout(() => {
              window.location.href = `/order.html?orderNumber=${orderData.orderNumber}&paid=true`;
            }, 600);
          } else {
            showToast(verifyJson.error?.message || 'Payment verification issue. Staff will confirm at counter.', 'error');
            showRealUpiModal(orderData);
          }
        } catch (err) {
          console.error('Signature verification error:', err);
          showToast('Payment received! Opening order tracker...', 'info');
          window.location.href = `/order.html?orderNumber=${orderData.orderNumber}`;
        }
      }
    };

    try {
      const rzpInstance = new Razorpay(options);
      rzpInstance.on('payment.failed', function(resp) {
        console.warn('Payment failed:', resp.error);
        showToast(resp.error?.description || 'Payment was unsuccessful. You can try direct UPI.', 'error');
        showRealUpiModal(orderData);
      });
      rzpInstance.open();
    } catch (e) {
      console.warn('Could not launch Razorpay modal, falling back to UPI modal:', e);
      showRealUpiModal(orderData);
    }
  }

  // Real UPI Modal with dynamic server-generated QR, VPA 9182916879@ybl, and mobile UPI intent
  function showRealUpiModal(orderData) {
    const upiModal = document.getElementById('upi-modal-overlay');
    const modalBody = document.getElementById('upi-modal-body');
    const closeBtn = document.getElementById('upi-modal-close');
    if (!upiModal || !modalBody) {
      window.location.href = `/order.html?orderNumber=${orderData.orderNumber}`;
      return;
    }

    const payment = orderData.payment || {};
    const vpa = payment.destinationVpa || '9182916879@ybl';
    const amount = orderData.total;
    const upiUri = payment.upiUri || `upi://pay?pa=${vpa}&pn=Ochre%20Coffee%20Roasters&am=${amount.toFixed(2)}&cu=INR&tr=${orderData.orderNumber}&tn=Order%20${orderData.orderNumber}`;

    modalBody.innerHTML = `
      <div style="margin-bottom: 1.25rem;">
        <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); font-weight: 700; margin-bottom: 0.25rem;">
          Order #${orderData.orderNumber}
        </div>
        <div style="font-size: 2rem; font-weight: 850; color: var(--color-accent-ochre);">
          ₹${amount}
        </div>
        <div style="font-size: 0.82rem; color: var(--color-text-secondary); margin-top: 0.2rem;">
          ${orderData.orderType === 'DINE_IN' ? `Table ${orderData.tableNumber}` : 'Takeaway Order'}
        </div>
      </div>

      ${payment.razorpayOrderId ? `
        <button type="button" class="btn btn-primary" id="btn-relaunch-rzp" style="width: 100%; margin-bottom: 1.1rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-weight: 800; padding: 0.85rem;">
          <span>⚡</span>
          <span>Pay Online via Razorpay (Instant Confirmation)</span>
        </button>
        <div style="display: flex; align-items: center; gap: 0.8rem; margin-bottom: 1.1rem; color: var(--color-text-muted); font-size: 0.78rem;">
          <div style="flex: 1; height: 1px; background: var(--border-subtle);"></div>
          <span>OR PAY VIA DIRECT UPI</span>
          <div style="flex: 1; height: 1px; background: var(--border-subtle);"></div>
        </div>
      ` : ''}

      <!-- Real QR Code -->
      <div style="background: #ffffff; padding: 1rem; border-radius: var(--radius-md); box-shadow: 0 4px 14px rgba(0,0,0,0.06); display: inline-block; margin-bottom: 1rem; border: 1px solid var(--border-subtle);">
        ${payment.qrDataUrl ? `
          <img src="${payment.qrDataUrl}" alt="UPI QR Code for ₹${amount}" style="width: 200px; height: 200px; display: block; margin: 0 auto;">
        ` : `
          <div style="width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; font-size: 0.82rem; color: var(--color-text-muted);">
            Scan via any UPI App
          </div>
        `}
      </div>

      <!-- Copyable UPI ID Box -->
      <div style="background: var(--bg-card-subtle); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: space-between;">
        <div style="text-align: left;">
          <div style="font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700;">Destination UPI ID</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: var(--color-text-primary);" id="upi-vpa-text">${vpa}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-vpa" style="padding: 0.35rem 0.75rem; font-size: 0.78rem;">Copy</button>
      </div>

      <!-- Mobile UPI Intent Deep Link -->
      <a href="${upiUri}" class="btn btn-primary" style="width: 100%; margin-bottom: 0.75rem; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.8rem;">
        <span>📱</span>
        <span>Open UPI App (GPay, PhonePe, Paytm)</span>
      </a>

      <!-- Honest Verification Notice -->
      <div style="background: #fdf6ec; border-left: 3px solid #e6a23c; padding: 0.75rem; border-radius: 4px; font-size: 0.78rem; color: #8a6d3b; text-align: left; margin-bottom: 1.25rem; line-height: 1.45;">
        <strong>Direct UPI Status: Pending Staff Confirmation</strong><br>
        Direct UPI does not instantly confirm funds to the website. After paying, tap <em>Track Order</em> below. Our barista verifies payment at the counter and begins your order.
      </div>

      <a href="/order.html?orderNumber=${orderData.orderNumber}" class="btn btn-secondary" style="width: 100%; text-decoration: none; display: block; padding: 0.75rem;">
        Track Live Order Progress &rarr;
      </a>
    `;

    upiModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // Relaunch Razorpay helper
    document.getElementById('btn-relaunch-rzp')?.addEventListener('click', () => {
      upiModal.classList.remove('is-open');
      document.body.style.overflow = '';
      launchRazorpayCheckout(orderData);
    });

    // Copy VPA helper
    document.getElementById('btn-copy-vpa')?.addEventListener('click', () => {
      navigator.clipboard.writeText(vpa).then(() => {
        showToast('UPI ID copied: ' + vpa, 'success');
      }).catch(() => {
        showToast('UPI ID: ' + vpa, 'info');
      });
    });

    if (closeBtn) {
      closeBtn.onclick = () => {
        upiModal.classList.remove('is-open');
        document.body.style.overflow = '';
        window.location.href = `/order.html?orderNumber=${orderData.orderNumber}`;
      };
    }
  }
}

/**
 * Customer Genuine Orders Management (Local Session)
 */
function getCustomerOrders() {
  try {
    return JSON.parse(localStorage.getItem('ochre_customer_orders') || '[]');
  } catch (e) {
    return [];
  }
}

function saveCustomerOrder(order) {
  const list = getCustomerOrders().filter(o => o.orderNumber !== order.orderNumber);
  list.unshift(order);
  localStorage.setItem('ochre_customer_orders', JSON.stringify(list.slice(0, 20)));
}

function openOrdersModal() {
  const modal = document.getElementById('orders-modal-overlay');
  const body = document.getElementById('customer-orders-body');
  const closeBtn = document.getElementById('orders-modal-close');
  if (!modal || !body) return;

  const orders = getCustomerOrders();

  if (orders.length === 0) {
    body.innerHTML = `
      <div style="text-align: center; padding: 3rem 1.5rem; color: var(--color-text-muted);">
        <div style="font-size: 2.5rem; margin-bottom: 0.6rem;">☕</div>
        <h4 style="font-size: 1.2rem; font-weight: 800; color: var(--color-text-primary); margin-bottom: 0.4rem;">No orders yet</h4>
        <p style="font-size: 0.88rem; max-width: 320px; margin: 0 auto 1.5rem; line-height: 1.5;">
          You haven't placed any orders yet. Discover our fresh single-origin brews, iced coolers, and bakery treats.
        </p>
        <button class="btn btn-primary btn-sm" onclick="closeOrdersModal(); location.href='#menu';">Explore Menu</button>
      </div>
    `;
  } else {
    body.innerHTML = `
      <p style="font-size: 0.85rem; color: var(--color-text-secondary); margin-bottom: 1.2rem;">
        Showing your genuine orders placed on this device:
      </p>
      <div style="display: flex; flex-direction: column; gap: 0.85rem;">
        ${orders.map(o => `
          <div style="padding: 1rem 1.2rem; border-radius: var(--radius-md); background: var(--bg-card-subtle); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-weight: 800; font-size: 1.05rem; color: var(--color-text-primary);">${o.orderNumber}</div>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 2px;">
                ${o.orderType === 'DINE_IN' ? `🍽️ Table ${o.tableNumber}` : '🛍️ Takeaway'} · ${new Date(o.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div style="font-size: 0.85rem; font-weight: 700; color: var(--color-accent-ochre); margin-top: 4px;">
                ₹${o.total} (${o.paymentMethod === 'UPI' ? 'Online UPI' : 'Pay at Counter'})
              </div>
            </div>
            <a href="/order.html?orderNumber=${o.orderNumber}" class="btn btn-secondary btn-sm" style="font-size: 0.8rem; text-decoration: none;">
              Track Status &rarr;
            </a>
          </div>
        `).join('')}
      </div>
    `;
  }

  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';

  if (closeBtn) {
    closeBtn.onclick = closeOrdersModal;
  }
}

function closeOrdersModal() {
  const modal = document.getElementById('orders-modal-overlay');
  if (modal) {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
}

window.openOrdersModal = openOrdersModal;
window.closeOrdersModal = closeOrdersModal;

function openCheckoutModal() {
  if (OchreCart.getCount() === 0) {
    showToast('Your cart is empty. Add something delicious first.', 'info');
    return;
  }
  const modal = document.getElementById('checkout-modal-overlay');
  if (modal) {
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
}

function closeCheckoutModal() {
  const modal = document.getElementById('checkout-modal-overlay');
  if (modal) {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
}

window.openCheckoutModal = openCheckoutModal;
window.closeCheckoutModal = closeCheckoutModal;

/**
 * Sticky Navbar & Mobile Navigation Drawer
 */
function initNavbar() {
  const navbar = document.getElementById('main-navbar');
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const mobileDrawer = document.getElementById('mobile-drawer');
  const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-link');

  const handleScroll = () => {
    if (window.scrollY > 20) {
      navbar.classList.add('navbar-scrolled');
    } else {
      navbar.classList.remove('navbar-scrolled');
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileDrawer.classList.contains('is-open');
      if (isOpen) closeMobileMenu();
      else openMobileMenu();
    });

    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        if (mobileDrawer.classList.contains('is-open')) closeMobileMenu();
      });
    });

    const navOrdersBtn = document.getElementById('nav-orders-btn');
    const mobileOrdersLink = document.getElementById('mobile-orders-link');
    if (navOrdersBtn) {
      navOrdersBtn.addEventListener('click', openOrdersModal);
    }
    if (mobileOrdersLink) {
      mobileOrdersLink.addEventListener('click', () => {
        closeMobileMenu();
        openOrdersModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileDrawer.classList.contains('is-open')) {
        closeMobileMenu();
      }
    });
  }

  function openMobileMenu() {
    mobileDrawer.classList.add('is-open');
    mobileToggle.classList.add('is-active');
    mobileToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileMenu() {
    mobileDrawer.classList.remove('is-open');
    mobileToggle.classList.remove('is-active');
    mobileToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
}

/**
 * Unified Menu Filtering & Real-Time Search Controller
 */
function applyMenuFilters() {
  const activeTab = document.querySelector('.menu-category-tab.is-active');
  const currentCategory = activeTab ? activeTab.getAttribute('data-category') : 'all';
  const vegOnlyToggle = document.getElementById('filter-veg-only');
  const coldOnlyToggle = document.getElementById('filter-cold-only');
  const searchInput = document.getElementById('menu-search-input');
  const clearBtn = document.getElementById('menu-search-clear');

  const isVegOnly = Boolean(vegOnlyToggle && vegOnlyToggle.checked);
  const isColdOnly = Boolean(coldOnlyToggle && coldOnlyToggle.checked);
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

  if (clearBtn) {
    clearBtn.style.display = query ? 'flex' : 'none';
  }

  const menuItems = document.querySelectorAll('#menu-grid .menu-item-card');
  let visibleCount = 0;

  menuItems.forEach(item => {
    const itemCategory = item.getAttribute('data-category');
    const isVeg = item.getAttribute('data-veg') === 'true';
    const isCold = item.getAttribute('data-cold') === 'true';
    const title = (item.querySelector('.item-card-title')?.textContent || '').toLowerCase();
    const desc = (item.querySelector('.item-card-desc')?.textContent || '').toLowerCase();

    const matchesCategory = (currentCategory === 'all' || itemCategory === currentCategory);
    const matchesVeg = !isVegOnly || isVeg;
    const matchesCold = !isColdOnly || isCold;
    const matchesSearch = !query || title.includes(query) || desc.includes(query);

    if (matchesCategory && matchesVeg && matchesCold && matchesSearch) {
      item.classList.remove('is-hidden-by-filter');
      item.style.display = '';
      visibleCount++;
    } else {
      item.classList.add('is-hidden-by-filter');
      item.style.display = 'none';
    }
  });

  const emptyNotice = document.getElementById('menu-empty-notice');
  if (emptyNotice) {
    emptyNotice.style.display = visibleCount === 0 ? 'block' : 'none';
  }
}

function initMenuFiltersAndSearch() {
  const tabs = document.querySelectorAll('.menu-category-tab');
  const vegOnlyToggle = document.getElementById('filter-veg-only');
  const coldOnlyToggle = document.getElementById('filter-cold-only');
  const searchInput = document.getElementById('menu-search-input');
  const clearBtn = document.getElementById('menu-search-clear');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      applyMenuFilters();
    });
  });

  if (vegOnlyToggle) {
    vegOnlyToggle.addEventListener('change', applyMenuFilters);
  }
  if (coldOnlyToggle) {
    coldOnlyToggle.addEventListener('change', applyMenuFilters);
  }
  if (searchInput) {
    searchInput.addEventListener('input', applyMenuFilters);
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      applyMenuFilters();
    });
  }

  // Initial filtering pass
  applyMenuFilters();
}

window.applyMenuFilters = applyMenuFilters;
window.initMenuFiltersAndSearch = initMenuFiltersAndSearch;

/**
 * Scrollspy for Active Navigation Link Highlighting
 */
function initScrollspy() {
  const sections = document.querySelectorAll('section[id], header[id]');
  const navLinks = document.querySelectorAll('.nav-links .nav-link');

  const onScroll = () => {
    const scrollPos = window.scrollY + 120;

    sections.forEach(section => {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      const id = section.getAttribute('id');

      if (scrollPos >= top && scrollPos < top + height) {
        navLinks.forEach(link => {
          link.classList.remove('is-active');
          if (link.getAttribute('href') === `#${id}`) {
            link.classList.add('is-active');
          }
        });
      }
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
}

/**
 * Subtle Scroll Reveal Animations (Respects prefers-reduced-motion)
 */
function initScrollAnimations() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  const revealElements = document.querySelectorAll('.reveal-on-scroll');
  if (!('IntersectionObserver' in window)) {
    revealElements.forEach(el => el.classList.add('is-revealed'));
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        obs.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  revealElements.forEach(el => observer.observe(el));
}
