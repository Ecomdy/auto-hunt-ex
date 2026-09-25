// TODO: chưa có backend/CRM nội bộ Ecomdy — chờ endpoint URL + auth thật.
// Khi có, nhập "Backend URL" + "Backend API key" ở trang Options, extension sẽ tự
// chuyển sang dùng repository này (xem lead-repository.js). KHÔNG đoán schema/endpoint
// ở đây — payload gửi đi tạm để nguyên leads thô, chỉnh lại theo schema thật khi có.
export const remoteLeadRepository = {
  async addLeads(leads) {
    const { huntexBackendUrl, huntexBackendApiKey } = await chrome.storage.sync.get([
      'huntexBackendUrl',
      'huntexBackendApiKey',
    ]);
    if (!huntexBackendUrl) {
      throw new Error(
        'Backend URL is not configured. Enter it in Settings, or switch "Lead storage" to Local to test first.'
      );
    }
    const res = await fetch(huntexBackendUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(huntexBackendApiKey ? { authorization: `Bearer ${huntexBackendApiKey}` } : {}),
      },
      body: JSON.stringify({ leads }),
    });
    if (!res.ok) {
      throw new Error(`Failed to send leads to backend (HTTP ${res.status}).`);
    }
    return leads;
  },

  async getAll() {
    throw new Error('remote-lead-repository.getAll() is not implemented — backend has no read endpoint yet.');
  },

  async clear() {
    throw new Error('remote-lead-repository.clear() is not implemented — backend has no delete endpoint yet.');
  },
};
