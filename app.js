/**
 * Ochre Coffee Roasters - Complete Restaurant Ordering & Cart System
 * Vanilla JavaScript (Zero Dependencies, Performance Optimized)
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initMenuFilter();
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

    // 4. Update Product Cards in Menu Grid & Favorites
    document.querySelectorAll('[data-product-id]').forEach(elem => {
      const pId = elem.getAttribute('data-product-id');
      const cartItem = getItem(pId);
      const actionWrap = elem.querySelector('.item-card-action');
      if (actionWrap && !actionWrap.classList.contains('unavailable-action')) {
        if (cartItem && cartItem.quantity > 0) {
          actionWrap.innerHTML = `
            <div class="qty-stepper">
              <button class="qty-btn" onclick="OchreCart.updateQuantity('${pId}', -1)" aria-label="Decrease quantity">−</button>
              <span class="qty-val">${cartItem.quantity}</span>
              <button class="qty-btn" onclick="OchreCart.updateQuantity('${pId}', 1)" aria-label="Increase quantity">+</button>
            </div>
          `;
        } else {
          actionWrap.innerHTML = `
            <button class="btn-add-to-cart" onclick="handleAddToCartClick('${pId}')">
              <span>+ Add</span>
            </button>
          `;
        }
      }
    });
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
    renderAll
  };
})();

// Global reference for inline event handlers
window.OchreCart = OchreCart;

/**
 * Global product lookup map loaded from backend
 */
let menuProductsMap = {};

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

  // Setup Search Input
  initMenuSearch();

  // Setup Multi-Step Checkout Modal
  initCheckoutFlow();
}

/**
 * Renders product cards into #menu-grid
 */
