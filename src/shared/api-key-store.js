// Lưu API key do user tự nhập qua UI (side panel lúc mới mở lần đầu, hoặc Settings để đổi sau) —
// KHÔNG còn qua .env/scripts/gen-config.mjs/src/shared/config.js nữa (2026-09-25, marketing team
// không tự thêm file .env được nên đổi sang nhập trên giao diện). Dùng chrome.storage.sync (giống
// huntexBackendApiKey ở remote-lead-repository.js) để đồng bộ qua các máy cùng đăng nhập Chrome,
// không phải chrome.storage.session (session chỉ dành cho DATA cần tự mất khi đóng trình duyệt như
// leads/cache, xem CLAUDE.md — API key là config cần giữ lâu dài).
//
// 2026-09-28: thêm provider Exa.ai làm lựa chọn khác cho phần "research" (tìm contact công khai
// cho freelancer/agency/Fiverr seller — ANALYZE_PROFILE/ANALYZE_AGENCY/ANALYZE_FIVERR trong
// background.js), CẠNH provider OpenAI cũ, KHÔNG thay thế. Mỗi provider có key riêng (user có thể
// nhập cả 2 rồi đổi qua lại mà không mất key kia). ANALYZE_INTENT (phân tích mô tả khách hàng ->
// search query, dùng cho LinkedIn) KHÔNG nằm trong lựa chọn provider này — đây không phải bước
// "search for results" (không gọi web search), luôn dùng OpenAI (xem background.js).
export const OPENAI_API_KEY_STORAGE_KEY = 'huntexOpenAiApiKey';
export const EXA_API_KEY_STORAGE_KEY = 'huntexExaApiKey';
export const RESEARCH_PROVIDER_STORAGE_KEY = 'huntexResearchProvider';
export const RESEARCH_PROVIDERS = ['openai', 'exa'];
export const DEFAULT_RESEARCH_PROVIDER = 'openai';

export async function getOpenAiApiKey() {
  const stored = await chrome.storage.sync.get(OPENAI_API_KEY_STORAGE_KEY);
  return stored[OPENAI_API_KEY_STORAGE_KEY] || '';
}

export async function setOpenAiApiKey(apiKey) {
  await chrome.storage.sync.set({ [OPENAI_API_KEY_STORAGE_KEY]: apiKey });
}

export async function getExaApiKey() {
  const stored = await chrome.storage.sync.get(EXA_API_KEY_STORAGE_KEY);
  return stored[EXA_API_KEY_STORAGE_KEY] || '';
}

export async function setExaApiKey(apiKey) {
  await chrome.storage.sync.set({ [EXA_API_KEY_STORAGE_KEY]: apiKey });
}

// Provider dùng cho research (contact-finding) — mặc định 'openai' nếu user chưa từng chọn (giữ
// đúng hành vi cũ cho user đã có sẵn huntexOpenAiApiKey từ trước bản Exa này).
export async function getResearchProvider() {
  const stored = await chrome.storage.sync.get(RESEARCH_PROVIDER_STORAGE_KEY);
  const value = stored[RESEARCH_PROVIDER_STORAGE_KEY];
  return RESEARCH_PROVIDERS.includes(value) ? value : DEFAULT_RESEARCH_PROVIDER;
}

export async function setResearchProvider(provider) {
  if (!RESEARCH_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown research provider: ${provider}`);
  }
  await chrome.storage.sync.set({ [RESEARCH_PROVIDER_STORAGE_KEY]: provider });
}
