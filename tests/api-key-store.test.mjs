import test from 'node:test';
import assert from 'node:assert/strict';

import { getApiKey, setApiKey, API_KEY_STORAGE_KEY } from '../src/shared/api-key-store.js';

function mockSyncStorage() {
  const values = {};
  return {
    values,
    async get(key) {
      if (key === null || key === undefined) return { ...values };
      const keys = Array.isArray(key) ? key : [key];
      const result = {};
      for (const k of keys) if (k in values) result[k] = values[k];
      return result;
    },
    async set(items) {
      Object.assign(values, structuredClone(items));
    },
  };
}

test('getApiKey returns an empty string when nothing has been saved yet', async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { sync: mockSyncStorage() } };
  try {
    assert.equal(await getApiKey(), '');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('setApiKey then getApiKey round-trips the value under the expected storage key', async () => {
  const originalChrome = globalThis.chrome;
  const sync = mockSyncStorage();
  globalThis.chrome = { storage: { sync } };
  try {
    await setApiKey('sk-abc123');
    assert.equal(await getApiKey(), 'sk-abc123');
    assert.equal(sync.values[API_KEY_STORAGE_KEY], 'sk-abc123');
  } finally {
    globalThis.chrome = originalChrome;
  }
});
