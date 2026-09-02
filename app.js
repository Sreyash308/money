/**
 * Ochre Coffee Roasters - Modern Specialty Cafe Web Application
 * Vanilla JavaScript (Zero Dependencies, Performance Optimized)
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initMenuFilter();
  initScrollAnimations();
  initScrollspy();
});

/**
 * Sticky Navbar & Mobile Navigation Drawer
 */
function initNavbar() {
  const navbar = document.getElementById('main-navbar');
  const mobileToggle = document.getElementById('mobile-menu-toggle');
  const mobileDrawer = document.getElementById('mobile-drawer');
  const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-link');

  // Sticky navbar shadow and shrink on scroll
  const handleScroll = () => {
    if (window.scrollY > 20) {
      navbar.classList.add('navbar-scrolled');
    } else {
      navbar.classList.remove('navbar-scrolled');
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // Mobile menu toggle
  if (mobileToggle && mobileDrawer) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileDrawer.classList.contains('is-open');
      if (isOpen) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });

    // Close mobile menu on link click
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        if (mobileDrawer.classList.contains('is-open')) {
          closeMobileMenu();
        }
      });
    });

    // Close on Escape key
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
  const menuItems = document.querySelectorAll('.menu-item-card');
  const vegOnlyToggle = document.getElementById('filter-veg-only');
  const coldOnlyToggle = document.getElementById('filter-cold-only');
  let currentCategory = 'all';

  function filterItems() {
    const isVegOnly = vegOnlyToggle ? vegOnlyToggle.checked : false;
    const isColdOnly = coldOnlyToggle ? coldOnlyToggle.checked : false;
    let visibleCount = 0;

    menuItems.forEach(item => {
      const itemCategory = item.getAttribute('data-category');
      const isVeg = item.getAttribute('data-veg') === 'true';
      const isCold = item.getAttribute('data-cold') === 'true';

      const matchesCategory = (currentCategory === 'all' || itemCategory === currentCategory);
      const matchesVeg = !isVegOnly || isVeg;
      const matchesCold = !isColdOnly || isCold;

      if (matchesCategory && matchesVeg && matchesCold) {
        item.classList.remove('is-hidden');
        item.style.display = '';
        visibleCount++;
      } else {
        item.classList.add('is-hidden');
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

  if (vegOnlyToggle) {
    vegOnlyToggle.addEventListener('change', filterItems);
  }

  if (coldOnlyToggle) {
    coldOnlyToggle.addEventListener('change', filterItems);
  }
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
