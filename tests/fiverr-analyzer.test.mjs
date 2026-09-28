import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadAnalyzer() {
  const source = await readFile(new URL('../src/background/ai/fiverr-analyzer.js', import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('sends only the four whitelisted seller fields and enforces a strict bounded response', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  name: null,
                  website_url: null,
                  website_source_url: null,
                  email: null,
                  email_type: 'agency',
                  email_source_url: null,
                  linkedin_url: null,
                  linkedin_source_url: null,
                  contact_name: null,
                  contact_phone: null,
                  contact_url: null,
                  contact_source_url: null,
                }),
              },
            ],
          },
        ],
      }),
    };
  };

  try {
    const result = await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
      crawledAt: '2026-09-25T00:00:00.000Z',
      sellerData: {
        list: { sellerName: 'Oleg', gigTitle: 'I will create social media ads' },
        detail: {
          username: 'olegchuprina',
          fiverrName: '  Oleg   Chuprina  ',
          oneLiner: 'Elite Digital Designer',
          sellerBio: ' Hi, I’m Oleg Chuprina.   9 years in design. ',
          location: 'Ukraine',
          categories: ['Graphics & Design', ' Graphics & Design ', 'Social Media Design'],
          profileUrl: 'https://www.fiverr.com/olegchuprina',
          gigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
        },
      },
    });

    assert.equal(request.tool_choice, 'required');
    assert.equal(request.max_tool_calls, 1);
    assert.deepEqual(request.reasoning, { effort: 'low' });
    assert.equal(request.max_output_tokens, 1600);
    assert.deepEqual(request.tools, [
      {
        type: 'web_search',
        search_context_size: 'medium',
        filters: { blocked_domains: ['fiverr.com'] },
        user_location: { type: 'approximate', country: 'UA' },
      },
    ]);
    assert.equal(request.prompt_cache_key, 'hunt-ex-fiverr-seller-contact-research');
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
    assert.equal(request.text.format.schema.additionalProperties, false);
    const input = JSON.parse(request.input[0].content[0].text.split('\n').at(-1));
    assert.deepEqual(input, {
      name: 'Oleg Chuprina',
      bio: 'Hi, I’m Oleg Chuprina. 9 years in design.',
      location: 'Ukraine',
      service: ['Graphics & Design', 'Social Media Design'],
    });
    assert.deepEqual(Object.keys(input), ['name', 'bio', 'location', 'service']);
    // Model returned name: null -> falls back to the resolved seller name, same rule as agency.
    assert.equal(result.name, 'Oleg Chuprina');
    assert.equal(result.location.country, 'Ukraine');
    assert.equal(result.source, 'fiverr');
    assert.equal(result.type, 'freelancer');
    assert.equal(result.fiverr_profile_url, 'https://www.fiverr.com/olegchuprina');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('falls back to the list card name when detail extraction only recovered the username', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"name":"Brandon Ewing"}' }] }],
      }),
    };
  };

  try {
    // .seller-card-name didn't match on this gig page (real anomaly seen live) — fiverrName fell
    // back to the raw username, but the search-list card still had the real display name.
    const result = await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/snuba1/be-your-google-ads-marketing-agency',
      sellerData: {
        list: { sellerName: 'Brandon Ewing' },
        detail: {
          username: 'snuba1',
          fiverrName: 'snuba1',
          oneLiner: '',
          sellerBio: '',
          location: null,
          categories: ['End-to-End Projects'],
        },
      },
    });

    const input = JSON.parse(request.input[0].content[0].text.split('\n').at(-1));
    assert.equal(input.name, 'Brandon Ewing');
    assert.equal(result.name, 'Brandon Ewing');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('accepts an agency display name that only differs from the username by letter casing', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"name":"ReachGiant"}' }] }],
      }),
    };
  };

  try {
    // Real live anomaly (2026-09-25): agency-template gig page for username "reachgiant" — DOM name
    // resolves to "ReachGiant" (real display name, from a[href^="/agencies/"] in fiverr.js). A
    // case-INsensitive fallback check would wrongly treat this as "still just the username" and
    // block the API call. Must be treated as a real name since it differs by casing.
    const result = await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/reachgiant/be-your-google-ads-marketing-agency',
      sellerData: {
        list: { sellerName: 'reachgiant' },
        detail: {
          username: 'reachgiant',
          fiverrName: 'ReachGiant',
          oneLiner: '',
          sellerBio: 'At ReachGiant, we build momentum for brands across the U.S.',
          location: 'United States',
          categories: ['Digital Marketing'],
        },
      },
    });

    const input = JSON.parse(request.input[0].content[0].text.split('\n').at(-1));
    assert.equal(input.name, 'ReachGiant');
    assert.equal(result.name, 'ReachGiant');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('maps the compact AI result back to the shared lead contract', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                name: 'Oleg Chuprina',
                website_url: 'https://oleg.example/',
                website_source_url: 'https://oleg.example/',
                email: 'hello@oleg.example',
                email_type: 'direct',
                email_source_url: 'https://oleg.example/contact',
                linkedin_url: 'https://www.linkedin.com/in/oleg-chuprina/',
                linkedin_source_url: 'https://www.linkedin.com/in/oleg-chuprina/',
                contact_name: 'Oleg Chuprina',
                contact_phone: '+380 44 123 4567',
                contact_url: 'https://www.instagram.com/olegchuprina/',
                contact_source_url: 'https://oleg.example/',
              }),
            },
          ],
        },
      ],
    }),
  });

  try {
    const result = await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
      sellerData: {
        list: { sellerName: 'Oleg' },
        detail: { username: 'olegchuprina', fiverrName: 'Oleg Chuprina', location: 'Ukraine' },
      },
    });
    assert.equal(result.name, 'Oleg Chuprina');
    assert.equal('job' in result, false);
    assert.equal(result.source, 'fiverr');
    assert.equal(result.type, 'freelancer');
    assert.equal(result.location.country, 'Ukraine');
    assert.equal(result.emails[0].type, 'direct');
    assert.equal(result.phones[0].type, 'direct');
    assert.equal(result.other_contacts[0].platform, 'instagram');
    assert.equal('identity_confidence' in result, false);
    assert.equal('matched_signals' in result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('omits user_location when the crawled location text does not map to a known country', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"name":"Someone"}' }] }],
      }),
    };
  };

  try {
    await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/someone/a-gig',
      sellerData: {
        list: {},
        detail: {
          username: 'someone',
          fiverrName: 'Someone Real',
          sellerBio: 'A bio.',
          location: 'Somewhere made up', // not a real country name — must not guess a code
          categories: [],
        },
      },
    });

    assert.deepEqual(request.tools[0], {
      type: 'web_search',
      search_context_size: 'medium',
      filters: { blocked_domains: ['fiverr.com'] },
    });
    assert.equal('user_location' in request.tools[0], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('maps "United Kingdom" to the ISO 3166-1 code GB, not the historical alias UK (real 400 error from OpenAI, 2026-09-25)', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"name":"Someone"}' }] }],
      }),
    };
  };

  try {
    await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/someone/a-gig',
      sellerData: {
        list: {},
        detail: {
          username: 'someone',
          fiverrName: 'Someone Real',
          sellerBio: 'A bio.',
          location: 'United Kingdom',
          categories: [],
        },
      },
    });

    assert.equal(request.tools[0].user_location.country, 'GB');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('merges vettedFor (Pro seller specialties) into service alongside categories, deduped', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"name":"Luis"}' }] }],
      }),
    };
  };

  try {
    // Real HTML sample (2026-09-25, seller "voiceoverbyluis") — "Vetted for" only renders on
    // Fiverr Pro seller-cards, previously assumed always empty and dropped from the crawl.
    await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/voiceoverbyluis/create-a-ugc-tiktok-video-ad',
      sellerData: {
        list: {},
        detail: {
          username: 'voiceoverbyluis',
          fiverrName: 'Luis',
          oneLiner: 'Professional Bilingual Actor Reliable Quality',
          sellerBio: 'Hi, I’m Luis! Seasoned on-camera actor.',
          location: 'United States',
          categories: ['Video & Animation', 'UGC Videos', 'Human UGC'],
          vettedFor: ['Spokespersons Videos', 'UGC Videos', 'Video Consultation'],
        },
      },
    });

    const input = JSON.parse(request.input[0].content[0].text.split('\n').at(-1));
    assert.deepEqual(input.service, [
      'Video & Animation',
      'UGC Videos',
      'Human UGC',
      'Spokespersons Videos',
      'Video Consultation',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries once when the first attempt comes back fully empty, and keeps the second result if it found something', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    const text =
      callCount === 1
        ? '{"website_url":null,"website_source_url":null,"email":null,"email_type":"direct","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}'
        : '{"website_url":"https://example.com/","website_source_url":"https://example.com/","email":null,"email_type":"direct","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}';
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
    };
  };

  try {
    // Reproduces the real sampling-variance report (2026-09-25): same seller, same input, one call
    // finds nothing and the next call (identical request) finds a real website — a plain retry on
    // an empty result recovers it instead of silently losing the lead.
    const result = await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/someone/a-gig',
      sellerData: {
        list: {},
        detail: { username: 'someone', fiverrName: 'Someone Real', sellerBio: 'A bio.', location: null, categories: [] },
      },
    });

    assert.equal(callCount, 2);
    assert.equal(result.website.url, 'https://example.com/');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not retry when the first attempt already found a contact', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: '{"website_url":"https://example.com/","website_source_url":"https://example.com/","email":null,"email_type":"direct","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}',
              },
            ],
          },
        ],
      }),
    };
  };

  try {
    await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/someone/a-gig',
      sellerData: {
        list: {},
        detail: { username: 'someone', fiverrName: 'Someone Real', sellerBio: 'A bio.', location: null, categories: [] },
      },
    });
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps the first empty result when the retry attempt itself fails', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '{"website_url":null,"website_source_url":null,"email":null,"email_type":"direct","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}',
                },
              ],
            },
          ],
        }),
      };
    }
    return { ok: false, status: 500, text: async () => 'boom' };
  };

  try {
    const result = await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/someone/a-gig',
      sellerData: {
        list: {},
        detail: { username: 'someone', fiverrName: 'Someone Real', sellerBio: 'A bio.', location: null, categories: [] },
      },
    });
    assert.equal(result.website.url, null);
    assert.equal(result.source, 'fiverr');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sums token usage across attempt 1 and the empty-result retry', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    const usage =
      callCount === 1
        ? { input_tokens: 130, output_tokens: 45, total_tokens: 175 }
        : { input_tokens: 95, output_tokens: 35, total_tokens: 130 };
    const text =
      callCount === 1
        ? '{"website_url":null,"website_source_url":null,"email":null,"email_type":"direct","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}'
        : '{"website_url":"https://example.com/","website_source_url":"https://example.com/","email":null,"email_type":"direct","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}';
    return {
      ok: true,
      status: 200,
      json: async () => ({ usage, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
    };
  };

  try {
    const result = await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/someone/a-gig',
      sellerData: {
        list: {},
        detail: { username: 'someone', fiverrName: 'Someone Real', sellerBio: 'A bio.', location: null, categories: [] },
      },
    });
    assert.equal(callCount, 2);
    assert.deepEqual(result.token_usage, { input_tokens: 225, output_tokens: 80, total_tokens: 305 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports token usage for a single successful attempt (no retry)', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      usage: { input_tokens: 140, output_tokens: 50, total_tokens: 190 },
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: '{"website_url":"https://oleg.example/","website_source_url":"https://oleg.example/","email":null,"email_type":"direct","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}',
            },
          ],
        },
      ],
    }),
  });

  try {
    const result = await analyzeFiverrSeller('test-key', 'gpt-4.1', {
      fiverrGigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
      sellerData: {
        list: { sellerName: 'Oleg' },
        detail: { username: 'olegchuprina', fiverrName: 'Oleg Chuprina', location: 'Ukraine' },
      },
    });
    assert.deepEqual(result.token_usage, { input_tokens: 140, output_tokens: 50, total_tokens: 190 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects when sellerData is missing before spending an API call', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      analyzeFiverrSeller('test-key', 'gpt-4.1', { fiverrGigUrl: 'https://www.fiverr.com/someone/a-gig' }),
      /Cleaned Fiverr seller data is required/
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a seller whose name is only the raw username on both list and detail', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    // Reproduces the live anomaly where the whole seller-card section failed to match — the crawl-
    // level guard in fiverr.js let it through (gigTitle alone is enough there), so this gate is the
    // one that must reject it before spending a token.
    await assert.rejects(
      analyzeFiverrSeller('test-key', 'gpt-4.1', {
        fiverrGigUrl: 'https://www.fiverr.com/snuba1/be-your-google-ads-marketing-agency',
        sellerData: {
          list: { sellerName: 'snuba1' },
          detail: {
            username: 'snuba1',
            fiverrName: 'snuba1',
            oneLiner: '',
            sellerBio: '',
            location: null,
            categories: ['End-to-End Projects'],
          },
        },
      }),
      /seller name is missing/i
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a name-only seller before spending an API call', async () => {
  const { analyzeFiverrSeller } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      analyzeFiverrSeller('test-key', 'gpt-4.1', {
        sellerData: {
          list: {},
          detail: {
            username: 'someone',
            fiverrName: 'Someone Real',
            oneLiner: '',
            sellerBio: '',
            location: null,
            categories: [],
          },
        },
      }),
      /seller data is incomplete/i
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- analyzeFiverrSellerWithExa (2026-09-28) ---------------------------------------------------

const SAMPLE_SELLER_DATA = {
  list: { sellerName: 'Oleg', gigTitle: 'I will create social media ads' },
  detail: {
    username: 'olegchuprina',
    fiverrName: 'Oleg Chuprina',
    oneLiner: 'Elite Digital Designer',
    sellerBio: 'Hi, I’m Oleg Chuprina. 9 years in design.',
    location: 'Ukraine',
    categories: ['Graphics & Design', 'Social Media Design'],
    profileUrl: 'https://www.fiverr.com/olegchuprina',
    gigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
  },
};

const EMPTY_RESEARCH_RESULT = {
  website_url: null,
  website_source_url: null,
  email: null,
  email_type: 'agency',
  email_source_url: null,
  linkedin_url: null,
  linkedin_source_url: null,
  contact_name: null,
  contact_phone: null,
  contact_url: null,
  contact_source_url: null,
};

function exaRunResponse(overrides = {}) {
  return {
    id: 'agent_run_1',
    object: 'agent_run',
    status: 'completed',
    output: { text: '', structured: EMPTY_RESEARCH_RESULT, grounding: [] },
    usage: { totalAcus: 1 },
    costDollars: { total: 0.1 },
    ...overrides,
  };
}

test('Exa: posts the query+outputSchema to /agent/runs with x-api-key auth and medium effort', async () => {
  const { analyzeFiverrSellerWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;
  let seenUrl;
  let seenKey;

  globalThis.fetch = async (url, options) => {
    seenUrl = url;
    seenKey = options.headers['x-api-key'];
    request = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => exaRunResponse() };
  };

  try {
    const result = await analyzeFiverrSellerWithExa('exa-test-key', {
      fiverrGigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
      crawledAt: '2026-09-25T00:00:00.000Z',
      sellerData: SAMPLE_SELLER_DATA,
    });

    assert.equal(seenUrl, 'https://api.exa.ai/agent/runs');
    assert.equal(seenKey, 'exa-test-key');
    assert.equal(request.effort, 'medium');
    assert.equal(request.outputSchema.additionalProperties, false);
    assert.ok(request.query.includes('Oleg Chuprina'));
    assert.ok(request.query.includes('Do not search or cite fiverr.com'));
    assert.equal(result.source, 'fiverr');
    assert.equal(result.type, 'freelancer');
    assert.equal(result.fiverr_profile_url, 'https://www.fiverr.com/olegchuprina');
    assert.equal(result.token_usage, null);
    assert.deepEqual(result.exa_usage, { totalAcus: 1 });
    assert.deepEqual(result.exa_cost, { total: 0.1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: polls GET /agent/runs/{id} until the run leaves queued/running and reads output.structured', async () => {
  const { analyzeFiverrSellerWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  // Fire the 4s poll-interval sleep immediately — this test only cares about the polling LOOP
  // logic (keep GETting until a terminal status), not the real wall-clock delay between polls.
  globalThis.setTimeout = (fn) => originalSetTimeout(fn, 0);
  let getCalls = 0;

  globalThis.fetch = async (url, options) => {
    if (options.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: 'agent_run_1', status: 'queued' }) };
    }
    getCalls++;
    assert.equal(url, 'https://api.exa.ai/agent/runs/agent_run_1');
    if (getCalls === 1) return { ok: true, status: 200, json: async () => ({ id: 'agent_run_1', status: 'running' }) };
    return {
      ok: true,
      status: 200,
      json: async () => exaRunResponse({ output: { text: '', structured: { ...EMPTY_RESEARCH_RESULT, email: 'oleg@example.com' } } }),
    };
  };

  try {
    const result = await analyzeFiverrSellerWithExa('exa-test-key', {
      fiverrGigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
      sellerData: SAMPLE_SELLER_DATA,
    });
    assert.equal(getCalls, 2);
    assert.equal(result.emails[0].value, 'oleg@example.com');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('Exa: retries once when the first attempt comes back fully empty', async () => {
  const { analyzeFiverrSellerWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  globalThis.fetch = async (_url, options) => {
    if (options.method === 'POST') {
      postCount++;
      const structured =
        postCount === 1 ? EMPTY_RESEARCH_RESULT : { ...EMPTY_RESEARCH_RESULT, website_url: 'https://oleg.example/' };
      return { ok: true, status: 200, json: async () => exaRunResponse({ output: { text: '', structured } }) };
    }
    throw new Error('should not poll — POST already returns a terminal status in this test');
  };

  try {
    const result = await analyzeFiverrSellerWithExa('exa-test-key', {
      fiverrGigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
      sellerData: SAMPLE_SELLER_DATA,
    });
    assert.equal(postCount, 2);
    assert.equal(result.website.url, 'https://oleg.example/');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: strips a fiverr.com URL the agent returns despite the soft no-fiverr instruction', async () => {
  const { analyzeFiverrSellerWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () =>
      exaRunResponse({
        output: {
          text: '',
          structured: { ...EMPTY_RESEARCH_RESULT, website_url: 'https://www.fiverr.com/olegchuprina', linkedin_url: 'https://linkedin.com/in/oleg' },
        },
      }),
  });

  try {
    const result = await analyzeFiverrSellerWithExa('exa-test-key', {
      fiverrGigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
      sellerData: SAMPLE_SELLER_DATA,
    });
    assert.equal(result.website.url, null);
    assert.equal(result.linkedin.url, 'https://linkedin.com/in/oleg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: surfaces a clear error when the run ends with status "failed"', async () => {
  const { analyzeFiverrSellerWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: 'agent_run_1',
      status: 'failed',
      error: { code: 'TIMEOUT', message: 'The run timed out.' },
    }),
  });

  try {
    await assert.rejects(
      analyzeFiverrSellerWithExa('exa-test-key', {
        fiverrGigUrl: 'https://www.fiverr.com/olegchuprina/design-pro-facebook-banner-ads',
        sellerData: SAMPLE_SELLER_DATA,
      }),
      /failed.*timed out/is
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: rejects when apiKey is missing before making any request', async () => {
  const { analyzeFiverrSellerWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      analyzeFiverrSellerWithExa('', { sellerData: SAMPLE_SELLER_DATA }),
      /Exa API key is not configured/
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