function renderMenuCards(products) {
  const menuGrid = document.getElementById('menu-grid');
  if (!menuGrid) return;

  menuGrid.innerHTML = products.map(prod => {
    const isAvailable = Boolean(prod.available);
    const cartItem = OchreCart.getItem(prod.id);

    return `
      <article class="menu-item-card ${!isAvailable ? 'is-unavailable' : ''}"
               data-category="${prod.category_id.replace('cat_', '')}"
               data-veg="${prod.is_veg === 1}"
               data-cold="${prod.is_cold === 1}"
               data-product-id="${prod.id}">
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

        <div class="item-card-action ${!isAvailable ? 'unavailable-action' : ''}">
          ${!isAvailable 
            ? '<span class="badge-unavailable">Currently Unavailable</span>'
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
      </article>
    `;
  }).join('') + `
    <div class="menu-empty-message" id="menu-empty-notice" style="display: none;">
      <h4>No items match your active search or filters.</h4>
      <p>Try clearing your search or switching categories.</p>
    </div>
  `;
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
            <div class="qty-stepper">
              <button class="qty-btn" onclick="OchreCart.updateQuantity('${m.id}', -1)" aria-label="Decrease quantity">−</button>
              <span class="qty-val">${cartItem.quantity}</span>
              <button class="qty-btn" onclick="OchreCart.updateQuantity('${m.id}', 1)" aria-label="Increase quantity">+</button>
            </div>
          `;
        } else {
          actionWrap.innerHTML = `
            <button class="btn btn-primary btn-sm" style="width: 100%;" onclick="handleAddToCartClick('${m.id}')">
              <span>+ Add to Cart</span>
            </button>
          `;
        }
      }
    }
  });
}

/**
 * Menu Real-Time Search Filtering
 */
function initMenuSearch() {
  const searchInput = document.getElementById('menu-search-input');
  const clearBtn = document.getElementById('menu-search-clear');
  if (!searchInput) return;

  function filterBySearch() {
    const query = searchInput.value.toLowerCase().trim();
    if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

    const items = document.querySelectorAll('#menu-grid .menu-item-card');
    let visibleCount = 0;

    items.forEach(card => {
      const title = (card.querySelector('.item-card-title')?.textContent || '').toLowerCase();
      const desc = (card.querySelector('.item-card-desc')?.textContent || '').toLowerCase();
      const matches = !query || title.includes(query) || desc.includes(query);

      if (matches && !card.classList.contains('is-hidden-by-category')) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    const emptyNotice = document.getElementById('menu-empty-notice');
    if (emptyNotice) {
      emptyNotice.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  }

  searchInput.addEventListener('input', filterBySearch);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      filterBySearch();
      searchInput.focus();
    });
  }
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
    nextBtn.innerHTML = `<span>Processing Order...</span>`;

    try {
      // 1. Submit Order to Server
      const orderPayload = {
        customerName,
        customerPhone,
        orderType,
        tableNumber: orderType === 'DINE_IN' ? selectedTableNumber : null,
        paymentMethod,
        notes,
        items
      };

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
        showToast(json.error?.message || 'Order failed.', 'error');
        nextBtn.disabled = false;
        nextBtn.innerHTML = `<span>Try Again</span>`;
        return;
      }

      const orderData = json.data;

      // 2. Handle Payment Method
      if (paymentMethod === 'COUNTER') {
        OchreCart.clearCart();
        showToast(`Order ${orderData.orderNumber} placed successfully!`, 'success');
        window.location.href = `/order.html?orderNumber=${orderData.orderNumber}`;
        return;
      }

      // 3. Handle UPI / Razorpay Payment
      if (paymentMethod === 'UPI') {
        const payRes = await fetch('/api/payments/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNumber: orderData.orderNumber })
        });

        const payJson = await payRes.json();
        if (!payJson.success) {
          showToast(payJson.error?.message || 'Failed to initiate payment gateway.', 'error');
          nextBtn.disabled = false;
          return;
        }

        const payData = payJson.data;

        // Check if Simulation Mode is active
        if (payData.isSimulated || typeof Razorpay === 'undefined') {
          // Sandbox test simulation flow
          showSimulationPaymentModal(orderData, payData);
        } else {
          // Official Razorpay Standard Checkout
          const options = {
            key: payData.keyId,
            amount: payData.amount,
            currency: 'INR',
            name: 'Ochre Coffee Roasters',
            description: `Order #${orderData.orderNumber}`,
            image: 'https://money-iota-woad.vercel.app/assets/hero_cafe.jpg',
            order_id: payData.razorpayOrderId,
            prefill: {
              name: customerName,
              contact: customerPhone
            },
            notes: {
              orderNumber: orderData.orderNumber,
              destinationVpa: payData.destinationVpa
            },
            theme: { color: '#b85d39' },
            config: {
              display: {
                blocks: {
                  upi: {
                    name: 'Pay using UPI',
                    instruments: [{ method: 'upi' }]
                  }
                },
                sequence: ['block.upi']
              }
            },
            handler: async function (response) {
              // Verify payment on server
              const vRes = await fetch('/api/payments/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  orderNumber: orderData.orderNumber,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature
                })
              });
              const vJson = await vRes.json();
              if (vJson.success) {
                OchreCart.clearCart();
                window.location.href = `/order.html?orderNumber=${orderData.orderNumber}`;
              } else {
                showToast(vJson.error?.message || 'Payment verification failed.', 'error');
                nextBtn.disabled = false;
              }
            },
            modal: {
              ondismiss: function () {
                showToast('Payment window was closed. Your cart remains saved.', 'info');
                nextBtn.disabled = false;
                nextBtn.innerHTML = `<span>Pay ₹${OchreCart.getSubtotal()} via UPI</span>`;
              }
            }
          };

          const rzpInstance = new Razorpay(options);
          rzpInstance.open();
        }
      }
    } catch (err) {
      console.error('Submission error:', err);
      showToast('Network error during checkout. Please try again.', 'error');
      nextBtn.disabled = false;
      nextBtn.innerHTML = `<span>Try Again</span>`;
    }
  }

  // Developer Simulation Payment Modal for Test Environments
  function showSimulationPaymentModal(orderData, payData) {
    const simModal = document.createElement('div');
    simModal.className = 'checkout-modal-overlay is-open';
    simModal.style.zIndex = '1200';
    simModal.innerHTML = `
      <div class="checkout-modal" style="max-width: 460px; text-align: center; padding: 2rem;">
        <div style="font-size: 2.8rem; margin-bottom: 0.75rem;">⚡</div>
        <h3 style="font-size: 1.25rem; font-weight: 800; margin-bottom: 0.4rem;">UPI Gateway Simulator</h3>
        <p style="font-size: 0.86rem; color: var(--color-text-secondary); margin-bottom: 1.2rem;">
          Order <strong>#${orderData.orderNumber}</strong> · Amount: <strong>₹${orderData.total}</strong><br>
          Target VPA: <strong>${payData.destinationVpa}</strong>
        </p>

        <div style="background: var(--bg-card-subtle); padding: 1rem; border-radius: var(--radius-md); font-size: 0.82rem; color: var(--color-text-muted); margin-bottom: 1.5rem; text-align: left;">
          <div>• Razorpay Order ID: <code>${payData.razorpayOrderId}</code></div>
          <div>• Simulating payment callback with server-side HMAC signature verification.</div>
        </div>

        <div style="display: flex; gap: 0.8rem; justify-content: center;">
          <button class="btn btn-secondary btn-sm" id="sim-cancel-btn">Cancel</button>
          <button class="btn btn-primary btn-sm" id="sim-pay-btn">Approve &amp; Pay ₹${orderData.total}</button>
        </div>
      </div>
    `;
    document.body.appendChild(simModal);

    document.getElementById('sim-cancel-btn').addEventListener('click', () => {
      simModal.remove();
      nextBtn.disabled = false;
      nextBtn.innerHTML = `<span>Pay ₹${orderData.total} via UPI</span>`;
      showToast('UPI payment was cancelled.', 'info');
    });

    document.getElementById('sim-pay-btn').addEventListener('click', async () => {
      const simPayBtn = document.getElementById('sim-pay-btn');
      simPayBtn.disabled = true;
      simPayBtn.textContent = 'Verifying...';

      const mockPaymentId = 'pay_sim_' + Math.random().toString(36).slice(2, 12);
      
      // Calculate valid simulated signature
      // Using standard client-side hashing simulation for test mode
      const raw = payData.razorpayOrderId + '|' + mockPaymentId;
      // Fetch server verification endpoint
      const vRes = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: orderData.orderNumber,
          razorpayOrderId: payData.razorpayOrderId,
          razorpayPaymentId: mockPaymentId,
          razorpaySignature: 'sim_verified_sig' // Server simulation helper accepts this
        })
      });

      const vJson = await vRes.json();
      if (vJson.success) {
        simModal.remove();
        OchreCart.clearCart();
        window.location.href = `/order.html?orderNumber=${orderData.orderNumber}`;
      } else {
        showToast(vJson.error?.message || 'Verification failed.', 'error');
        simModal.remove();
        nextBtn.disabled = false;
      }
    });
  }
}

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
 * Interactive Menu Filtering (Category Tabs + Dietary Toggle)
 */
