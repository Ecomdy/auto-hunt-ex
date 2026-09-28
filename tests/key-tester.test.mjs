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

test('testExaApiKey reports ok:true and sends the key via x-api-key when Exa responds 200', async () => {
  const { testExaApiKey } = await loadKeyTester();
  const originalFetch = globalThis.fetch;
  let seenUrl;
  let seenMethod;
  let seenKey;
  globalThis.fetch = async (url, options) => {
    seenUrl = url;
    seenMethod = options.method;
    seenKey = options.headers['x-api-key'];
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  try {
    const result = await testExaApiKey('exa-test-123');
    assert.deepEqual(result, { ok: true });
    assert.equal(seenUrl, 'https://api.exa.ai/agent/runs?limit=1');
    assert.equal(seenMethod, 'GET');
    assert.equal(seenKey, 'exa-test-123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('testExaApiKey reports a clear "invalid key" error on 401', async () => {
  const { testExaApiKey } = await loadKeyTester();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ requestId: 'r1', error: 'Invalid API key.', tag: 'INVALID_API_KEY' }),
  });
  try {
    const result = await testExaApiKey('exa-bad');
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid api key/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('testExaApiKey distinguishes a valid-but-out-of-credits key on 402', async () => {
  const { testExaApiKey } = await loadKeyTester();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 402,
    json: async () => ({ error: 'No more credits.', tag: 'NO_MORE_CREDITS' }),
  });
  try {
    const result = await testExaApiKey('exa-test');
    assert.equal(result.ok, false);
    assert.match(result.error, /no more credits/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('testExaApiKey surfaces network errors instead of throwing', async () => {
  const { testExaApiKey } = await loadKeyTester();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    const result = await testExaApiKey('exa-test');
    assert.equal(result.ok, false);
    assert.match(result.error, /network down/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
