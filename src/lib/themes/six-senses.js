export const SIX_SENSES_THEME_KEY = 'six-senses';

const SAMPLE_HERO_URL = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2200&q=80';

export function createSixSensesTheme(helpers = {}) {
  const {
    escapeHtml = (value) => String(value ?? ''),
    buildUniversalPublicPath = () => '#',
    buildResponsiveImageMarkup = () => '',
    normalizeStringValue = (...values) => values.find((value) => typeof value === 'string' && value.trim()) || '',
    clampNumber = (_value, _min, _max, fallback) => fallback,
  } = helpers;

  function getUi(theme = {}) {
    return theme.ui || {};
  }

  function getHeaderUi(theme = {}) {
    return getUi(theme).header || {};
  }

  function getHeroUi(theme = {}) {
    return getUi(theme).hero || {};
  }

  function getFloatingUi(theme = {}) {
    return getUi(theme).floating || {};
  }

  function getFooterUi(theme = {}) {
    return getUi(theme).footer || {};
  }

  function matches(site = {}, runtime = {}) {
    return site.current_theme === SIX_SENSES_THEME_KEY
      || site.variant_key === 'tour-luxury'
      || runtime.layout_profile?.shell === 'luxury-editorial';
  }

  function buildStoryImage(ctx) {
    const galleryBlock = Array.isArray(ctx.targetPage?.blocks)
      ? ctx.targetPage.blocks.find((entry) => entry?.type === 'gallery')
      : null;
    const galleryBlockImages = Array.isArray(galleryBlock?.content?.images) ? galleryBlock.content.images : [];
    return galleryBlockImages[0]?.src
      || ctx.gallery?.[1]?.src
      || ctx.snapshot?.hero_image
      || SAMPLE_HERO_URL;
  }

  function buildSearchPanel(theme = {}) {
    const heroUi = getHeroUi(theme);
    const searchState = theme.searchState || {};
    const action = searchState.action || '#';
    return `<form class="luxury-search-panel" method="GET" action="${escapeHtml(action)}"><div class="luxury-search-grid"><label class="luxury-search-label-primary"><span>Destination or interest</span><input type="text" name="q" value="${escapeHtml(searchState.q || '')}" aria-label="Destination or interest" placeholder="Beach, adventure, Hoi An" /></label><label><span>Travel starts</span><input type="text" name="start" value="${escapeHtml(searchState.start || '')}" aria-label="Travel starts" placeholder="12 Oct 2026" /></label><label><span>Travel ends</span><input type="text" name="end" value="${escapeHtml(searchState.end || '')}" aria-label="Travel ends" placeholder="18 Oct 2026" /></label><label><span>Guests</span><input type="text" name="pax" value="${escapeHtml(searchState.pax || '')}" aria-label="Guests" placeholder="2 adults" /></label><label><span>Code</span><input type="text" name="code" value="${escapeHtml(searchState.code || '')}" aria-label="Code" placeholder="Private" /></label></div><button type="submit" class="luxury-search-cta">${escapeHtml(heroUi.searchButtonLabel || 'Search')}</button></form>`;
  }

  function renderHero(ctx) {
    const heroUi = getHeroUi(ctx.theme);
    const content = ctx.block.content || {};
    const runtimeHero = ctx.targetPage.page_key === ctx.homePageKey ? ctx.tourRuntime.featured_tour : null;
    const primaryCtaLabel = ctx.targetPage.page_key === ctx.homePageKey ? 'Explore' : (content.primary_cta_label || 'Explore');
    const image = content.hero_image || runtimeHero?.hero_image || ctx.snapshot?.hero_image || SAMPLE_HERO_URL;
    const imageBrightness = clampNumber(content.image_brightness, 0.4, 1.4, 1);
    const overlayStrength = clampNumber(content.overlay_strength, 0.12, 0.92, 0.56);
    const isVideo = /\.(mp4|webm)(\?|#|$)/i.test(image);
    const mediaMarkup = image
      ? (isVideo
        ? `<video class="luxury-hero-media-asset" style="filter:brightness(${escapeHtml(String(imageBrightness))})" autoplay muted loop playsinline src="${escapeHtml(image)}"></video>`
        : `<div style="filter:brightness(${escapeHtml(String(imageBrightness))})">${buildResponsiveImageMarkup(image, content.headline || ctx.targetTitle, 'luxury-hero-media-asset', 'cover', '100vw')}</div>`)
      : '<div class="luxury-hero-media-fallback">Replace with a cinematic hero image or video.</div>';
    const searchMarkup = ctx.targetPage.page_key === ctx.homePageKey && heroUi.showSearchPanel !== false ? `<div class="luxury-hero-search-wrap">${buildSearchPanel({ ...ctx.theme, searchState: ctx.searchState || {} })}</div>` : '';
    const heroButtons = ctx.targetPage.page_key === ctx.homePageKey && heroUi.showModuleShortcuts !== false
      ? ctx.resolveHeroModuleMenuItems()
          .map((item) => `<a href="${escapeHtml(ctx.buildMenuHref(item))}" class="luxury-hero-side-link">${escapeHtml(item.label || item.page_key || 'Page')}</a>`)
          .join('')
      : '';
    const heroSidePanel = heroButtons
      ? `<aside class="luxury-hero-side-panel"><div class="luxury-hero-side-links">${heroButtons}</div></aside>`
      : '';

    const mapLinkMarkup = heroUi.showMapLink === false ? '' : `<a href="${escapeHtml(heroUi.mapLinkHref || '#section-destinations')}" class="luxury-map-link">${escapeHtml(heroUi.mapLinkLabel || 'View map')}</a>`;
    const secondaryCtaMarkup = heroUi.showSecondaryCta === false
      ? ''
      : `<a href="${escapeHtml(content.secondary_cta_href || buildUniversalPublicPath(ctx.site.tenant_id, 'contact-us'))}" class="luxury-secondary-cta">${escapeHtml(content.secondary_cta_label || 'Plan with concierge')}</a>`;
    return `<section class="luxury-hero ${ctx.targetPage.page_key === ctx.homePageKey ? 'luxury-hero-home' : 'luxury-hero-inner'}"><div class="luxury-hero-media">${mediaMarkup}<div class="luxury-hero-overlay" style="opacity:${escapeHtml(String(overlayStrength))}"></div></div><div class="luxury-hero-copy">${mapLinkMarkup}<p class="luxury-hero-eyebrow">${escapeHtml(content.eyebrow || ctx.runtime.variant_label || '')}</p><h1>${escapeHtml(content.headline || runtimeHero?.title || ctx.targetTitle)}</h1><p class="luxury-hero-body">${escapeHtml(content.body || runtimeHero?.summary || ctx.targetDescription)}</p><div class="luxury-hero-actions"><a href="${escapeHtml(content.primary_cta_href || '#section-featured-tours')}" class="luxury-primary-cta">${escapeHtml(primaryCtaLabel)}</a>${secondaryCtaMarkup}</div></div>${heroSidePanel}${searchMarkup}</section>`;
  }

  function renderGallery(ctx) {
    const images = Array.isArray(ctx.block.content?.images) && ctx.block.content.images.length
      ? ctx.block.content.images
      : (ctx.tourRuntime.featured_collection?.gallery_images?.length ? ctx.tourRuntime.featured_collection.gallery_images : ctx.gallery);
    if (!images.length) return '';

    return `<section class="luxury-gallery-band" data-luxury-gallery><div class="luxury-gallery-head"><p class="luxury-section-kicker">${escapeHtml(ctx.block.label || 'Gallery')}</p><h2>${escapeHtml(ctx.block.content?.heading || 'Gallery')}</h2><p>${escapeHtml(ctx.block.content?.body || 'Move through the collection one frame at a time, with large left and right controls instead of a raw scroll bar.')}</p></div><div class="luxury-gallery-stage">${images.map((item, index) => `<figure class="luxury-gallery-slide ${index === 0 ? 'is-active' : ''}" data-gallery-item="${escapeHtml(String(index))}">${buildResponsiveImageMarkup(item.src, item.alt || ctx.targetTitle, 'luxury-gallery-image', 'cover', '(min-width: 1200px) 100vw, 100vw')}<figcaption>${escapeHtml(item.caption || item.alt || ctx.targetTitle)}</figcaption></figure>`).join('')}<button type="button" class="luxury-gallery-nav luxury-gallery-prev" data-gallery-nav="-1" aria-label="Previous image">&lt;</button><button type="button" class="luxury-gallery-nav luxury-gallery-next" data-gallery-nav="1" aria-label="Next image">&gt;</button></div><div class="luxury-gallery-thumbs">${images.map((item, index) => `<button type="button" class="luxury-gallery-thumb ${index === 0 ? 'is-active' : ''}" data-gallery-thumb="${escapeHtml(String(index))}"><span>${escapeHtml(String(index + 1).padStart(2, '0'))}</span><strong>${escapeHtml(item.alt || item.caption || ctx.targetTitle)}</strong></button>`).join('')}</div></section>`;
  }

  function renderFeatures(ctx) {
    const items = Array.isArray(ctx.block.content?.items) ? ctx.block.content.items : ctx.highlights;
    if (!items.length) return '';

    const storyImage = ctx.block.content?.story_image || buildStoryImage(ctx);
    return `<section class="luxury-story-block"><div class="luxury-story-media">${buildResponsiveImageMarkup(storyImage, ctx.block.content?.heading || 'Story image', 'luxury-story-image', 'cover', '(min-width: 1200px) 36vw, 100vw')}</div><div class="luxury-story-copy"><p class="luxury-section-kicker">${escapeHtml(ctx.block.label || 'Story')}</p><h2>${escapeHtml(ctx.block.content?.heading || 'Why travelers choose us')}</h2><p class="luxury-story-body">${escapeHtml(ctx.block.content?.body || 'Quiet service, slow pacing, and design-led travel planning replace the usual brochure rhythm.')}</p><div class="luxury-story-list">${items.slice(0, 3).map((item) => `<article><h3>${escapeHtml(item.title || '')}</h3><p>${escapeHtml(item.body || '')}</p></article>`).join('')}</div></div></section>`;
  }

  function buildCollectionCard(ctx, card, options = {}) {
    const {
      block,
      targetPage,
      href,
      kicker,
      portrait = false,
      imageSizes = '(min-width: 1024px) 30vw, 100vw',
    } = options;
    return ctx.wrapEditableEntityCard({
      block,
      card,
      targetPage,
      className: 'universal-entity-card luxury-entity-shell luxury-carousel-item',
      contentHtml: `<a href="${escapeHtml(href)}" class="luxury-collection-card"><div class="luxury-collection-media ${portrait || card.image_layout === 'portrait' ? 'is-portrait' : ''}">${buildResponsiveImageMarkup(card.image, card.title, 'luxury-collection-image', 'cover', imageSizes)}</div><div class="luxury-collection-copy"><p class="luxury-card-kicker">${escapeHtml(card.eyebrow || kicker)}</p><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.body)}</p>${card.meta ? `<span class="luxury-card-meta">${escapeHtml(card.meta)}</span>` : ''}</div></a>`,
    });
  }

  function renderCollectionCarousel(ctx, options = {}) {
    const {
      cards = [],
      kicker,
      heading,
      body,
      accentColor,
      visibleCards = 3,
      portrait = false,
      hrefBuilder,
      imageSizes,
      emptyBody = '',
      carouselLabel,
    } = options;
    if (!cards.length) return '';

    const showNav = cards.length > visibleCards;
    const label = carouselLabel || heading || ctx.targetPage.title || ctx.block.label || 'Collection';
    return `<section class="luxury-collection" style="--luxury-accent:${escapeHtml(accentColor)}"><div class="luxury-collection-head"><div><p class="luxury-section-kicker">${escapeHtml(kicker)}</p><h2>${escapeHtml(heading)}</h2></div><p>${escapeHtml(body || emptyBody)}</p></div><div class="luxury-collection-carousel ${portrait ? 'is-portrait' : ''}" data-luxury-carousel aria-label="${escapeHtml(label)}" style="--luxury-carousel-visible:${escapeHtml(String(visibleCards))}"><div class="luxury-collection-viewport"><div class="luxury-collection-track">${cards.map((card) => buildCollectionCard(ctx, card, {
      block: ctx.block,
      targetPage: ctx.targetPage,
      href: hrefBuilder(card),
      kicker: portrait ? (ctx.block.content?.card_label || 'Stay') : (ctx.block.content?.card_label || 'Collection'),
      portrait,
      imageSizes,
    })).join('')}</div></div>${showNav ? `<div class="luxury-collection-controls"><button type="button" class="luxury-collection-nav luxury-collection-prev" data-carousel-nav="-1" aria-label="Previous ${escapeHtml(label)}">&lt;</button><button type="button" class="luxury-collection-nav luxury-collection-next" data-carousel-nav="1" aria-label="Next ${escapeHtml(label)}">&gt;</button></div>` : ''}</div></section>`;
  }

  function renderRich(ctx) {
    if (ctx.targetPage.page_key !== 'accommodation') return '';
    const cards = ctx.resolveListingCards('tour_runtime.accommodation_listing', ctx.targetPage);
    return renderCollectionCarousel(ctx, {
      cards,
      kicker: ctx.block.label || 'Accommodation',
      heading: ctx.block.content?.heading || 'Accommodation',
      body: ctx.block.content?.body || ctx.targetDescription,
      accentColor: normalizeStringValue(ctx.block.content?.accent_color, ctx.theme.colorAccent, '#7f3f73'),
      visibleCards: 4,
      portrait: true,
      hrefBuilder: (card) => card.href || buildUniversalPublicPath(ctx.site.tenant_id, ctx.homeSlug),
      imageSizes: '(min-width: 1024px) 24vw, 100vw',
      emptyBody: ctx.targetDescription,
      carouselLabel: 'Accommodation collection',
    });
  }

  function renderListing(ctx) {
    const cards = Array.isArray(ctx.cards) ? ctx.cards : ctx.resolveListingCards(ctx.block.data_bindings?.cards?.source, ctx.targetPage);
    if (!cards.length && ctx.searchState?.q) {
      return `<section class="luxury-collection" style="--luxury-accent:${escapeHtml(normalizeStringValue(ctx.block.content?.accent_color, ctx.theme.colorAccent, '#7f3f73'))}"><div class="luxury-collection-head"><div><p class="luxury-section-kicker">Search</p><h2>No matching journeys</h2></div><p>Try another destination or interest such as beach, culture, nature, or a specific place name.</p></div></section>`;
    }
    const accentColor = normalizeStringValue(ctx.block.content?.accent_color, ctx.theme.colorAccent, '#7f3f73');
    const isHotelCollection = String(ctx.block.data_bindings?.cards?.source || '').toLowerCase().includes('accommodation');
    return renderCollectionCarousel(ctx, {
      cards,
      kicker: ctx.targetPage.title || ctx.block.label || 'Collection',
      heading: ctx.block.content?.heading || 'Collection',
      body: ctx.block.content?.body || '',
      accentColor,
      visibleCards: isHotelCollection ? 4 : 3,
      portrait: isHotelCollection,
      hrefBuilder: (card) => card.href || buildUniversalPublicPath(ctx.site.tenant_id, ctx.targetPage.slug || ctx.targetPage.page_key || ctx.homeSlug),
      imageSizes: isHotelCollection ? '(min-width: 1024px) 24vw, 100vw' : '(min-width: 1024px) 30vw, 100vw',
      carouselLabel: ctx.block.content?.heading || ctx.block.label || 'Collection',
    });
  }

  function renderHeader(ctx) {
    const headerUi = getHeaderUi(ctx.theme);
    const primaryCtaHref = ctx.headerCtaHref || '#';
    const primaryCtaLabel = ctx.headerCtaLabel || '';
    const menuButtonMarkup = headerUi.showMenuButton === false ? '<div></div>' : `<button type="button" class="luxury-menu-toggle" aria-label="Open navigation"><span></span><span></span><span></span></button>`;
    const languageMarkup = headerUi.showLanguageChip === false ? '' : `<span class="luxury-lang-chip">${escapeHtml(headerUi.languageLabel || 'EN')}</span>`;
    const loginHref = headerUi.loginHref || buildUniversalPublicPath(ctx.site.tenant_id, 'contact-us');
    const loginMarkup = headerUi.showLoginLink === false ? '' : `<a href="${escapeHtml(loginHref)}" class="luxury-login-link">${escapeHtml(headerUi.loginLabel || 'Login')}</a>`;
    const bookNowMarkup = headerUi.showBookNowButton === false || !primaryCtaLabel
      ? ''
      : `<a href="${escapeHtml(primaryCtaHref)}" class="luxury-book-now">${escapeHtml(primaryCtaLabel)}</a>`;
    return `<header class="luxury-header"><div class="luxury-header-inner"><div class="luxury-header-left">${menuButtonMarkup}</div><a href="${escapeHtml(buildUniversalPublicPath(ctx.site.tenant_id, ctx.homeSlug))}" class="luxury-logo">${ctx.logoMarkup}</a><div class="luxury-header-right">${languageMarkup}${loginMarkup}${bookNowMarkup}</div></div></header>${renderDrawer(ctx)}${renderSocialRail(ctx)}`;
  }

  function renderDrawer(ctx) {
    const headerUi = getHeaderUi(ctx.theme);
    const drawerTitle = getUi(ctx.theme).menuDrawer?.title || 'Curated Menu';
    if (headerUi.showMenuButton === false || !ctx.menuItems.length) return '';
    return `<div class="luxury-drawer-backdrop" data-luxury-close="true"></div><aside class="luxury-drawer" aria-label="Luxury navigation"><div class="luxury-drawer-head"><span>${escapeHtml(drawerTitle)}</span><button type="button" class="luxury-drawer-close" data-luxury-close="true">Close</button></div><nav class="luxury-drawer-nav">${ctx.menuItems.map((item) => `<a href="${escapeHtml(ctx.buildMenuHref(item))}" target="${escapeHtml(item.target || '_self')}"${item.is_external ? ' rel="noreferrer"' : ''}>${escapeHtml(item.label || item.page_key || 'Page')}</a>`).join('')}</nav></aside>`;
  }

  function renderSocialRail(ctx) {
    if (getUi(ctx.theme).socialRail?.visible === false || !ctx.socialEntries.length) return '';
    return `<aside class="luxury-social-rail">${ctx.socialEntries.map(([key, value]) => `<a href="${escapeHtml(ctx.buildChannelHref(key, value))}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(ctx.buildChannelLabel(key, value))}">${escapeHtml(ctx.buildSocialMonogram(key))}</a>`).join('')}</aside>`;
  }

  function renderFooter(ctx) {
    const footerUi = getFooterUi(ctx.theme);
    const navColumn = footerUi.showNavigation === false ? '' : `<div><p class="luxury-footer-heading">${escapeHtml(ctx.site.site_name || 'Travel House')}</p><div class="luxury-footer-links">${ctx.menuItems.slice(0, 8).map((item) => `<a href="${escapeHtml(ctx.buildMenuHref(item))}">${escapeHtml(item.label || item.page_key || 'Page')}</a>`).join('') || '<span>Navigation stays tenant-controlled.</span>'}</div></div>`;
    const contactColumn = footerUi.showContacts === false ? '' : `<div><p class="luxury-footer-heading">Get in touch</p><div class="luxury-footer-links">${['phone', 'email', 'address'].map((key) => ctx.channels[key]?.enabled && ctx.channels[key]?.value ? `<a href="${escapeHtml(ctx.buildChannelHref(key, ctx.channels[key]))}">${escapeHtml(ctx.channels[key].value)}</a>` : '').join('') || '<span>Concierge details can be configured per tenant.</span>'}</div></div>`;
    const legalMarkup = footerUi.showLegalLinks === false ? '' : `<div class="luxury-footer-links luxury-footer-legal">${ctx.legalPages.map((entry) => `<a href="${escapeHtml(buildUniversalPublicPath(ctx.site.tenant_id, entry.slug || entry.page_key))}">${escapeHtml(entry.title)}</a>`).join('')}</div>`;
    const socialColumn = footerUi.showSocials === false ? '' : `<div><p class="luxury-footer-heading">Follow</p><div class="luxury-footer-socials">${ctx.socialEntries.map(([key, value]) => `<a href="${escapeHtml(ctx.buildChannelHref(key, value))}" target="_blank" rel="noreferrer">${escapeHtml(ctx.buildSocialMonogram(key))}</a>`).join('') || '<span>Social channels can be toggled per tenant.</span>'}</div>${legalMarkup}</div>`;
    return `<footer class="luxury-footer"><div class="luxury-footer-grid"><div class="luxury-footer-brand"><a href="${escapeHtml(buildUniversalPublicPath(ctx.site.tenant_id, ctx.homeSlug))}" class="luxury-footer-logo">${ctx.logoMarkup}</a><p class="luxury-footer-kicker">${escapeHtml(footerUi.kickerText || 'Private journeys, quietly crafted')}</p></div>${navColumn}${contactColumn}${socialColumn}</div></footer>`;
  }

  function renderFloatingBookNow(ctx) {
    const floatingUi = getFloatingUi(ctx.theme);
    const contactButtons = [];
    if (floatingUi.showContactDock) {
      if (floatingUi.showPhone !== false && ctx.channels.phone?.enabled && ctx.channels.phone?.value) {
        contactButtons.push(['phone', ctx.channels.phone]);
      }
      if (floatingUi.showEmail !== false && ctx.channels.email?.enabled && ctx.channels.email?.value) {
        contactButtons.push(['email', ctx.channels.email]);
      }
      if (floatingUi.showWhatsapp !== false && ctx.channels.whatsapp?.enabled && ctx.channels.whatsapp?.value) {
        contactButtons.push(['whatsapp', ctx.channels.whatsapp]);
      }
      if (floatingUi.showInstagram !== false && ctx.channels.instagram?.enabled && ctx.channels.instagram?.value) {
        contactButtons.push(['instagram', ctx.channels.instagram]);
      }
    }
    const dockMarkup = contactButtons.length
      ? `<aside class="luxury-social-rail luxury-social-rail-floating">${contactButtons.map(([key, value]) => `<a href="${escapeHtml(ctx.buildChannelHref(key, value))}" target="${key === 'phone' || key === 'email' ? '_self' : '_blank'}"${key === 'phone' || key === 'email' ? '' : ' rel="noreferrer"'} aria-label="${escapeHtml(ctx.buildChannelLabel(key, value))}">${escapeHtml(ctx.buildSocialMonogram(key))}</a>`).join('')}</aside>`
      : '';
    return floatingUi.showContactDock ? dockMarkup : '';
  }

  function buildScript(ctx = {}) {
    const headerUi = getHeaderUi(ctx.theme);
    const floatingUi = getFloatingUi(ctx.theme);
    const solidOnScroll = headerUi.solidOnScroll !== false;
    const revealOnScroll = floatingUi.revealOnScroll !== false;
    return `<script>(function(){const body=document.body;const open=document.querySelector('.luxury-menu-toggle');const closers=document.querySelectorAll('[data-luxury-close="true"]');const hero=document.querySelector('.luxury-hero');const setState=(next)=>{body.dataset.menuOpen=next?'true':'false';};const refreshHeader=()=>{const trigger=hero?Math.max(hero.offsetHeight-140,240):240;const pastHero=window.scrollY>trigger;body.dataset.headerSolid=${solidOnScroll ? "pastHero?'true':'false'" : "'true'"};body.dataset.bookNowVisible=${revealOnScroll ? "window.scrollY>Math.max(trigger*0.35,72)?'true':'false'" : "'true'"};};const initCarousel=(carousel)=>{const viewport=carousel.querySelector('.luxury-collection-viewport');const track=carousel.querySelector('.luxury-collection-track');const items=[...carousel.querySelectorAll('.luxury-carousel-item')];if(!viewport||!track||!items.length)return;const controls=[...carousel.querySelectorAll('[data-carousel-nav]')];let index=0;const readVisible=()=>Math.max(1,Math.round(parseFloat(getComputedStyle(carousel).getPropertyValue('--luxury-carousel-visible'))||1));const sync=()=>{const visible=readVisible();const max=Math.max(0,items.length-visible);const gap=parseFloat(getComputedStyle(track).columnGap||getComputedStyle(track).gap||'0')||0;const itemWidth=items[0].getBoundingClientRect().width||0;const offset=(itemWidth+gap)*Math.min(index,max);track.style.transform='translateX(' + (-offset) + 'px)';carousel.dataset.atStart=index<=0?'true':'false';carousel.dataset.atEnd=index>=max?'true':'false';controls.forEach((button)=>{const delta=Number(button.dataset.carouselNav||0);button.disabled=delta<0?index<=0:index>=max;});};controls.forEach((button)=>button.addEventListener('click',()=>{const visible=readVisible();const max=Math.max(0,items.length-visible);index=Math.min(max,Math.max(0,index+Number(button.dataset.carouselNav||0)));sync();}));window.addEventListener('resize',sync);sync();};if(open){open.addEventListener('click',()=>setState(body.dataset.menuOpen!=='true'));}closers.forEach((node)=>node.addEventListener('click',()=>setState(false)));document.addEventListener('keydown',(event)=>{if(event.key==='Escape'){setState(false);}});window.addEventListener('scroll',refreshHeader,{passive:true});window.addEventListener('resize',refreshHeader);refreshHeader();document.querySelectorAll('[data-luxury-gallery]').forEach((gallery)=>{const items=[...gallery.querySelectorAll('[data-gallery-item]')];const thumbs=[...gallery.querySelectorAll('[data-gallery-thumb]')];const show=(index)=>{if(!items.length)return;const next=((index%items.length)+items.length)%items.length;gallery.dataset.galleryIndex=String(next);items.forEach((item,itemIndex)=>item.classList.toggle('is-active',itemIndex===next));thumbs.forEach((thumb,thumbIndex)=>thumb.classList.toggle('is-active',thumbIndex===next));};gallery.querySelectorAll('[data-gallery-nav]').forEach((button)=>button.addEventListener('click',()=>show(Number(gallery.dataset.galleryIndex||0)+Number(button.dataset.galleryNav||0))));thumbs.forEach((thumb,thumbIndex)=>thumb.addEventListener('click',()=>show(thumbIndex)));show(0);});document.querySelectorAll('[data-luxury-carousel]').forEach(initCarousel);})();</script>`;
  }

  return {
    key: SIX_SENSES_THEME_KEY,
    label: 'Six Senses Immersive Frame',
    bodyClass: 'luxury-editorial',
    matches,
    admin: {
      title: 'Six Senses',
      subtitle: 'Preview-First Admin',
      vars: {
        '--shell-bg': '#0b1016',
        '--shell-line': 'rgba(255, 255, 255, 0.12)',
        '--shell-text': '#f8f3ed',
        '--shell-muted': 'rgba(248, 243, 237, 0.7)',
        '--shell-purple': '#7f3f73',
      },
    },
    renderHero,
    renderGallery,
    renderFeatures,
    renderRich,
    renderListing,
    renderHeader,
    renderFooter,
    renderFloatingBookNow,
    buildScript,
  };
}