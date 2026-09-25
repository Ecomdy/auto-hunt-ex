const CACHE_PREFIX = 'huntex_profile_research_';
const CACHE_VERSION = 4;

async function cacheKey(model, payload) {
  const fingerprint = JSON.stringify({
    model,
    upworkProfileUrl: payload.upworkProfileUrl || null,
    profileData: payload.profileData || null,
    profileText: payload.profileText || null,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${CACHE_PREFIX}v${CACHE_VERSION}_${hex}`;
}

export async function getCachedProfileResearch(model, payload) {
  const key = await cacheKey(model, payload);
  const cached = (await chrome.storage.session.get(key))[key];
  return cached ? structuredClone(cached) : null;
}

export async function setCachedProfileResearch(model, payload, result) {
  // Negative identity results phụ thuộc search index tại thời điểm gọi và có thể là false negative.
  // Không cache chúng để lần crawl sau vẫn có cơ hội chạy identity fallback mới.
  if (!result?.linkedin?.url && !result?.website?.url) return false;
  const key = await cacheKey(model, payload);
  await chrome.storage.session.set({ [key]: result });
  return true;
}

export async function clearProfileResearchCache() {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(CACHE_PREFIX));
  if (keys.length) await chrome.storage.session.remove(keys);
}
