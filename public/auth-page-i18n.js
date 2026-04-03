(function (global) {
  const DEFAULT_LANG = 'en';

  function resolve(obj, path) {
    return String(path || '').split('.').reduce((node, key) => node && node[key], obj);
  }

  async function loadMessages() {
    const preferred = global.navigator?.language || DEFAULT_LANG;
    try {
      const res = await fetch('/api/i18n', {
        headers: { 'Accept-Language': preferred },
      });
      const payload = await res.json();
      const lang = payload?.lang || DEFAULT_LANG;
      const messages = payload?.messages || {};
      document.documentElement.lang = lang;
      return { lang, messages };
    } catch {
      document.documentElement.lang = DEFAULT_LANG;
      return { lang: DEFAULT_LANG, messages: {} };
    }
  }

  global.travelAgentAuthI18n = {
    async init(pageKey) {
      const { lang, messages } = await loadMessages();
      return {
        lang,
        t(key, fallback) {
          return resolve(messages, key) || fallback || key;
        },
        shared(key, fallback) {
          return resolve(messages, `auth.shared.${key}`) || fallback || key;
        },
        page(key, fallback) {
          return resolve(messages, `auth.${pageKey}.${key}`) || fallback || key;
        },
      };
    },
  };
})(window);