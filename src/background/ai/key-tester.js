// Kiểm tra 1 OpenAI API key còn dùng được không — dùng cho nút "Test key" (side panel lúc nhập
// key lần đầu + Settings lúc đổi key, 2026-09-25). Gọi GET /v1/models thay vì gọi /v1/responses thật
// (như intent/profile/agency/fiverr-analyzer.js) vì đây chỉ là bước xác thực key, không cần tốn
// token/tiền — /v1/models là endpoint đọc danh sách model, miễn phí, chỉ cần key hợp lệ là trả 200.
// Tự chứa (không import gì) — cùng lý do tách data: URL base64 lúc test như các file khác trong
// src/background/ai/ (xem đầu agency-analyzer.js), dù file này không có nguy cơ vỡ relative import.
export async function testApiKey(apiKey) {
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    return { ok: false, error: `Network error — ${err.message || err}` };
  }

  if (response.ok) return { ok: true };

  if (response.status === 401) {
    return { ok: false, error: 'Invalid API key (OpenAI returned 401 Unauthorized).' };
  }

  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || '';
  } catch {
    // Body không phải JSON hợp lệ — bỏ qua, dùng fallback bên dưới.
  }
  return { ok: false, error: detail || `OpenAI returned HTTP ${response.status}.` };
}