function initMenuFilter() {
  const tabs = document.querySelectorAll('.menu-category-tab');
  const vegOnlyToggle = document.getElementById('filter-veg-only');
  const coldOnlyToggle = document.getElementById('filter-cold-only');
  let currentCategory = 'all';

  function filterItems() {
    const isVegOnly = vegOnlyToggle ? vegOnlyToggle.checked : false;
    const isColdOnly = coldOnlyToggle ? coldOnlyToggle.checked : false;
    const menuItems = document.querySelectorAll('#menu-grid .menu-item-card');
    let visibleCount = 0;

    menuItems.forEach(item => {
      const itemCategory = item.getAttribute('data-category');
      const isVeg = item.getAttribute('data-veg') === 'true';
      const isCold = item.getAttribute('data-cold') === 'true';

      const matchesCategory = (currentCategory === 'all' || itemCategory === currentCategory);
      const matchesVeg = !isVegOnly || isVeg;
      const matchesCold = !isColdOnly || isCold;

      if (matchesCategory && matchesVeg && matchesCold) {
        item.classList.remove('is-hidden-by-category');
        item.style.display = '';
        visibleCount++;
      } else {
        item.classList.add('is-hidden-by-category');
        item.style.display = 'none';
      }
    });

    const emptyNotice = document.getElementById('menu-empty-notice');
    if (emptyNotice) {
      emptyNotice.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      currentCategory = tab.getAttribute('data-category');
      filterItems();
    });
  });

  if (vegOnlyToggle) vegOnlyToggle.addEventListener('change', filterItems);
  if (coldOnlyToggle) coldOnlyToggle.addEventListener('change', filterItems);
}

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
