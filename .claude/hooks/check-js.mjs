// PostToolUse hook: sau khi Claude Edit/Write một file .js, chạy `node --check`
// để bắt lỗi cú pháp ngay, tránh phải load lại extension mới phát hiện ra.
import { execFileSync } from 'node:child_process';

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const filePath = payload?.tool_input?.file_path;
  if (!filePath || !filePath.endsWith('.js')) process.exit(0);

  try {
    execFileSync('node', ['--check', filePath], { stdio: 'inherit' });
    process.exit(0);
  } catch {
    console.error(`Syntax error in ${filePath} — fix before continuing.`);
    process.exit(1);
  }
});
