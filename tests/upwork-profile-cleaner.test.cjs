const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanUpworkProfileData } = require('../src/content-scripts/upwork-profile-cleaner.js');

test('keeps strong identity signals and removes noisy raw modal content', () => {
  const rawText = [
    'BackView full profileBackStatus: Offline',
    'Proposals have a new lookFeatures33% CompletePaginationBack1/3Current page 1 of 3',
    'About About Jane D.$20.00/hrRateEnglish: Fluent',
    'Marketplace specialist who grew Rare Brand Alpha.',
    'Work historyWork history on Upwork',
    'A very long generated summary and repeated job descriptions.',
    'PortfolioPortfolio (2)',
    'Rare Brand Alpha — Marketplace launch',
    'This skill is relevant to your search.',
    'Project Beta — $130,000 in 28 Days',
    'Employment historyEmployment historyAgency ZApril 2022 - Present',
    'SkillsSkillsMarketplace MarketingThis skill is relevant to your search.',
    'EducationExample Business SchoolBusiness management | 2024-2026',
    'View full profile',
  ].join('');

  const result = cleanUpworkProfileData({
    rawText,
    identity: {
      displayName: 'Jane D.',
      headline: 'Marketplace specialist',
      location: 'Example City, Pakistan',
    },
    skills: ['Marketplace Marketing', 'Next skills. Update list'],
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.identity.display_name, 'Jane D.');
  assert.match(result.portfolio, /Rare Brand Alpha/);
  assert.match(result.portfolio, /\$130,000 in 28 Days/);
  assert.match(result.education, /Example Business School/);
  assert.deepEqual(result.skills, ['Marketplace Marketing']);
  assert.doesNotMatch(serialized, /Proposals have a new look|PaginationBack|generated summary/);
});

test('uses structured sections and keeps only compact work-history titles', () => {
  const result = cleanUpworkProfileData({
    rawText: '',
    structuredLines: [
      'About',
      'Specialist for uncommon commerce projects.',
      'Work history',
      'TikTok Shop Monthly Management Rating is 5.0 out of 5.0',
      '$27,795.00 Fixed price',
      'Jan 25, 2025 - Aug 23, 2026',
      'Job description: repeated details',
      'Portfolio (1)',
      'Rare Portfolio Project',
      'Employment history',
      'Agency Z',
      'April 2022 - Present',
      'Skills',
      'TikTok Marketing',
      'Education',
      'Example Business School',
    ],
    identity: { displayName: 'Jane D.' },
    skills: ['TikTok Marketing'],
  });

  assert.deepEqual(result.work_history_titles, ['TikTok Shop Monthly Management']);
  assert.equal(result.portfolio, 'Rare Portfolio Project');
  assert.equal(result.employment_history, 'Agency Z | April 2022 - Present');
  assert.equal(result.education, 'Example Business School');
});
