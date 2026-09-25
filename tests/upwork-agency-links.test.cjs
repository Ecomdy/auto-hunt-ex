const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAgencyLogoSrc, collectAgencies } = require('../src/content-scripts/upwork-agency-links.js');

// Số + domaine từ HTML thật user gửi (2026-09-24): org-logo id đã xác nhận trùng agencyId của
// `/agencies/{id}/` bằng cách mở thẳng URL.
const REAL_LOGO_SRC = 'https://assets.static-upwork.com/org-logo/453779030966628352';
const SEARCH_PAGE_URL = 'https://www.upwork.com/nx/search/talent?pt=agency&q=media%20ads';

test('parseAgencyLogoSrc extracts the numeric id and builds the agency URL on the PAGE origin (not the CDN origin)', () => {
  const result = parseAgencyLogoSrc(REAL_LOGO_SRC, SEARCH_PAGE_URL);
  assert.deepEqual(result, {
    agencyId: '453779030966628352',
    upworkUrl: 'https://www.upwork.com/agencies/453779030966628352/',
  });
});

test('parseAgencyLogoSrc returns null for images that are not an org logo', () => {
  assert.equal(parseAgencyLogoSrc('https://assets.static-upwork.com/avatar/123', SEARCH_PAGE_URL), null);
  assert.equal(parseAgencyLogoSrc(null, SEARCH_PAGE_URL), null);
});

test('collectAgencies dedupes repeated agency logos by agencyId, using alt as the agency name', () => {
  const images = [
    { src: REAL_LOGO_SRC, alt: 'PRO Digital Experts' },
    { src: `${REAL_LOGO_SRC}?size=40`, alt: 'PRO Digital Experts' }, // même agency, card khác
    { src: 'https://assets.static-upwork.com/org-logo/111111111111111111', alt: 'Other Agency' },
    { src: 'https://assets.static-upwork.com/avatar/999', alt: 'Some freelancer avatar' },
  ];

  const agencies = collectAgencies(images, SEARCH_PAGE_URL);

  assert.equal(agencies.size, 2);
  assert.deepEqual(agencies.get('453779030966628352'), {
    agencyId: '453779030966628352',
    agencyName: 'PRO Digital Experts',
    upworkUrl: 'https://www.upwork.com/agencies/453779030966628352/',
  });
  assert.ok(agencies.has('111111111111111111'));
});
