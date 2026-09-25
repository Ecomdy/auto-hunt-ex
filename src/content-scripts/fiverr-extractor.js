// Pure helpers cho Fiverr crawler. Tách khỏi DOM để unit-test URL parsing và dedupe seller
// mà không cần jsdom. Content script thật nạp file này trước fiverr.js. Parse location seller
// đọc thẳng qua DOM thật trong fiverr.js (readSellerLocation()) — không đặt ở đây vì phụ thuộc
// cấu trúc <li><strong> cụ thể, không phải text thuần cần tách khỏi DOM để test.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.HuntExFiverrExtractor = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cleanText(value, maxLength = 2000) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function isFiverrHost(hostname) {
    const host = (hostname || '').toLowerCase().replace(/^www\./, '');
    return host === 'fiverr.com' || host.endsWith('.fiverr.com');
  }

  // URL card có rất nhiều tracking params. Chỉ giữ pathname canonical để tab detail ổn
  // định hơn và tránh mang ref_ctx_id/imp_id khác nhau vào storage/cache.
  function parseGigUrl(href, baseHref) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, baseHref);
    } catch {
      return null;
    }
    if (!isFiverrHost(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2) return null;
    const [username, gigSlug] = parts;
    const reserved = new Set(['search', 'categories', 'users', 'support', 'inbox', 'orders']);
    if (!username || !gigSlug || reserved.has(username.toLowerCase())) return null;
    const origin = `${url.protocol}//${url.host}`;
    return {
      username,
      gigSlug,
      gigUrl: `${origin}/${encodeURIComponent(username)}/${encodeURIComponent(gigSlug)}`,
      profileUrl: `${origin}/${encodeURIComponent(username)}`,
    };
  }

  function collectSellerCandidates(cards, baseHref, limit) {
    const sellers = new Map();
    for (const raw of Array.isArray(cards) ? cards : []) {
      const parsed = parseGigUrl(raw?.gigHref, baseHref);
      if (!parsed) continue;
      const key = parsed.username.toLowerCase();
      if (sellers.has(key)) continue;
      sellers.set(key, {
        username: parsed.username,
        sellerName: cleanText(raw?.sellerName, 200) || parsed.username,
        profileUrl: parsed.profileUrl,
        gigUrl: parsed.gigUrl,
        gigTitle: cleanText(raw?.gigTitle, 300) || null,
      });
      if (limit && sellers.size >= limit) break;
    }
    return [...sellers.values()];
  }

  function isBlockedPageText(value) {
    const text = cleanText(value, 10000).toLowerCase();
    return [
      'verify you are human',
      'verification required',
      'unusual traffic',
      'access denied',
      'temporarily blocked',
      'complete the security check',
      'press and hold',
    ].some((marker) => text.includes(marker));
  }

  return { cleanText, parseGigUrl, collectSellerCandidates, isBlockedPageText };
});
