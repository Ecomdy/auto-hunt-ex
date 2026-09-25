import { analyzeIntent } from './ai/intent-analyzer.js';
import { analyzeProfile } from './ai/profile-analyzer.js';
import { analyzeAgency } from './ai/agency-analyzer.js';
import { analyzeFiverrSeller } from './ai/fiverr-analyzer.js';
import {
  clearProfileResearchCache,
  getCachedProfileResearch,
  setCachedProfileResearch,
} from './ai/profile-research-cache.js';
import { getLeadRepository } from './leads/lead-repository.js';
import { OPENAI_API_KEY, UPWORK_GPT_MODEL } from '../shared/config.js';

async function analyzeProfileCached(payload) {
  const cached = await getCachedProfileResearch(UPWORK_GPT_MODEL, payload);
  if (cached) return cached;

  const result = await analyzeProfile(OPENAI_API_KEY, UPWORK_GPT_MODEL, payload);
  await setCachedProfileResearch(UPWORK_GPT_MODEL, payload, result);
  return result;
}

// Mở side panel khi click icon extension (thay vì popup — popup tự đóng khi chuyển tab,
// side panel thì không, phù hợp hơn với luồng "phân tích -> chuyển sang tab khác -> crawl").
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Message contract giữa panel (src/popup) <-> background:
//   { type: 'ANALYZE_INTENT', description, platformLabel } -> { searchQuery, keywords, excludeKeywords, notes }
//   { type: 'SAVE_LEADS', leads }                   -> lead list đã lưu
//   { type: 'GET_LEADS' }                           -> lead list hiện có
//   { type: 'CLEAR_LEADS' }                         -> void
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
    return analyzeIntent(OPENAI_API_KEY, UPWORK_GPT_MODEL, description, platformLabel);
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
    return analyzeAgency(OPENAI_API_KEY, UPWORK_GPT_MODEL, {
      upworkAgencyUrl,
      agencyData,
      crawledAt,
    });
  },

  async ANALYZE_FIVERR({ fiverrGigUrl, sellerData, crawledAt }) {
    return analyzeFiverrSeller(OPENAI_API_KEY, UPWORK_GPT_MODEL, { fiverrGigUrl, sellerData, crawledAt });
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
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

  return true; // giữ channel mở cho phản hồi async
});
