import { analyzeIntent } from './ai/intent-analyzer.js';
import { analyzeProfile, analyzeProfileWithExa } from './ai/profile-analyzer.js';
import { analyzeAgency, analyzeAgencyWithExa } from './ai/agency-analyzer.js';
import { analyzeFiverrSeller, analyzeFiverrSellerWithExa } from './ai/fiverr-analyzer.js';
import { testApiKey, testExaApiKey } from './ai/key-tester.js';
import {
  clearProfileResearchCache,
  getCachedProfileResearch,
  setCachedProfileResearch,
} from './ai/profile-research-cache.js';
import { getLeadRepository } from './leads/lead-repository.js';
import {
  getOpenAiApiKey,
  setOpenAiApiKey,
  getExaApiKey,
  setExaApiKey,
  getResearchProvider,
  setResearchProvider,
  RESEARCH_PROVIDERS,
} from '../shared/api-key-store.js';

// Model OpenAI cho toàn bộ extension — hardcode (2026-09-25, không còn qua .env/config.js, xem
// CLAUDE.md). Trước đây tên UPWORK_GPT_MODEL (biến .env, lịch sử từ lúc chỉ Upwork dùng); đổi
// tên GPT_MODEL cho đúng nghĩa nhân tiện lúc bỏ hẳn .env — không còn ràng buộc phải giữ tên cũ để
// tránh sửa scripts/gen-config.mjs/.env.example (2 file đó đã xoá). KHÔNG phụ thuộc research
// provider (2026-09-28) — Exa.ai không có khái niệm "model" để chọn, agent tự quyết định.
const GPT_MODEL = 'gpt-5.6-terra';

// "Model identifier" dùng làm 1 phần cache key trong profile-research-cache.js — Exa không có model
// thật nên dùng 1 hằng số cố định, chỉ để tách cache OpenAI/Exa không đè lên nhau (đổi provider rồi
// đổi lại không vô tình trả nhầm kết quả provider kia đã cache).
const EXA_MODEL_ID = 'exa-agent';

// requireOpenAiApiKey(): CHỈ dùng cho ANALYZE_INTENT — bước phân tích mô tả khách hàng (tiếng Việt/
// Anh) thành search query/keywords cho LinkedIn, KHÔNG gọi web search nên không nằm trong lựa chọn
// research provider (OpenAI/Exa) bên dưới — luôn dùng OpenAI, xem "OpenAI API key" trong CLAUDE.md.
async function requireOpenAiApiKey() {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured — open the Hunt-Ex panel and enter your API key first.');
  }
  return apiKey;
}

// requireResearchApiKey(): dùng cho 3 bước "tìm kiếm kết quả" thật sự (research contact công khai —
// ANALYZE_PROFILE/ANALYZE_AGENCY/ANALYZE_FIVERR), nơi user chọn được provider OpenAI hoặc Exa.ai
// (2026-09-28, xem src/shared/api-key-store.js). Trả cả provider lẫn key để handler tự dispatch
// đúng hàm analyze*()/analyze*WithExa().
async function requireResearchApiKey() {
  const provider = await getResearchProvider();
  const apiKey = provider === 'exa' ? await getExaApiKey() : await getOpenAiApiKey();
  if (!apiKey) {
    const label = provider === 'exa' ? 'Exa' : 'OpenAI';
    throw new Error(`${label} API key is not configured — open the Hunt-Ex panel and enter your ${label} API key first.`);
  }
  return { provider, apiKey };
}

async function analyzeProfileCached(payload) {
  const provider = await getResearchProvider();
  const modelId = provider === 'exa' ? EXA_MODEL_ID : GPT_MODEL;
  const cached = await getCachedProfileResearch(modelId, payload);
  if (cached) return cached;

  const { apiKey } = await requireResearchApiKey();
  const result =
    provider === 'exa' ? await analyzeProfileWithExa(apiKey, payload) : await analyzeProfile(apiKey, GPT_MODEL, payload);
  await setCachedProfileResearch(modelId, payload, result);
  return result;
}

