const PROXY_PREFIX = '/proxy?url=';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = e.request.url;

  const isM3U8 = url.includes('.m3u8');
  const isTS = url.includes('.ts') || url.includes('.aac');
  const isMediaCDN = url.includes('sunshinerays93.live') || url.includes('haildrop77.pro') || isCDNUrl(url);

  if ((isM3U8 || isTS) && isMediaCDN) {
    e.respondWith(fetchViaServerProxy(url));
    return;
  }
});

function isCDNUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const origin = self.location.origin;
    const appHost = new URL(origin).hostname;
    return host !== appHost && !host.includes('jikan.moe') && !host.includes('subdl.com') && !host.includes('fonts.googleapis.com') && parsed.pathname.match(/\.(m3u8|ts|aac|mp4|vtt)(\?|$)/);
  } catch {
    return false;
  }
}

async function fetchViaServerProxy(originalUrl) {
  const proxyUrl = '/proxy?url=' + encodeURIComponent(originalUrl);
  try {
    const res = await fetch(proxyUrl);
    return res;
  } catch (err) {
    return new Response('Proxy fetch failed: ' + err.message, { status: 502 });
  }
}
