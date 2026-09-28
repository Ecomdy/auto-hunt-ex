import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadAnalyzer() {
  const source = await readFile(new URL('../src/background/ai/agency-analyzer.js', import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('sends only the four whitelisted agency fields and enforces a strict bounded response', async () => {
  const { analyzeAgency } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'resp_test',
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
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
    const result = await analyzeAgency('test-key', 'gpt-5.6-terra', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/895274624278921216/',
      crawledAt: '2026-09-24T00:00:00.000Z',
      agencyData: {
        upworkName: '  Appsysco   Marketing  ',
        overview: ' Performance   marketing for ecommerce brands. ',
        tagline: 'This is ignored when overview exists',
        location: 'Mohali, India',
        services: ['Paid Media', ' Paid Media ', 'SEO'],
        members: [{ name: 'Must not be sent' }],
        portfolio: ['Must not be sent'],
        totalEarned: '$1M+',
      },
    });

    assert.equal(request.tool_choice, 'required');
    assert.equal(request.max_tool_calls, 1);
    assert.deepEqual(request.reasoning, { effort: 'low' });
    assert.equal(request.max_output_tokens, 1600);
    assert.deepEqual(request.tools, [
      { type: 'web_search', search_context_size: 'low', filters: { blocked_domains: ['upwork.com'] } },
    ]);
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
    assert.equal(request.text.format.schema.additionalProperties, false);
    assert.doesNotMatch(request.instructions, /"sources"/);
    const input = JSON.parse(request.input[0].content[0].text.split('\n').at(-1));
    assert.deepEqual(input, {
      name: 'Appsysco Marketing',
      description: 'Performance marketing for ecommerce brands.',
      location: 'Mohali, India',
      service: ['Paid Media', 'SEO'],
    });
    assert.deepEqual(Object.keys(input), ['name', 'description', 'location', 'service']);
    // Model returned name: null -> falls back to the Upwork agency name, same rule as freelancer's display_name fallback.
    assert.equal(result.name, 'Appsysco Marketing');
    assert.equal(result.location.country, 'India');
    assert.equal(result.upwork_profile_url, 'https://www.upwork.com/agencies/895274624278921216/');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uses tagline as description fallback and accepts a single service string', async () => {
  const { analyzeAgency } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"name":"Acme"}' }] }],
      }),
    };
  };

  try {
    await analyzeAgency('test-key', 'gpt-5.6-terra', {
      agencyData: { upworkName: 'Acme', tagline: 'Design partner', services: 'Web Design' },
    });
    const input = JSON.parse(request.input[0].content[0].text.split('\n').at(-1));
    assert.deepEqual(input, {
      name: 'Acme',
      description: 'Design partner',
      location: null,
      service: ['Web Design'],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('maps the compact AI result back to the shared lead contract', async () => {
  const { analyzeAgency } = await loadAnalyzer();
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
                name: 'Acme Studio',
                website_url: 'https://acme.example/',
                website_source_url: 'https://acme.example/',
                email: 'hello@acme.example',
                email_type: 'agency',
                email_source_url: 'https://acme.example/contact',
                linkedin_url: 'https://www.linkedin.com/company/acme-studio/',
                linkedin_source_url: 'https://www.linkedin.com/company/acme-studio/',
                contact_name: 'Jane Doe',
                contact_phone: '+1 555 0100',
                contact_url: 'https://www.linkedin.com/in/jane-doe/',
                contact_source_url: 'https://www.linkedin.com/in/jane-doe/',
              }),
            },
          ],
        },
      ],
    }),
  });

  try {
    const result = await analyzeAgency('test-key', 'gpt-5.6-terra', {
      agencyData: { upworkName: 'Acme', location: 'Austin, United States' },
    });
    assert.equal(result.name, 'Acme Studio');
    assert.equal('job' in result, false);
    assert.equal(result.source, 'upwork');
    assert.equal(result.type, 'agency');
    assert.equal(result.location.country, 'United States');
    assert.equal(result.emails[0].type, 'agency');
    assert.equal(result.phones[0].type, 'direct');
    assert.equal(result.other_contacts[0].platform, 'company_profile');
    assert.equal('identity_confidence' in result, false);
    assert.equal('matched_signals' in result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries once when the first attempt comes back fully empty, and keeps the second result if it found something', async () => {
  const { analyzeAgency } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    const text =
      callCount === 1
        ? '{"name":null,"website_url":null,"website_source_url":null,"email":null,"email_type":"agency","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}'
        : '{"name":null,"website_url":"https://example.com/","website_source_url":"https://example.com/","email":null,"email_type":"agency","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}';
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
    };
  };

  try {
    // Same sampling-variance risk fiverr-analyzer.js hit live (2026-09-25): same input, one call
    // finds nothing and the next call (identical request) finds a real website. Agency has never run
    // live yet, so this guards against losing a lead to it on the very first real batch.
    const result = await analyzeAgency('test-key', 'gpt-5.6-terra', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/1/',
      agencyData: { upworkName: 'Acme', overview: 'A small agency.' },
    });

    assert.equal(callCount, 2);
    assert.equal(result.website.url, 'https://example.com/');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not retry when the first attempt already found a contact', async () => {
  const { analyzeAgency } = await loadAnalyzer();
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
                text: '{"name":null,"website_url":"https://example.com/","website_source_url":"https://example.com/","email":null,"email_type":"agency","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}',
              },
            ],
          },
        ],
      }),
    };
  };

  try {
    await analyzeAgency('test-key', 'gpt-5.6-terra', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/1/',
      agencyData: { upworkName: 'Acme', overview: 'A small agency.' },
    });
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps the first empty result when the retry attempt itself fails', async () => {
  const { analyzeAgency } = await loadAnalyzer();
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
                  text: '{"name":null,"website_url":null,"website_source_url":null,"email":null,"email_type":"agency","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}',
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
    const result = await analyzeAgency('test-key', 'gpt-5.6-terra', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/1/',
      agencyData: { upworkName: 'Acme', overview: 'A small agency.' },
    });
    assert.equal(result.website.url, null);
    assert.equal(result.source, 'upwork');
    assert.equal(result.type, 'agency');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sums token usage across attempt 1 and the empty-result retry', async () => {
  const { analyzeAgency } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    const usage =
      callCount === 1
        ? { input_tokens: 120, output_tokens: 40, total_tokens: 160 }
        : { input_tokens: 90, output_tokens: 30, total_tokens: 120 };
    const text =
      callCount === 1
        ? '{"name":null,"website_url":null,"website_source_url":null,"email":null,"email_type":"agency","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}'
        : '{"name":null,"website_url":"https://example.com/","website_source_url":"https://example.com/","email":null,"email_type":"agency","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}';
    return {
      ok: true,
      status: 200,
      json: async () => ({ usage, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
    };
  };

  try {
    const result = await analyzeAgency('test-key', 'gpt-5.6-terra', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/1/',
      agencyData: { upworkName: 'Acme', overview: 'A small agency.' },
    });
    assert.equal(callCount, 2);
    assert.deepEqual(result.token_usage, { input_tokens: 210, output_tokens: 70, total_tokens: 280 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports token usage for a single successful attempt (no retry)', async () => {
  const { analyzeAgency } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      usage: { input_tokens: 200, output_tokens: 60, total_tokens: 260 },
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: '{"name":"Acme Studio","website_url":"https://acme.example/","website_source_url":"https://acme.example/","email":null,"email_type":"agency","email_source_url":null,"linkedin_url":null,"linkedin_source_url":null,"contact_name":null,"contact_phone":null,"contact_url":null,"contact_source_url":null}',
            },
          ],
        },
      ],
    }),
  });

  try {
    const result = await analyzeAgency('test-key', 'gpt-5.6-terra', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/1/',
      agencyData: { upworkName: 'Acme', overview: 'A small agency.' },
    });
    assert.deepEqual(result.token_usage, { input_tokens: 200, output_tokens: 60, total_tokens: 260 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects when agencyData is missing before spending an API call', async () => {
  const { analyzeAgency } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      analyzeAgency('test-key', 'gpt-5.6-terra', { upworkAgencyUrl: 'https://www.upwork.com/agencies/1/' }),
      /Cleaned Upwork agency data is required/
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects agency data without a name before spending an API call', async () => {
  const { analyzeAgency } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      analyzeAgency('test-key', 'gpt-5.6-terra', { agencyData: { overview: 'No agency name' } }),
      /agency name is missing/i
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a name-only agency before spending an API call', async () => {
  const { analyzeAgency } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      analyzeAgency('test-key', 'gpt-5.6-terra', {
        agencyData: {
          upworkName: 'Acme',
          overview: null,
          tagline: null,
          location: null,
          services: [],
        },
      }),
      /agency data is incomplete/i
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- analyzeAgencyWithExa (2026-09-28) ----------------------------------------------------------

const EMPTY_AGENCY_RESEARCH_RESULT = {
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
};

function exaRunResponse(overrides = {}) {
  return {
    id: 'agent_run_1',
    object: 'agent_run',
    status: 'completed',
    output: { text: '', structured: EMPTY_AGENCY_RESEARCH_RESULT, grounding: [] },
    usage: { totalAcus: 1 },
    costDollars: { total: 0.1 },
    ...overrides,
  };
}

test('Exa: posts the query+outputSchema to /agent/runs with x-api-key auth and medium effort', async () => {
  const { analyzeAgencyWithExa } = await loadAnalyzer();
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
    const result = await analyzeAgencyWithExa('exa-test-key', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/895274624278921216/',
      crawledAt: '2026-09-24T00:00:00.000Z',
      agencyData: { upworkName: 'Appsysco Marketing', overview: 'Performance marketing for ecommerce brands.', location: 'Mohali, India' },
    });

    assert.equal(seenUrl, 'https://api.exa.ai/agent/runs');
    assert.equal(seenKey, 'exa-test-key');
    assert.equal(request.effort, 'medium');
    assert.equal(request.outputSchema.additionalProperties, false);
    assert.ok(request.query.includes('Appsysco Marketing'));
    assert.ok(request.query.includes('Do not search or cite upwork.com'));
    assert.equal(result.source, 'upwork');
    assert.equal(result.type, 'agency');
    assert.equal(result.name, 'Appsysco Marketing');
    assert.equal(result.upwork_profile_url, 'https://www.upwork.com/agencies/895274624278921216/');
    assert.equal(result.token_usage, null);
    assert.deepEqual(result.exa_usage, { totalAcus: 1 });
    assert.deepEqual(result.exa_cost, { total: 0.1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: retries once when the first attempt comes back fully empty, and keeps the second result if it found something', async () => {
  const { analyzeAgencyWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  globalThis.fetch = async (_url, options) => {
    postCount++;
    const structured =
      postCount === 1 ? EMPTY_AGENCY_RESEARCH_RESULT : { ...EMPTY_AGENCY_RESEARCH_RESULT, website_url: 'https://example.com/' };
    return { ok: true, status: 200, json: async () => exaRunResponse({ output: { text: '', structured } }) };
  };

  try {
    const result = await analyzeAgencyWithExa('exa-test-key', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/1/',
      agencyData: { upworkName: 'Acme', overview: 'A small agency.' },
    });
    assert.equal(postCount, 2);
    assert.equal(result.website.url, 'https://example.com/');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: does not retry when the first attempt already found a contact', async () => {
  const { analyzeAgencyWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  globalThis.fetch = async () => {
    postCount++;
    return {
      ok: true,
      status: 200,
      json: async () => exaRunResponse({ output: { text: '', structured: { ...EMPTY_AGENCY_RESEARCH_RESULT, website_url: 'https://example.com/' } } }),
    };
  };

  try {
    await analyzeAgencyWithExa('exa-test-key', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/1/',
      agencyData: { upworkName: 'Acme', overview: 'A small agency.' },
    });
    assert.equal(postCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: strips an upwork.com URL the agent returns despite the soft no-upwork instruction', async () => {
  const { analyzeAgencyWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () =>
      exaRunResponse({
        output: {
          text: '',
          structured: {
            ...EMPTY_AGENCY_RESEARCH_RESULT,
            website_url: 'https://www.upwork.com/agencies/1/',
            linkedin_url: 'https://www.linkedin.com/company/acme-studio/',
          },
        },
      }),
  });

  try {
    const result = await analyzeAgencyWithExa('exa-test-key', {
      upworkAgencyUrl: 'https://www.upwork.com/agencies/1/',
      agencyData: { upworkName: 'Acme', overview: 'A small agency.' },
    });
    assert.equal(result.website.url, null);
    assert.equal(result.linkedin.url, 'https://www.linkedin.com/company/acme-studio/');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: surfaces a clear error when the run ends with status "failed"', async () => {
  const { analyzeAgencyWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'agent_run_1', status: 'failed', error: { code: 'TIMEOUT', message: 'The run timed out.' } }),
  });

  try {
    await assert.rejects(
      analyzeAgencyWithExa('exa-test-key', {
        upworkAgencyUrl: 'https://www.upwork.com/agencies/1/',
        agencyData: { upworkName: 'Acme', overview: 'A small agency.' },
      }),
      /failed.*timed out/is
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: rejects when apiKey is missing before making any request', async () => {
  const { analyzeAgencyWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      analyzeAgencyWithExa('', { agencyData: { upworkName: 'Acme', overview: 'A small agency.' } }),
      /Exa API key is not configured/
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