// Mở side panel khi click icon extension (thay vì popup — popup tự đóng khi chuyển tab,
// side panel thì không, phù hợp hơn với luồng "phân tích -> chuyển sang tab khác -> crawl").
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Message contract giữa panel (src/popup)/options <-> background:
//   { type: 'ANALYZE_INTENT', description, platformLabel } -> { searchQuery, keywords, excludeKeywords, notes }
//                                                       — LUÔN dùng OpenAI (requireOpenAiApiKey()),
//                                                       không đổi theo research provider (không gọi
//                                                       web search, xem comment đầu file).
//   { type: 'SAVE_LEADS', leads }                   -> lead list đã lưu
//   { type: 'GET_LEADS' }                           -> lead list hiện có
//   { type: 'CLEAR_LEADS' }                         -> void
//   { type: 'GET_API_KEY_STATUS' }                  -> { provider, hasKey } — provider = research
//                                                       provider đang chọn ('openai' mặc định),
//                                                       hasKey = key của ĐÚNG provider đó đã có chưa.
//                                                       Panel dùng để quyết định hiện apikey-view
//                                                       (chưa cấu hình) hay home-view.
//   { type: 'SAVE_API_KEY', provider, apiKey }      -> { saved: true } — lưu key cho `provider` qua
//                                                       chrome.storage.sync VÀ đặt luôn provider đó
//                                                       làm research provider đang dùng (chọn xong
//                                                       là dùng luôn, xem CLAUDE.md).
//   { type: 'TEST_API_KEY', provider?, apiKey? }    -> { ok, error? } — provider bỏ trống thì dùng
//                                                       provider đang lưu; apiKey bỏ trống thì test
//                                                       đúng key đang lưu của provider đó (nút "Test
//                                                       key" ở Settings, xem src/background/ai/
//                                                       key-tester.js).
// Crawl (START_CRAWL) đi thẳng panel -> content script, không qua background,
// vì background không cần biết chi tiết DOM của từng platform.
// Riêng ANALYZE_PROFILE (identity/contact research cho freelancer) và ANALYZE_AGENCY (cùng việc,
// cho agency — 2026-09-24) content script (upwork.js) gọi THẲNG background (không qua panel) cho
// từng freelancer/agency trong lúc crawl — xem upwork.js. ANALYZE_FIVERR (2026-09-25, cùng việc
// cho Fiverr seller) lại đi qua panel (popup.js crawlFiverrSellers()), không phải content script —
// vì vòng lặp Fiverr nằm ở panel (điều hướng 1 tab crawler qua nhiều gig), khác Upwork freelancer
// (vòng lặp nằm trong chính content script). Cả 3 message này (2026-09-28) tự dispatch OpenAI/Exa
// theo research provider đang chọn — xem requireResearchApiKey()/analyzeProfileCached() phía trên.

const handlers = {
  async ANALYZE_INTENT({ description, platformLabel }) {
    const apiKey = await requireOpenAiApiKey();
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
    const { provider, apiKey } = await requireResearchApiKey();
    const agency = { upworkAgencyUrl, agencyData, crawledAt };
    return provider === 'exa' ? analyzeAgencyWithExa(apiKey, agency) : analyzeAgency(apiKey, GPT_MODEL, agency);
  },

  async ANALYZE_FIVERR({ fiverrGigUrl, sellerData, crawledAt }) {
    const { provider, apiKey } = await requireResearchApiKey();
    const seller = { fiverrGigUrl, sellerData, crawledAt };
    return provider === 'exa'
      ? analyzeFiverrSellerWithExa(apiKey, seller)
      : analyzeFiverrSeller(apiKey, GPT_MODEL, seller);
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
    const provider = await getResearchProvider();
    const apiKey = provider === 'exa' ? await getExaApiKey() : await getOpenAiApiKey();
    return { provider, hasKey: Boolean(apiKey) };
  },

  async SAVE_API_KEY({ provider, apiKey }) {
    if (!RESEARCH_PROVIDERS.includes(provider)) throw new Error(`Unknown research provider: ${provider}`);
    const trimmed = (apiKey || '').trim();
    if (!trimmed) throw new Error('API key cannot be empty.');
    if (provider === 'exa') await setExaApiKey(trimmed);
    else await setOpenAiApiKey(trimmed);
    await setResearchProvider(provider);
    return { saved: true };
  },

  // provider bỏ trống thì dùng provider đang lưu (Settings gọi kèm provider = giá trị dropdown đang
  // chọn trong UI, có thể khác provider đã lưu nếu user đang thử đổi). apiKey bỏ trống thì test đúng
  // key đang lưu của provider đó (nút "Test key" ở Settings, độc lập với nút "Save").
  async TEST_API_KEY({ provider, apiKey } = {}) {
    const resolvedProvider = RESEARCH_PROVIDERS.includes(provider) ? provider : await getResearchProvider();
    const keyToTest = apiKey ? apiKey.trim() : await (resolvedProvider === 'exa' ? getExaApiKey() : getOpenAiApiKey());
    if (!keyToTest) throw new Error('No API key to test — enter one first.');
    return resolvedProvider === 'exa' ? testExaApiKey(keyToTest) : testApiKey(keyToTest);
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
