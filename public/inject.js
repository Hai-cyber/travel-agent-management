/**
 * inject.js — Site Studio client-side customisation layer
 *
 * Automatically injected before </body> by the HTMLRewriter pipeline in
 * src/lib/siteStudio.js. Runs on every page served from a tenant's custom
 * domain or platform subdomain.
 *
 * Behaviour (in order):
 *   1. Fetch  — GET /api/tenant/config (same-origin, no credentials)
 *   2. Smart guessing
 *              h1:first          ← content.hero_title
 *              img[class*=logo]  ← brand.logo_url
 *   3. Selector mapping  — loop custom_selectors, querySelectorAll each key
 *   4. Feature toggles   — hide WhatsApp elements when whatsapp_toggle = false
 *
 * Security:
 *   - Text values written via .textContent (never innerHTML)
 *   - Image src values sanitised to HTTP(S) URLs only before assignment
 *   - Custom selector try/catch prevents invalid selectors crashing the page
 *   - Fetch errors are swallowed — a config failure must never break the site
 */
(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Write plain text to an element.
   * Always uses .textContent — XSS-safe.
   */
  function setText(el, value) {
    el.textContent = value;
  }

  /**
   * Set an image src — only accepts http(s) URLs and relative paths.
   * [SEC] Prevents javascript: and data: URI injection from tenant config.
   */
  function setImageSrc(imgEl, value) {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed) || /^\/[^/]/.test(trimmed)) {
      imgEl.src = trimmed;
    }
  }

  /**
   * For a matched element: if it is an <img>, set src; otherwise set textContent.
   */
  function applyValue(el, value) {
    if (el.tagName === 'IMG') {
      setImageSrc(el, value);
    } else {
      setText(el, value);
    }
  }

  // ── Feature: hide all WhatsApp elements ───────────────────────────────────
  // Selector list covers common template patterns: class names, href patterns,
  // data attributes. Each selector is tried individually so one bad match
  // does not prevent the others from running.
  const WA_SELECTORS = [
    '[class*="whatsapp"]',
    '[class*="wa-"]',
    '[id*="whatsapp"]',
    '[data-whatsapp]',
    'a[href^="https://wa.me"]',
    'a[href^="https://api.whatsapp"]',
    'a[href*="whatsapp.com/send"]',
  ];

  function hideWhatsapp() {
    WA_SELECTORS.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (el) {
          el.style.setProperty('display', 'none', 'important');
        });
      } catch (_) {
        // Invalid selector — skip silently
      }
    });
  }

  // ── Core: apply the fetched config to the current DOM ─────────────────────
  function applyConfig(cfg) {
    var brand    = cfg.brand            || {};
    var content  = cfg.content          || {};
    var features = cfg.features         || {};
    var selectors = cfg.custom_selectors || {};

    // ╔══════════════════════════════════╗
    // ║  1. Smart guessing               ║
    // ╚══════════════════════════════════╝

    // First <h1> → hero_title
    if (content.hero_title) {
      var h1 = document.querySelector('h1');
      if (h1) setText(h1, content.hero_title);
    }

    // First <img class*="logo"> → logo_url
    if (brand.logo_url) {
      var logoImg = document.querySelector('img[class*="logo"]');
      if (logoImg) {
        setImageSrc(logoImg, brand.logo_url);
        // Only overwrite alt when blank — respect template's existing alt text
        if (!logoImg.getAttribute('alt') && brand.name) {
          logoImg.setAttribute('alt', brand.name);
        }
      }
    }

    // ╔══════════════════════════════════╗
    // ║  2. Custom selector mapping      ║
    // ╚══════════════════════════════════╝
    Object.keys(selectors).forEach(function (selector) {
      var value = selectors[selector];
      if (typeof value !== 'string') return;
      try {
        document.querySelectorAll(selector).forEach(function (el) {
          applyValue(el, value);
        });
      } catch (_) {
        // Invalid CSS selector from tenant config — skip silently
      }
    });

    // ╔══════════════════════════════════╗
    // ║  3. Feature toggles              ║
    // ╚══════════════════════════════════╝

    // whatsapp_toggle: false → hide all WhatsApp-related elements.
    // Note: explicitly === false (not falsy) so undefined/null means "default on".
    if (features.whatsapp_toggle === false) {
      hideWhatsapp();
    }

    // review_toggle: false → hide review / testimonial sections.
    if (features.review_toggle === false) {
      var REVIEW_SELECTORS = [
        '[class*="review"]',
        '[class*="testimonial"]',
        '[id*="review"]',
        '[id*="testimonial"]',
        '[data-reviews]',
      ];
      REVIEW_SELECTORS.forEach(function (sel) {
        try {
          document.querySelectorAll(sel).forEach(function (el) {
            el.style.setProperty('display', 'none', 'important');
          });
        } catch (_) {}
      });
    }

    // hotel_module_active: false → hide hotel/accommodation upsell blocks.
    if (features.hotel_module_active === false) {
      var HOTEL_SELECTORS = [
        '[class*="hotel"]',
        '[class*="accommodation"]',
        '[id*="hotel"]',
        '[data-hotel]',
      ];
      HOTEL_SELECTORS.forEach(function (sel) {
        try {
          document.querySelectorAll(sel).forEach(function (el) {
            el.style.setProperty('display', 'none', 'important');
          });
        } catch (_) {}
      });
    }
  }

  // ── Feature: dynamic category filter on tour listing page ─────────────────
  //
  // Called only when [data-component="filter-container"] exists on the page.
  // Injects an "All" button plus one button per active category fetched from
  // GET /api/categories. Clicking a button shows/hides tour cards by
  // matching [data-category-id] against the category's nanoid.
  //
  // Template contract
  // ─────────────────
  //  Filter hook : <div  data-component="filter-container"
  //                      data-label-all="Tất cả">      ← optional label override
  //  Tour card   : <article data-category-id="<nanoid>"> ← must match category.id
  //
  // Zero-code for agents: add a category in Dashboard → button appears
  // automatically, no HTML edits required.
  function buildCategoryFilter(categories, container) {
    if (!categories || !categories.length) return;

    // Inject minimal active-state styles once per page load.
    // Templates may override .ssi-filter-btn freely via their own CSS.
    if (!document.getElementById('ssi-filter-styles')) {
      var style = document.createElement('style');
      style.id = 'ssi-filter-styles';
      style.textContent =
        '.ssi-filter-btn{cursor:pointer;}' +
        '.ssi-filter-btn.ssi-active{font-weight:700;text-decoration:underline;}';
      document.head.appendChild(style);
    }

    // ── "All" button ──────────────────────────────────────────────────────────
    // Label is overridable via the data-label-all attribute on the container.
    var allLabel = container.getAttribute('data-label-all') || 'All';
    var allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.textContent = allLabel;
    allBtn.className = 'ssi-filter-btn ssi-active';
    allBtn.setAttribute('data-filter-id', '__all__');
    container.appendChild(allBtn);

    // ── Category buttons ──────────────────────────────────────────────────────
    categories.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = cat.name;
      btn.className = 'ssi-filter-btn';
      btn.setAttribute('data-filter-id', cat.id);
      btn.setAttribute('data-filter-slug', cat.slug);
      container.appendChild(btn);
    });

    // ── Event delegation — single listener on container ───────────────────────
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.ssi-filter-btn');
      if (!btn) return;

      // Update active class
      container.querySelectorAll('.ssi-filter-btn').forEach(function (b) {
        b.classList.remove('ssi-active');
      });
      btn.classList.add('ssi-active');

      var filterId = btn.getAttribute('data-filter-id');
      var isAll = filterId === '__all__';

      // Show / hide tour cards by matching data-category-id
      document.querySelectorAll('[data-category-id]').forEach(function (card) {
        if (isAll || card.getAttribute('data-category-id') === filterId) {
          card.style.removeProperty('display');
        } else {
          card.style.setProperty('display', 'none');
        }
      });
    });
  }

  // ── Bootstrap: fetch then apply ───────────────────────────────────────────
  // /api/tenant/config is same-origin → Host header is sent automatically.
  // No credentials needed — the API derives tenant identity from Host alone.
  //
  // Error handling strategy: ALL errors are caught and suppressed.
  // A dead config endpoint must NEVER cause a JS error that breaks the site.
  function run() {
    // Resolve whether this page has a category filter container up-front so
    // we avoid the /api/categories network request on pages that don't need it.
    var filterContainer = document.querySelector('[data-component="filter-container"]');

    // ── tenant config (always) ──────────────────────────────────────────────
    fetch('/api/tenant/config', {
      method:      'GET',
      credentials: 'omit',   // no cookies needed
      headers:     { 'Accept': 'application/json' },
    })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !data.config) return;
        applyConfig(data.config);
      })
      .catch(function () {
        // Network error, JSON parse error, etc. — fail silently.
      });

    // ── categories (only on listing pages with a filter container) ──────────
    if (filterContainer) {
      fetch('/api/categories', {
        method:      'GET',
        credentials: 'omit',
        headers:     { 'Accept': 'application/json' },
      })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.ok || !data.categories) return;
          buildCategoryFilter(data.categories, filterContainer);
        })
        .catch(function () {
          // Categories fetch error must never break the page.
        });
    }
  }

  // Run after DOM is interactive. If inject.js is already at end of <body>,
  // the DOM is fully parsed, but DOMContentLoaded may still be pending for
  // deferred scripts — guard with readyState for both cases.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

}());
