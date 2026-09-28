import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOpenAiApiKey,
  setOpenAiApiKey,
  getExaApiKey,
  setExaApiKey,
  getResearchProvider,
  setResearchProvider,
  OPENAI_API_KEY_STORAGE_KEY,
  EXA_API_KEY_STORAGE_KEY,
  RESEARCH_PROVIDER_STORAGE_KEY,
} from '../src/shared/api-key-store.js';

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

test('getOpenAiApiKey returns an empty string when nothing has been saved yet', async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { sync: mockSyncStorage() } };
  try {
    assert.equal(await getOpenAiApiKey(), '');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('setOpenAiApiKey then getOpenAiApiKey round-trips the value under the expected storage key', async () => {
  const originalChrome = globalThis.chrome;
  const sync = mockSyncStorage();
  globalThis.chrome = { storage: { sync } };
  try {
    await setOpenAiApiKey('sk-abc123');
    assert.equal(await getOpenAiApiKey(), 'sk-abc123');
    assert.equal(sync.values[OPENAI_API_KEY_STORAGE_KEY], 'sk-abc123');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('setExaApiKey then getExaApiKey round-trips the value under its own storage key, independent of the OpenAI key', async () => {
  const originalChrome = globalThis.chrome;
  const sync = mockSyncStorage();
  globalThis.chrome = { storage: { sync } };
  try {
    await setOpenAiApiKey('sk-openai');
    await setExaApiKey('exa-key-123');
    assert.equal(await getExaApiKey(), 'exa-key-123');
    assert.equal(await getOpenAiApiKey(), 'sk-openai');
    assert.equal(sync.values[EXA_API_KEY_STORAGE_KEY], 'exa-key-123');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('getResearchProvider defaults to "openai" when nothing has been saved yet', async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { sync: mockSyncStorage() } };
  try {
    assert.equal(await getResearchProvider(), 'openai');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('setResearchProvider then getResearchProvider round-trips the chosen provider', async () => {
  const originalChrome = globalThis.chrome;
  const sync = mockSyncStorage();
  globalThis.chrome = { storage: { sync } };
  try {
    await setResearchProvider('exa');
    assert.equal(await getResearchProvider(), 'exa');
    assert.equal(sync.values[RESEARCH_PROVIDER_STORAGE_KEY], 'exa');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('getResearchProvider falls back to "openai" for an unrecognized stored value', async () => {
  const originalChrome = globalThis.chrome;
  const sync = mockSyncStorage();
  sync.values[RESEARCH_PROVIDER_STORAGE_KEY] = 'not-a-real-provider';
  globalThis.chrome = { storage: { sync } };
  try {
    assert.equal(await getResearchProvider(), 'openai');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('setResearchProvider rejects an unknown provider', async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { sync: mockSyncStorage() } };
  try {
    await assert.rejects(setResearchProvider('claude'), /Unknown research provider/);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
