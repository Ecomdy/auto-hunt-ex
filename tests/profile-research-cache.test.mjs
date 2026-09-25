import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearProfileResearchCache,
  getCachedProfileResearch,
  setCachedProfileResearch,
} from '../src/background/ai/profile-research-cache.js';

function mockSessionStorage() {
  const values = {};
  return {
    values,
    async get(key) {
      if (key === null) return { ...values };
      return key in values ? { [key]: values[key] } : {};
    },
    async set(items) {
      Object.assign(values, structuredClone(items));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  };
}

test('profile research cache is stable per model + URL + profile data and clears by prefix', async () => {
  const originalChrome = globalThis.chrome;
  const session = mockSessionStorage();
  globalThis.chrome = { storage: { session } };
  const payload = {
    upworkProfileUrl: 'https://www.upwork.com/freelancers/test',
    profileData: { identity: { display_name: 'Jane D.' } },
  };

  try {
    assert.equal(await getCachedProfileResearch('gpt-5.6-terra', payload), null);
    const positiveResult = {
      name: 'Jane Doe',
      linkedin: { url: 'https://www.linkedin.com/in/jane-doe/' },
      website: { url: null },
    };
    assert.equal(await setCachedProfileResearch('gpt-5.6-terra', payload, positiveResult), true);
    assert.deepEqual(await getCachedProfileResearch('gpt-5.6-terra', payload), positiveResult);
    assert.equal(await getCachedProfileResearch('different-model', payload), null);
    assert.equal(
      await getCachedProfileResearch('gpt-5.6-terra', {
        ...payload,
        profileData: { identity: { display_name: 'Jane D.', headline: 'Changed' } },
      }),
      null
    );

    session.values.unrelated = { keep: true };
    await clearProfileResearchCache();
    assert.deepEqual(session.values, { unrelated: { keep: true } });
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('does not cache a negative identity result', async () => {
  const originalChrome = globalThis.chrome;
  const session = mockSessionStorage();
  globalThis.chrome = { storage: { session } };
  const payload = {
    upworkProfileUrl: 'https://www.upwork.com/freelancers/missing',
    profileData: { identity: { display_name: 'Jane D.' } },
  };

  try {
    const stored = await setCachedProfileResearch('gpt-5.6-terra', payload, {
      linkedin: { url: null },
      website: { url: null },
    });
    assert.equal(stored, false);
    assert.equal(await getCachedProfileResearch('gpt-5.6-terra', payload), null);
    assert.deepEqual(session.values, {});
  } finally {
    globalThis.chrome = originalChrome;
  }
});
