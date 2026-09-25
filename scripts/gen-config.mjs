// Đọc .env ở root repo, sinh ra src/shared/config.js — vì extension (background/popup/options)
// chạy trong browser, không có fs/process.env nên không thể đọc .env trực tiếp lúc runtime.
// Chạy lại script này mỗi khi đổi .env: `node scripts/gen-config.mjs`
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ENV_PATH = new URL('../.env', import.meta.url);
const OUT_PATH = new URL('../src/shared/config.js', import.meta.url);

if (!existsSync(ENV_PATH)) {
  console.error('Thiếu file .env — copy .env.example thành .env rồi điền OPENAI_API_KEY.');
  process.exit(1);
}

const env = {};
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}

if (!env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY trống trong .env.');
  process.exit(1);
}

// Chỉ 1 model duy nhất cho toàn bộ extension (2026-09-24 — trước đó có thêm GPT_MODEL riêng cho
// intent-analyzer.js, đã bỏ vì thừa: chỉ tổ chức tồn tại 2 biến trỏ tới cùng 1 khái niệm "model
// OpenAI đang dùng"). Biến vẫn giữ tên UPWORK_GPT_MODEL (lịch sử, ban đầu chỉ dùng cho Upwork) dù
// giờ áp dụng cho mọi lời gọi OpenAI trong dự án — xem TODO cuối CLAUDE.md nếu muốn đổi tên rõ nghĩa hơn.
const upworkGptModel = env.UPWORK_GPT_MODEL || 'gpt-5.6-terra';

writeFileSync(
  OUT_PATH,
    `// File này được sinh tự động từ .env bởi scripts/gen-config.mjs — KHÔNG sửa tay, KHÔNG commit.\n` +
    `export const OPENAI_API_KEY = ${JSON.stringify(env.OPENAI_API_KEY)};\n` +
    `export const UPWORK_GPT_MODEL = ${JSON.stringify(upworkGptModel)};\n`
);

console.log('Đã sinh src/shared/config.js từ .env.');
