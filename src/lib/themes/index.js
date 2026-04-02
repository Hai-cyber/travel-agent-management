import { SIX_SENSES_THEME_KEY, createSixSensesTheme } from './six-senses.js';

function createDefaultTheme() {
  return {
    key: 'default-editorial',
    label: 'Default Editorial Frame',
    bodyClass: '',
    admin: {
      title: 'Universal',
      subtitle: 'Multi-Skin Admin',
      vars: {
        '--shell-bg': '#0f1720',
        '--shell-line': 'rgba(255, 255, 255, 0.12)',
        '--shell-text': '#f8fafc',
        '--shell-muted': 'rgba(248, 250, 252, 0.7)',
        '--shell-purple': '#475569',
      },
    },
  };
}

const THEME_FACTORIES = [createSixSensesTheme];

export { SIX_SENSES_THEME_KEY };

export function listUniversalThemes(helpers = {}) {
  return [...THEME_FACTORIES.map((factory) => factory(helpers)), createDefaultTheme()];
}

export function resolveUniversalTheme(site = {}, runtime = {}, helpers = {}) {
  for (const factory of THEME_FACTORIES) {
    const theme = factory(helpers);
    if (theme.matches?.(site, runtime)) {
      return theme;
    }
  }

  return createDefaultTheme();
}

export function normalizeUniversalThemeKey(site = {}, runtime = {}) {
  if (typeof site.current_theme === 'string' && site.current_theme.trim()) {
    return site.current_theme.trim();
  }

  if (site.variant_key === 'tour-luxury' || runtime.layout_profile?.shell === 'luxury-editorial') {
    return SIX_SENSES_THEME_KEY;
  }

  return 'default-editorial';
}