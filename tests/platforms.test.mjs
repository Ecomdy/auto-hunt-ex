import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, buildSearchUrl } from '../src/shared/platforms.js';

test('buildSearchUrl defaults Upwork to pt=independent and switches to pt=agency', () => {
  const defaultUrl = buildSearchUrl(PLATFORMS.upwork, 'media ads');
  assert.match(defaultUrl, /pt=independent/);

  const agencyUrl = buildSearchUrl(PLATFORMS.upwork, 'media ads', '', 'agency');
  assert.match(agencyUrl, /pt=agency/);
});

test('buildSearchUrl leaves other platforms unaffected by accountType', () => {
  const url = buildSearchUrl(PLATFORMS.linkedin, 'media ads', '', 'agency');
  assert.doesNotMatch(url, /pt=/);
});

test('buildSearchUrl for Fiverr defaults to Best Selling + everywhere + top_rated_seller', () => {
  const url = buildSearchUrl(PLATFORMS.fiverr, 'media ads');
  assert.match(url, /source=sorting_by/);
  assert.match(url, /filter=rating/);
  assert.match(url, /search_in=everywhere/);
  assert.doesNotMatch(url, /sub_category=/);
  assert.match(url, /ref=seller_level%3Atop_rated_seller/);
});

test('buildSearchUrl for Fiverr applies category, nested category, and location', () => {
  const withCategory = buildSearchUrl(PLATFORMS.fiverr, 'media ads', '', '', '149');
  assert.match(withCategory, /source=sorting_by&filter=rating/);
  assert.match(withCategory, /search_in=category&sub_category=149/);
  assert.doesNotMatch(withCategory, /nested_sub_category/);
  assert.match(withCategory, /ref=leaf_category%3A149%7Cseller_level%3Atop_rated_seller/);

  const nested = buildSearchUrl(PLATFORMS.fiverr, 'media ads', '', '', '67:2063');
  assert.match(nested, /sub_category=67&nested_sub_category=2063/);

  const withLocation = buildSearchUrl(PLATFORMS.fiverr, 'media ads', 'BR', '', '149');
  assert.match(
    withLocation,
    /ref=leaf_category%3A149%7Cseller_level%3Atop_rated_seller%7Cseller_location%3ABR/
  );
});
