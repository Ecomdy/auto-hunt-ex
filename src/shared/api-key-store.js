// Lưu OpenAI API key do user tự nhập qua UI (side panel lúc mới mở lần đầu, hoặc Settings để đổi
// sau) — KHÔNG còn qua .env/scripts/gen-config.mjs/src/shared/config.js nữa (2026-09-25, marketing
// team không tự thêm file .env được nên đổi sang nhập trên giao diện). Dùng chrome.storage.sync
// (giống huntexBackendApiKey ở remote-lead-repository.js) để đồng bộ qua các máy cùng đăng nhập
// Chrome, không phải chrome.storage.session (session chỉ dành cho DATA cần tự mất khi đóng trình
// duyệt như leads/cache, xem CLAUDE.md — API key là config cần giữ lâu dài).
export const API_KEY_STORAGE_KEY = 'huntexOpenAiApiKey';

export async function getApiKey() {
  const stored = await chrome.storage.sync.get(API_KEY_STORAGE_KEY);
  return stored[API_KEY_STORAGE_KEY] || '';
}

export async function setApiKey(apiKey) {
  await chrome.storage.sync.set({ [API_KEY_STORAGE_KEY]: apiKey });
}
