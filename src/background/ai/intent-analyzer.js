// Gọi thẳng OpenAI Responses API từ background service worker (fetch trình duyệt).
// Extension đã khai báo host_permissions cho api.openai.com trong manifest.json nên
// request cross-origin này không bị CORS chặn (khác với 1 trang web thường).
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

function buildInstructions(platformLabel) {
  return `You are an assistant that analyzes target-customer requests for a marketing team hunting leads on ${platformLabel}.
The input is a free-text description (may be in Vietnamese or English) of the desired customer profile.
Infer:
- searchQuery: ONE short phrase (2-6 words) to type directly into ${platformLabel}'s search box, the way a
  real person would search (no quote marks, no comma-joined clauses).
- keywords: related keywords/phrases used to FILTER results after crawling (not typed into the search box).
- excludeKeywords: keywords that, if present in a listing, should cause it to be excluded (avoid noise/spam/irrelevant results).
- notes: a brief note explaining the search direction.

IMPORTANT: respond 100% in English for every field (searchQuery, keywords, excludeKeywords, notes),
regardless of what language the input description is written in — ${platformLabel} listings are in English.`;
}

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    searchQuery: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    excludeKeywords: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['searchQuery', 'keywords', 'excludeKeywords', 'notes'],
  additionalProperties: false,
};

/**
 * @param {string} apiKey OpenAI API key (đã cấu hình sẵn qua .env -> scripts/gen-config.mjs)
 * @param {string} model Model OpenAI dùng để phân tích (cũng từ .env, xem UPWORK_GPT_MODEL — 2026-09-24
 *   gộp chung 1 model duy nhất cho toàn extension, không còn GPT_MODEL riêng)
 * @param {string} description Mô tả khách hàng mục tiêu do team marketing nhập
 * @param {string} platformLabel Tên nền tảng đang tìm lead (VD: "LinkedIn", "Upwork") — đưa vào prompt
 * @returns {Promise<{searchQuery: string, keywords: string[], excludeKeywords: string[], notes: string}>}
 */
export async function analyzeIntent(apiKey, model, description, platformLabel) {
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured — set OPENAI_API_KEY in .env then run node scripts/gen-config.mjs.');
  }
  if (!description || !description.trim()) {
    throw new Error('Please describe the target customer before analyzing.');
  }

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: buildInstructions(platformLabel || 'a hiring/freelance platform'),
      input: description,
      text: {
        format: {
          type: 'json_schema',
          name: 'intent_analysis',
          schema: INTENT_SCHEMA,
          strict: true,
        },
      },
      // Model giờ dùng chung UPWORK_GPT_MODEL (gpt-5.6-terra, reasoning model — 2026-09-24 gộp
      // chung, xem CLAUDE.md) — mặc định effort là 'medium' nếu bỏ trống. Task này chỉ diễn giải câu
      // tự nhiên thành JSON ngắn, không có tool call/judgement phức tạp nào, đúng mô tả use-case
      // 'none' trong docs OpenAI ("latency-critical tasks that do not benefit from any reasoning").
      // Set rõ để tránh tốn thêm reasoning token/latency vô ích so với lúc còn dùng gpt-4.1 riêng.
      reasoning: { effort: 'none' },
      // Nhất quán với 3 file *-analyzer.js kia (profile/agency/fiverr) — không lưu mô tả khách hàng
      // team marketing nhập vào phía server OpenAI. Mặc định Responses API là store:true nếu bỏ trống.
      store: false,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = extractOutputText(data);
  if (!text) {
    throw new Error('Did not receive text content from OpenAI API.');
  }

  return parseJsonResponse(text);
}

// "output_text" là tiện ích chỉ SDK chính thức của OpenAI mới tự gộp — raw fetch (như ở đây)
// nhận response gốc không có field đó. Text thật nằm trong output[].content[] (đã verify bằng
// request thật, 2026-09-22): tìm item type "message", rồi content type "output_text".
function extractOutputText(data) {
  for (const item of data.output || []) {
    if (item.type !== 'message') continue;
    for (const block of item.content || []) {
      if (block.type === 'output_text') return block.text;
    }
  }
  return null;
}

function parseJsonResponse(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Could not parse JSON from AI response. Raw content: ' + text.slice(0, 300));
  }
  return {
    searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    excludeKeywords: Array.isArray(parsed.excludeKeywords) ? parsed.excludeKeywords : [],
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}
