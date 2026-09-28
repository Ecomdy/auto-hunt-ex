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

// Kiểm tra 1 Exa API key còn dùng được không (2026-09-28, Exa là provider thứ 2 cho phần research —
// xem src/shared/api-key-store.js). Exa KHÔNG có endpoint account-info/models sạch tương đương
// OpenAI's /v1/models (xác nhận qua research 2026-09-28: /v0/teams/me trong doc bị lệch path thật,
// Team Management API cần loại key riêng khác hẳn). Dùng GET /agent/runs?limit=1 (list run) thay
// thế — cùng auth với /agent/runs thật, KHÔNG tạo run mới nên không tốn phí (chỉ create run mới bị
// tính phí theo doc pricing/billing), 200 nghĩa là key hợp lệ dù danh sách rỗng.
export async function testExaApiKey(apiKey) {
  let response;
  try {
    response = await fetch('https://api.exa.ai/agent/runs?limit=1', {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });
  } catch (err) {
    return { ok: false, error: `Network error — ${err.message || err}` };
  }

  if (response.ok) return { ok: true };

  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error || '';
  } catch {
    // Body không phải JSON hợp lệ — bỏ qua, dùng fallback theo status bên dưới.
  }

  if (response.status === 401) {
    return { ok: false, error: detail || 'Invalid API key (Exa returned 401 Unauthorized).' };
  }
  if (response.status === 402) {
    return { ok: false, error: detail || 'Exa key is valid but out of credits or over its spending budget (HTTP 402).' };
  }
  if (response.status === 429) {
    return { ok: false, error: detail || 'Exa rate limit hit while testing the key (HTTP 429) — the key itself may still be valid.' };
  }
  return { ok: false, error: detail || `Exa returned HTTP ${response.status}.` };
}
