import { analyzeIntent } from './ai/intent-analyzer.js';
import { analyzeProfile } from './ai/profile-analyzer.js';
import { analyzeAgency } from './ai/agency-analyzer.js';
import { analyzeFiverrSeller } from './ai/fiverr-analyzer.js';
import { testApiKey } from './ai/key-tester.js';
import {
  clearProfileResearchCache,
  getCachedProfileResearch,
  setCachedProfileResearch,
} from './ai/profile-research-cache.js';
import { getLeadRepository } from './leads/lead-repository.js';
import { getApiKey, setApiKey } from '../shared/api-key-store.js';

// Model OpenAI cho toàn bộ extension — hardcode (2026-09-25, không còn qua .env/config.js, xem
// CLAUDE.md). Trước đây tên UPWORK_GPT_MODEL (biến .env, lịch sử từ lúc chỉ Upwork dùng); đổi
// tên GPT_MODEL cho đúng nghĩa nhân tiện lúc bỏ hẳn .env — không còn ràng buộc phải giữ tên cũ để
// tránh sửa scripts/gen-config.mjs/.env.example (2 file đó đã xoá).
const GPT_MODEL = 'gpt-5.6-terra';

// Key do user tự nhập qua UI (side panel lúc chưa cấu hình, hoặc Settings để đổi sau) — xem
// src/shared/api-key-store.js. Throw lỗi rõ ràng thay vì để fetch() trong ai/*.js tự trả lỗi mơ hồ
// (401 gốc từ OpenAI) nếu handler nào gọi OpenAI mà chưa có key.
async function requireApiKey() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured — open the Hunt-Ex panel and enter your API key first.');
  }
  return apiKey;
}

async function analyzeProfileCached(payload) {
  const cached = await getCachedProfileResearch(GPT_MODEL, payload);
  if (cached) return cached;

  const apiKey = await requireApiKey();
  const result = await analyzeProfile(apiKey, GPT_MODEL, payload);
  await setCachedProfileResearch(GPT_MODEL, payload, result);
  return result;
}

// Mở side panel khi click icon extension (thay vì popup — popup tự đóng khi chuyển tab,
// side panel thì không, phù hợp hơn với luồng "phân tích -> chuyển sang tab khác -> crawl").
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Message contract giữa panel (src/popup)/options <-> background:
//   { type: 'ANALYZE_INTENT', description, platformLabel } -> { searchQuery, keywords, excludeKeywords, notes }
//   { type: 'SAVE_LEADS', leads }                   -> lead list đã lưu
//   { type: 'GET_LEADS' }                           -> lead list hiện có
//   { type: 'CLEAR_LEADS' }                         -> void
//   { type: 'GET_API_KEY_STATUS' }                  -> { hasKey } — panel dùng để quyết định hiện
//                                                       apikey-view (chưa cấu hình) hay home-view
//   { type: 'SAVE_API_KEY', apiKey }                -> { saved: true } — lưu chrome.storage.sync
//   { type: 'TEST_API_KEY', apiKey? }               -> { ok, error? } — apiKey bỏ trống thì test
//                                                       đúng key đang lưu (nút "Test key" ở Settings,
//                                                       xem src/background/ai/key-tester.js)
// Crawl (START_CRAWL) đi thẳng panel -> content script, không qua background,
// vì background không cần biết chi tiết DOM của từng platform.
// Riêng ANALYZE_PROFILE (identity/contact research cho freelancer) và ANALYZE_AGENCY (cùng việc,
// cho agency — 2026-09-24) content script (upwork.js) gọi THẲNG background (không qua panel) cho
// từng freelancer/agency trong lúc crawl — xem upwork.js. ANALYZE_FIVERR (2026-09-25, cùng việc
// cho Fiverr seller) lại đi qua panel (popup.js crawlFiverrSellers()), không phải content script —
// vì vòng lặp Fiverr nằm ở panel (điều hướng 1 tab crawler qua nhiều gig), khác Upwork freelancer
// (vòng lặp nằm trong chính content script).

const handlers = {
  async ANALYZE_INTENT({ description, platformLabel }) {
    const apiKey = await requireApiKey();
    return analyzeIntent(apiKey, GPT_MODEL, description, platformLabel);
  },

  async ANALYZE_PROFILE({ upworkProfileUrl, profileData, profileText, crawledAt }) {
    return analyzeProfileCached({
      upworkProfileUrl,
      profileData,
      profileText,
      crawledAt,
    });
  },

  async ANALYZE_AGENCY({ upworkAgencyUrl, agencyData, crawledAt }) {
    const apiKey = await requireApiKey();
    return analyzeAgency(apiKey, GPT_MODEL, {
      upworkAgencyUrl,
      agencyData,
      crawledAt,
    });
  },

  async ANALYZE_FIVERR({ fiverrGigUrl, sellerData, crawledAt }) {
    const apiKey = await requireApiKey();
    return analyzeFiverrSeller(apiKey, GPT_MODEL, { fiverrGigUrl, sellerData, crawledAt });
  },

  async SAVE_LEADS({ leads }) {
    const repo = await getLeadRepository();
    return repo.addLeads(leads);
  },

  async GET_LEADS() {
    const repo = await getLeadRepository();
    return repo.getAll();
  },

  async CLEAR_LEADS() {
    const repo = await getLeadRepository();
    await repo.clear();
    await clearProfileResearchCache();
    return null;
  },

  async GET_API_KEY_STATUS() {
    const apiKey = await getApiKey();
    return { hasKey: Boolean(apiKey) };
  },

  async SAVE_API_KEY({ apiKey }) {
    const trimmed = (apiKey || '').trim();
    if (!trimmed) throw new Error('API key cannot be empty.');
    await setApiKey(trimmed);
    return { saved: true };
  },

  // apiKey optional: panel truyền key vừa gõ (chưa chắc đã lưu) lúc onboarding; Settings gọi không
  // kèm apiKey để test đúng key đang lưu (nút "Test key" độc lập với nút "Save").
  async TEST_API_KEY({ apiKey } = {}) {
    const keyToTest = apiKey ? apiKey.trim() : await getApiKey();
    if (!keyToTest) throw new Error('No API key to test — enter one first.');
    return testApiKey(keyToTest);
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

  return true; // giữ channel mở cho phản hồi async
});
