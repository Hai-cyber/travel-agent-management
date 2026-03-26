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

  // ── Bootstrap: fetch then apply ───────────────────────────────────────────
  // /api/tenant/config is same-origin → Host header is sent automatically.
  // No credentials needed — the API derives tenant identity from Host alone.
  //
  // Error handling strategy: ALL errors are caught and suppressed.
  // A dead config endpoint must NEVER cause a JS error that breaks the site.
  function run() {
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
