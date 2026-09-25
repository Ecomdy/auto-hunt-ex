import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadKeyTester() {
  const source = await readFile(new URL('../src/background/ai/key-tester.js', import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('reports ok:true and sends the key as a Bearer token when OpenAI responds 200', async () => {
  const { testApiKey } = await loadKeyTester();
  const originalFetch = globalThis.fetch;
  let seenUrl;
  let seenAuth;
  globalThis.fetch = async (url, options) => {
    seenUrl = url;
    seenAuth = options.headers.Authorization;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  try {
    const result = await testApiKey('sk-test-123');
    assert.deepEqual(result, { ok: true });
    assert.equal(seenUrl, 'https://api.openai.com/v1/models');
    assert.equal(seenAuth, 'Bearer sk-test-123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports a clear "invalid key" error on 401', async () => {
  const { testApiKey } = await loadKeyTester();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'Incorrect API key provided' } }),
  });
  try {
    const result = await testApiKey('sk-bad');
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid api key/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('surfaces the OpenAI error message body on other non-2xx statuses', async () => {
  const { testApiKey } = await loadKeyTester();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: 'Rate limit exceeded' } }),
  });
  try {
    const result = await testApiKey('sk-test');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Rate limit exceeded');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('surfaces network errors instead of throwing', async () => {
  const { testApiKey } = await loadKeyTester();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    const result = await testApiKey('sk-test');
    assert.equal(result.ok, false);
    assert.match(result.error, /network down/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
