import { API_KEY_STORAGE_KEY } from '../shared/api-key-store.js';

const $ = (id) => document.getElementById(id);

// apikey-input dùng chung 1 vòng load()/save-btn với các field kia (đơn giản, không cần code
// riêng) — nút "Test key" bên dưới độc lập, chỉ test giá trị đang gõ, không phụ thuộc đã bấm Save
// hay chưa (2026-09-25, xem CLAUDE.md).
const FIELDS = {
  'apikey-input': API_KEY_STORAGE_KEY,
  'storage-mode': 'huntexLeadStorageMode',
  'backend-url': 'huntexBackendUrl',
  'backend-key': 'huntexBackendApiKey',
};

function sendToBackground(message) {
  return chrome.runtime.sendMessage(message).then((res) => {
    if (!res?.ok) throw new Error(res?.error || 'Unknown error');
    return res.result;
  });
}

function setStatus(el, msg, isError) {
  el.textContent = msg;
  el.classList.toggle('status-success', !isError);
}

async function load() {
  const stored = await chrome.storage.sync.get(Object.values(FIELDS));
  for (const [elId, key] of Object.entries(FIELDS)) {
    if (stored[key] !== undefined) $(elId).value = stored[key];
  }
}

$('save-btn').addEventListener('click', async () => {
  const toSave = {};
  for (const [elId, key] of Object.entries(FIELDS)) {
    toSave[key] = $(elId).value;
  }
  await chrome.storage.sync.set(toSave);
  setStatus($('status'), 'Saved.', false);
  setTimeout(() => setStatus($('status'), '', false), 2000);
});

$('apikey-test-btn').addEventListener('click', async () => {
  const apiKey = $('apikey-input').value.trim();
  const statusEl = $('apikey-test-status');
  if (!apiKey) return setStatus(statusEl, 'Enter an API key first.', true);
  $('apikey-test-btn').disabled = true;
  setStatus(statusEl, 'Testing...', false);
  try {
    const result = await sendToBackground({ type: 'TEST_API_KEY', apiKey });
    setStatus(statusEl, result.ok ? 'Key works.' : `Key test failed: ${result.error}`, !result.ok);
  } catch (err) {
    setStatus(statusEl, err.message || String(err), true);
  } finally {
    $('apikey-test-btn').disabled = false;
  }
});

load();
