// Lưu lead trong chrome.storage.session — CHỈ tồn tại trong bộ nhớ cho tới khi trình duyệt đóng
// hoặc extension bị tắt/reload (KHÔNG ghi xuống đĩa, không cần bước "Clear all" thủ công mỗi lần
// test) — user yêu cầu 2026-09-23, trước đó dùng chrome.storage.local (persist qua reload trình
// duyệt) không hợp cho mục đích test luồng end-to-end lặp lại. Vẫn sống sót qua việc service worker
// bị Chrome unload do idle (đặc điểm MV3) vì đây là API riêng cho việc đó, khác biến JS thường.
const STORAGE_KEY = 'huntex_leads';

export const localLeadRepository = {
  async addLeads(leads) {
    const existing = await this.getAll();
    const merged = [...existing, ...leads];
    await chrome.storage.session.set({ [STORAGE_KEY]: merged });
    return merged;
  },

  async getAll() {
    const data = await chrome.storage.session.get(STORAGE_KEY);
    return data[STORAGE_KEY] || [];
  },

  async clear() {
    await chrome.storage.session.remove(STORAGE_KEY);
  },
};
