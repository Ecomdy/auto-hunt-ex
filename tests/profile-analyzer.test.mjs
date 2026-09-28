import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadAnalyzer() {
  const source = await readFile(new URL('../src/background/ai/profile-analyzer.js', import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function apiResponse(
  result,
  { id, inputTokens = 10, outputTokens = 5, searches = 1, queries = [], sourceUrls = [] } = {}
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      output: [
        ...Array.from({ length: searches }, (_, index) => ({
          type: 'web_search_call',
          id: `${id}_s${index}`,
          action: {
            type: 'search',
            queries,
            sources: sourceUrls.map((url) => ({ type: 'url', url })),
          },
        })),
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] },
      ],
    }),
  };
}

const PROFILE_DATA = {
  identity: {
    display_name: 'Jane D.',
    headline: 'Paid Media Strategist',
    location: 'Austin, Texas, United States',
  },
  about: 'Runs paid acquisition for ecommerce brands.',
  employment_history: 'Growth Lead at Rare Commerce Labs',
  skills: ['Meta Ads', 'Google Ads'],
};

test('runs deterministic identity then contact stages with strict structured outputs', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return apiResponse(
        {
          status: 'verified',
          verified_name: 'Jane Doe',
          linkedin_url: 'https://www.linkedin.com/in/jane-doe/',
          website_url: 'https://janedoe.example/',
          evidence_urls: ['https://janedoe.example/about'],
          matched_input_signals: ['Rare Commerce Labs', 'Paid Media Strategist'],
        },
        {
          id: 'resp_identity',
          inputTokens: 100,
          outputTokens: 20,
          searches: 1,
          queries: ['Jane D Rare Commerce Labs'],
          sourceUrls: ['https://www.linkedin.com/in/jane-doe/', 'https://janedoe.example/about'],
        }
      );
    }
    return apiResponse(
      {
        email: 'jane@janedoe.example',
        email_type: 'direct',
        email_source_url: 'https://janedoe.example/contact',
        phone: null,
        phone_source_url: null,
        contact_url: 'https://janedoe.example/contact',
        contact_source_url: 'https://janedoe.example/contact',
      },
      {
        id: 'resp_contact',
        inputTokens: 50,
        outputTokens: 10,
        queries: ['site:janedoe.example email contact'],
        sourceUrls: ['https://janedoe.example/contact'],
      }
    );
  };

  try {
    const result = await analyzeProfile('test-key', 'gpt-5.6-terra', {
      upworkProfileUrl: 'https://www.upwork.com/freelancers/test',
      profileData: PROFILE_DATA,
    });

    assert.equal(requests.length, 2);
    assert.match(requests[0].instructions, /single supplied search query/);
    assert.equal(requests[0].text.format.type, 'json_schema');
    assert.equal(requests[0].text.format.strict, true);
    assert.equal(requests[0].text.format.name, 'upwork_freelancer_identity');
    assert.equal(requests[0].max_tool_calls, 1);
    assert.equal(requests[0].tools[0].search_context_size, 'low');
    assert.deepEqual(requests[0].include, ['web_search_call.action.sources']);
    const identityInput = JSON.parse(requests[0].input[0].content[0].text.split('\n').at(-1));
    assert.deepEqual(identityInput.search_queries, [
      'Jane D "Growth Lead at Rare Commerce Labs" paid media strategist United States',
    ]);

    assert.equal(requests[1].text.format.name, 'upwork_freelancer_contact');
    assert.equal(requests[1].max_tool_calls, 2);
    assert.deepEqual(requests[1].tools[0].filters, { allowed_domains: ['janedoe.example'] });
    const contactInput = JSON.parse(requests[1].input[0].content[0].text.split('\n').at(-1));
    assert.equal(contactInput.verified_name, 'Jane Doe');
    assert.deepEqual(contactInput.search_queries, ['site:janedoe.example ("email" OR "phone" OR "contact")']);

    assert.equal(result.source, 'upwork');
    assert.equal(result.type, 'freelancer');
    assert.equal(result.name, 'Jane Doe');
    assert.deepEqual(result.location, {
      city: 'Austin',
      state_region: 'Texas',
      country: 'United States',
    });
    assert.equal(result.website.url, 'https://janedoe.example/');
    assert.equal(result.linkedin.url, 'https://www.linkedin.com/in/jane-doe/');
    assert.equal(result.emails[0].value, 'jane@janedoe.example');
    assert.equal(result.other_contacts[0].platform, 'contact_form');
    assert.equal('job' in result, false);
    assert.equal('identity_confidence' in result, false);
    assert.equal('research_meta' in result, false);
    // Cộng dồn usage của cả 2 stage đã thật sự chạy (identity 100+20, contact 50+10).
    assert.deepEqual(result.token_usage, { input_tokens: 150, output_tokens: 30, total_tokens: 180 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uses one broader LinkedIn search and skips retry for a low-signal profile', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return apiResponse(
      {
        status: 'not_found',
        verified_name: null,
        linkedin_url: null,
        website_url: null,
        evidence_urls: [],
        matched_input_signals: [],
      },
      { id: 'resp_low_signal' }
    );
  };

  try {
    const result = await analyzeProfile('test-key', 'gpt-5.6-terra', {
      profileData: {
        identity: {
          display_name: 'Jane D.',
          headline: 'Paid Media Strategist',
          location: 'Austin, Texas, United States',
        },
      },
    });
    assert.equal(requests.length, 1);
    const input = JSON.parse(requests[0].input[0].content[0].text.split('\n').at(-1));
    assert.deepEqual(input.search_queries, [
      'site:linkedin.com/in Jane D paid media strategist United States',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runs the explicit LinkedIn fallback then stops when identity remains ambiguous', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    return apiResponse(
      {
        status: 'ambiguous',
        verified_name: null,
        linkedin_url: null,
        website_url: null,
        evidence_urls: [],
        matched_input_signals: [],
      },
      { id: `resp_ambiguous_${callCount}` }
    );
  };

  try {
    const result = await analyzeProfile('test-key', 'gpt-5.6-terra', { profileData: PROFILE_DATA });
    assert.equal(callCount, 2);
    assert.equal(result.name, 'Jane D.');
    assert.deepEqual(result.website, { url: null, source_url: null });
    assert.deepEqual(result.linkedin, { url: null, source_url: null });
    assert.equal(result.emails, null);
    assert.equal(result.phones, null);
    assert.equal(result.other_contacts, null);
    // Early-return branch (never verified, no contact stage) — vẫn phải cộng đúng 2 call identity
    // (mỗi call dùng token mặc định của apiResponse(): 10 input + 5 output).
    assert.deepEqual(result.token_usage, { input_tokens: 20, output_tokens: 10, total_tokens: 30 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not treat a different profile on a shared host as a direct external-link match', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return apiResponse(
      {
        status: 'verified',
        verified_name: 'Jane Doe',
        linkedin_url: null,
        website_url: 'https://github.com/someone-else',
        evidence_urls: ['https://github.com/someone-else'],
        matched_input_signals: ['Jane'],
      },
      { id: 'resp_wrong_github' }
    );
  };

  try {
    const result = await analyzeProfile('test-key', 'gpt-5.6-terra', {
      profileData: {
        ...PROFILE_DATA,
        external_links: [{ url: 'https://github.com/jane-doe' }],
      },
    });
    assert.equal(requests.length, 2);
    const firstIdentityInput = JSON.parse(requests[0].input[0].content[0].text.split('\n').at(-1));
    const retryIdentityInput = JSON.parse(requests[1].input[0].content[0].text.split('\n').at(-1));
    assert.equal(firstIdentityInput.search_queries.length, 1);
    assert.equal(retryIdentityInput.search_queries.length, 1);
    assert.match(retryIdentityInput.search_queries[0], /^site:linkedin\.com\/in/);
    assert.equal(retryIdentityInput.prior_candidate.website_url, 'https://github.com/someone-else');
    assert.deepEqual(result.website, { url: null, source_url: null });
    assert.deepEqual(result.linkedin, { url: null, source_url: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uses the LinkedIn fallback result to unlock the contact stage', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return apiResponse(
        {
          status: 'not_found',
          verified_name: null,
          linkedin_url: null,
          website_url: null,
          evidence_urls: [],
          matched_input_signals: [],
        },
        { id: 'resp_identity_not_found' }
      );
    }
    if (requests.length === 2) {
      return apiResponse(
        {
          status: 'verified',
          verified_name: 'Jane Doe',
          linkedin_url: 'https://www.linkedin.com/in/jane-doe/',
          website_url: 'https://janedoe.example/',
          evidence_urls: ['https://janedoe.example/about'],
          matched_input_signals: ['Rare Commerce Labs', 'Paid Media Strategist'],
        },
        { id: 'resp_identity_retry' }
      );
    }
    return apiResponse(
      {
        email: 'jane@janedoe.example',
        email_type: 'direct',
        email_source_url: 'https://janedoe.example/contact',
        phone: null,
        phone_source_url: null,
        contact_url: null,
        contact_source_url: null,
      },
      { id: 'resp_contact' }
    );
  };

  try {
    const result = await analyzeProfile('test-key', 'gpt-5.6-terra', { profileData: PROFILE_DATA });
    assert.equal(requests.length, 3);
    assert.equal(requests[1].text.format.name, 'upwork_freelancer_identity_retry');
    const retryInput = JSON.parse(requests[1].input[0].content[0].text.split('\n').at(-1));
    assert.match(retryInput.search_queries[0], /^site:linkedin\.com\/in/);
    assert.equal(retryInput.prior_candidate.status, 'not_found');
    assert.equal(requests[2].text.format.name, 'upwork_freelancer_contact');
    assert.equal(result.linkedin.url, 'https://www.linkedin.com/in/jane-doe/');
    assert.equal(result.emails[0].value, 'jane@janedoe.example');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runs one targeted contact retry only when verified identity has no contacts', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return apiResponse(
        {
          status: 'verified',
          verified_name: 'Jane Doe',
          linkedin_url: 'https://www.linkedin.com/in/jane-doe/',
          website_url: 'https://janedoe.example/',
          evidence_urls: ['https://janedoe.example/about'],
          matched_input_signals: ['Rare Commerce Labs', 'Austin'],
        },
        { id: 'resp_identity' }
      );
    }
    if (requests.length === 2) {
      return apiResponse(
        {
          email: null,
          email_type: 'direct',
          email_source_url: null,
          phone: null,
          phone_source_url: null,
          contact_url: null,
          contact_source_url: null,
        },
        { id: 'resp_contact_empty' }
      );
    }
    return apiResponse(
      {
        email: 'jane@janedoe.example',
        email_type: 'direct',
        email_source_url: 'https://janedoe.example/contact',
        phone: null,
        phone_source_url: null,
        contact_url: null,
        contact_source_url: null,
      },
      { id: 'resp_contact_retry' }
    );
  };

  try {
    const result = await analyzeProfile('test-key', 'gpt-5.6-terra', { profileData: PROFILE_DATA });
    assert.equal(requests.length, 3);
    assert.equal(requests[2].text.format.name, 'upwork_freelancer_contact_retry');
    assert.equal(requests[2].max_tool_calls, 1);
    const retryInput = JSON.parse(requests[2].input[0].content[0].text.split('\n').at(-1));
    assert.equal(retryInput.search_queries.length, 1);
    assert.equal(result.emails[0].value, 'jane@janedoe.example');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects the verified LinkedIn URL as other contact and continues website retry', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return apiResponse(
        {
          status: 'verified',
          verified_name: 'Jane Doe',
          linkedin_url: 'https://www.linkedin.com/in/jane-doe/',
          website_url: 'https://janedoe.example/',
          evidence_urls: ['https://janedoe.example/about'],
          matched_input_signals: ['Rare Commerce Labs', 'Paid Media Strategist'],
        },
        { id: 'resp_identity' }
      );
    }
    if (requests.length === 2) {
      return apiResponse(
        {
          email: null,
          email_type: 'direct',
          email_source_url: null,
          phone: null,
          phone_source_url: null,
          contact_url: 'https://www.linkedin.com/in/jane-doe/',
          contact_source_url: 'https://www.linkedin.com/in/jane-doe/',
        },
        { id: 'resp_linkedin_duplicate' }
      );
    }
    return apiResponse(
      {
        email: 'jane@janedoe.example',
        email_type: 'direct',
        email_source_url: 'https://janedoe.example/contact',
        phone: null,
        phone_source_url: null,
        contact_url: 'https://janedoe.example/contact',
        contact_source_url: 'https://janedoe.example/contact',
      },
      { id: 'resp_website_retry' }
    );
  };

  try {
    const result = await analyzeProfile('test-key', 'gpt-5.6-terra', { profileData: PROFILE_DATA });
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[1].tools[0].filters, { allowed_domains: ['janedoe.example'] });
    assert.deepEqual(requests[2].tools[0].filters, { allowed_domains: ['janedoe.example'] });
    const retryInput = JSON.parse(requests[2].input[0].content[0].text.split('\n').at(-1));
    assert.deepEqual(retryInput.search_queries, [
      'site:janedoe.example (inurl:contact OR inurl:about OR inurl:founder)',
    ]);
    assert.equal(result.emails[0].value, 'jane@janedoe.example');
    assert.equal(result.other_contacts[0].value, 'https://janedoe.example/contact');
    assert.notEqual(result.other_contacts[0].value, result.linkedin.url);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects contact data whose source is outside the verified identity evidence', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) {
      return apiResponse(
        {
          status: 'verified',
          verified_name: 'Jane Doe',
          linkedin_url: 'https://www.linkedin.com/in/jane-doe/',
          website_url: 'https://janedoe.example/',
          evidence_urls: ['https://janedoe.example/about'],
          matched_input_signals: ['Rare Commerce Labs', 'Paid Media Strategist'],
        },
        { id: 'resp_identity' }
      );
    }
    if (callCount === 2) {
      return apiResponse(
        {
          email: 'jane@unrelated.example',
          email_type: 'direct',
          email_source_url: 'https://unrelated.example/directory/jane',
          phone: null,
          phone_source_url: null,
          contact_url: null,
          contact_source_url: null,
        },
        { id: 'resp_untrusted_contact' }
      );
    }
    return apiResponse(
      {
        email: null,
        email_type: 'direct',
        email_source_url: null,
        phone: null,
        phone_source_url: null,
        contact_url: null,
        contact_source_url: null,
      },
      { id: 'resp_empty_retry' }
    );
  };

  try {
    const result = await analyzeProfile('test-key', 'gpt-5.6-terra', { profileData: PROFILE_DATA });
    assert.equal(callCount, 3);
    assert.equal(result.emails, null);
    assert.equal(result.phones, null);
    assert.equal(result.other_contacts, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries a transient API failure once without changing the identity query', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  const requestBodies = [];

  globalThis.fetch = async (_url, options) => {
    requestBodies.push(options.body);
    if (requestBodies.length === 1) {
      return { ok: false, status: 503, text: async () => 'temporarily unavailable' };
    }
    return apiResponse(
      {
        status: 'not_found',
        verified_name: null,
        linkedin_url: null,
        website_url: null,
        evidence_urls: [],
        matched_input_signals: [],
      },
      { id: 'resp_retry_success' }
    );
  };

  try {
    const result = await analyzeProfile('test-key', 'gpt-5.6-terra', { profileData: PROFILE_DATA });
    assert.equal(requestBodies.length, 3);
    assert.equal(requestBodies[0], requestBodies[1]);
    assert.notEqual(requestBodies[1], requestBodies[2]);
    assert.equal(result.name, 'Jane D.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects missing, empty, name-only, and legacy freelancer input before API calls', async () => {
  const { analyzeProfile } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(analyzeProfile('test-key', 'gpt-5.6-terra', {}), /profile data is required/i);
    await assert.rejects(
      analyzeProfile('test-key', 'gpt-5.6-terra', { profileData: {} }),
      /freelancer data is incomplete/i
    );
    await assert.rejects(
      analyzeProfile('test-key', 'gpt-5.6-terra', {
        profileData: { identity: { display_name: 'Jane D.' }, skills: [], external_links: [] },
      }),
      /freelancer data is incomplete/i
    );
    await assert.rejects(
      analyzeProfile('test-key', 'gpt-5.6-terra', { profileText: 'x'.repeat(500) }),
      /legacy raw profile text is no longer accepted/i
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- analyzeProfileWithExa (2026-09-28) ----------------------------------------------------------
// Exa collapses the OpenAI 2-stage identity->contact pipeline into ONE agent run (see the comment
// block above EXA_INSTRUCTIONS in profile-analyzer.js for why) — validateIdentity()/validateContact()/
// buildFinalResult() are provider-agnostic, so the SAME verification bar (2+ rare signals or a direct
// external-link match, trusted contact source) applies regardless of which provider produced `raw`.

const VERIFIED_IDENTITY_AND_CONTACT = {
  status: 'verified',
  verified_name: 'Jane Doe',
  linkedin_url: 'https://www.linkedin.com/in/jane-doe/',
  website_url: 'https://janedoe.example/',
  evidence_urls: ['https://janedoe.example/about'],
  matched_input_signals: ['Rare Commerce Labs', 'Paid Media Strategist'],
  email: 'jane@janedoe.example',
  email_type: 'direct',
  email_source_url: 'https://janedoe.example/contact',
  phone: null,
  phone_source_url: null,
  contact_url: 'https://janedoe.example/contact',
  contact_source_url: 'https://janedoe.example/contact',
};

const NOT_FOUND_IDENTITY = {
  status: 'not_found',
  verified_name: null,
  linkedin_url: null,
  website_url: null,
  evidence_urls: [],
  matched_input_signals: [],
  email: null,
  email_type: 'direct',
  email_source_url: null,
  phone: null,
  phone_source_url: null,
  contact_url: null,
  contact_source_url: null,
};

function exaRunResponse(structured, overrides = {}) {
  return {
    id: 'agent_run_1',
    object: 'agent_run',
    status: 'completed',
    output: { text: '', structured, grounding: [] },
    usage: { totalAcus: 1 },
    costDollars: { total: 0.1 },
    ...overrides,
  };
}

test('Exa: posts one combined identity+contact query and maps a verified result through the same validators as OpenAI', async () => {
  const { analyzeProfileWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let request;
  let seenUrl;
  let seenKey;

  globalThis.fetch = async (url, options) => {
    seenUrl = url;
    seenKey = options.headers['x-api-key'];
    request = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => exaRunResponse(VERIFIED_IDENTITY_AND_CONTACT) };
  };

  try {
    const result = await analyzeProfileWithExa('exa-test-key', {
      upworkProfileUrl: 'https://www.upwork.com/freelancers/test',
      profileData: PROFILE_DATA,
    });

    assert.equal(seenUrl, 'https://api.exa.ai/agent/runs');
    assert.equal(seenKey, 'exa-test-key');
    assert.equal(request.effort, 'medium');
    assert.equal(request.outputSchema.additionalProperties, false);
    // Merged schema carries both identity AND contact fields in one call (no max_tool_calls-style split).
    assert.ok(request.outputSchema.required.includes('linkedin_url'));
    assert.ok(request.outputSchema.required.includes('email'));
    assert.ok(request.query.includes('Jane D'));
    assert.ok(request.query.includes('Do not search or cite upwork.com'));
    // search_queries is an OpenAI-only construct (forces the web_search tool's exact query) — Exa's
    // agent plans its own search, so it must not appear in the candidate JSON sent to Exa.
    assert.ok(!request.query.includes('search_queries'));

    assert.equal(result.name, 'Jane Doe');
    assert.equal(result.linkedin.url, 'https://www.linkedin.com/in/jane-doe/');
    assert.equal(result.website.url, 'https://janedoe.example/');
    assert.equal(result.emails[0].value, 'jane@janedoe.example');
    assert.equal(result.upwork_profile_url, 'https://www.upwork.com/freelancers/test');
    assert.equal(result.token_usage, null);
    assert.deepEqual(result.exa_usage, { totalAcus: 1 });
    assert.deepEqual(result.exa_cost, { total: 0.1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: leaves every contact field null when identity does not verify', async () => {
  const { analyzeProfileWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => exaRunResponse(NOT_FOUND_IDENTITY),
  });

  try {
    const result = await analyzeProfileWithExa('exa-test-key', {
      upworkProfileUrl: 'https://www.upwork.com/freelancers/test',
      profileData: PROFILE_DATA,
    });
    assert.equal(result.linkedin.url, null);
    assert.equal(result.website.url, null);
    assert.equal(result.emails, null);
    assert.equal(result.phones, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: retries once when identity is not verified on the first attempt, and keeps the retry when it verifies', async () => {
  const { analyzeProfileWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  globalThis.fetch = async () => {
    postCount++;
    const structured = postCount === 1 ? NOT_FOUND_IDENTITY : VERIFIED_IDENTITY_AND_CONTACT;
    return { ok: true, status: 200, json: async () => exaRunResponse(structured) };
  };

  try {
    const result = await analyzeProfileWithExa('exa-test-key', {
      upworkProfileUrl: 'https://www.upwork.com/freelancers/test',
      profileData: PROFILE_DATA,
    });
    assert.equal(postCount, 2);
    assert.equal(result.linkedin.url, 'https://www.linkedin.com/in/jane-doe/');
    assert.equal(result.emails[0].value, 'jane@janedoe.example');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: does not retry when the first attempt already verifies identity', async () => {
  const { analyzeProfileWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  globalThis.fetch = async () => {
    postCount++;
    return { ok: true, status: 200, json: async () => exaRunResponse(VERIFIED_IDENTITY_AND_CONTACT) };
  };

  try {
    await analyzeProfileWithExa('exa-test-key', {
      upworkProfileUrl: 'https://www.upwork.com/freelancers/test',
      profileData: PROFILE_DATA,
    });
    assert.equal(postCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: keeps the first not-verified result when the retry attempt itself throws', async () => {
  const { analyzeProfileWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let postCount = 0;

  globalThis.fetch = async () => {
    postCount++;
    if (postCount === 1) return { ok: true, status: 200, json: async () => exaRunResponse(NOT_FOUND_IDENTITY) };
    return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
  };

  try {
    const result = await analyzeProfileWithExa('exa-test-key', {
      upworkProfileUrl: 'https://www.upwork.com/freelancers/test',
      profileData: PROFILE_DATA,
    });
    assert.equal(postCount, 2);
    assert.equal(result.linkedin.url, null);
    assert.equal(result.emails, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: rejects incomplete profile data before spending a run', async () => {
  const { analyzeProfileWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      analyzeProfileWithExa('exa-test-key', {
        upworkProfileUrl: 'https://www.upwork.com/freelancers/test',
        profileData: { identity: { display_name: 'Jane D.' } },
      }),
      /freelancer data is incomplete/i
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Exa: rejects when apiKey is missing before making any request', async () => {
  const { analyzeProfileWithExa } = await loadAnalyzer();
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('fetch should not run');
  };

  try {
    await assert.rejects(
      analyzeProfileWithExa('', { upworkProfileUrl: 'https://www.upwork.com/freelancers/test', profileData: PROFILE_DATA }),
      /Exa API key is not configured/
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
