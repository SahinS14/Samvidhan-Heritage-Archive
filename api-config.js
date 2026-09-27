(() => {
  const localHosts = new Set(['localhost', '127.0.0.1']);
  const isLocal = localHosts.has(window.location.hostname);
  const isRender = window.location.hostname.endsWith('.onrender.com');
  window.SAMVIDHAN_API_BASE = isLocal || isRender ? '' : 'https://samvidhan-heritage-archive.onrender.com';

  if (!window.SAMVIDHAN_API_BASE) return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const target = typeof input === 'string' && input.startsWith('/api/')
      ? `${window.SAMVIDHAN_API_BASE}${input}`
      : input;
    return nativeFetch(target, init);
  };
})();
