// Registry mô tả các platform được hỗ trợ — nguồn sự thật duy nhất cho
// popup (hiển thị UI đúng platform) và background (định tuyến crawl/lưu lead).
// Thêm platform mới: thêm 1 entry ở đây + 1 content script tương ứng.
export const PLATFORMS = {
  linkedin: {
    key: 'linkedin',
    label: 'LinkedIn',
    hostSuffix: 'linkedin.com',
    crawlMode: 'dom',
    implemented: true,
    // Xác nhận thật từ HTML mẫu user gửi (2026-09-22) — không phải đoán.
    searchUrlTemplate: 'https://www.linkedin.com/search/results/content/?keywords={q}&sortBy=%5B%22date_posted%22%5D',
  },
  upwork: {
    key: 'upwork',
    label: 'Upwork',
    hostSuffix: 'upwork.com',
    crawlMode: 'dom',
    implemented: true,
    // Xác nhận thật từ URL user gửi (2026-09-23) — search TALENT (freelancer), không phải
    // job — thay thế searchUrlTemplate job search cũ. Badge filter (rising_talent/
    // top_rated_plus/top_rated_status) cố định trong URL, không cho user tắt.
    searchUrlTemplate:
      'https://www.upwork.com/nx/search/talent?pt={pt}&q={q}&rising_talent=yes&top_rated_plus=yes&top_rated_status=top_rated&page=1',
    // Param `loc` xác nhận thật (2026-09-23) từ URL user gửi: ?loc=united-states. Slug suy ra
    // bằng kebab-case tên location user nhập — mới verify đúng cho "United States", chưa
    // verify cho location khác (region/subregion...).
    supportsLocation: true,
    // Param `pt` xác nhận thật (2026-09-24) từ 2 URL user gửi: pt=independent (freelancer) vs
    // pt=agency. Mặc định freelancer. Flow crawl/AI-analyze cho case agency CHƯA định nghĩa —
    // chỉ mới wiring UI + URL, xem TODO cuối CLAUDE.md.
    supportsAccountType: true,
    // Talent search đã đủ chính xác qua searchQuery + badge filter — không cần lọc
    // keywords/excludeKeywords sau crawl nữa (quyết định 2026-09-23, bỏ luôn UI 2 ô này cho Upwork).
    noKeywordFilter: true,
    // User tự gõ thẳng câu search (vd "media ads"), không cần AI diễn giải mô tả tự nhiên nữa
    // (quyết định 2026-09-23) — bỏ bước "Analyze with AI", search-query hiện ngay để gõ + search luôn.
    directSearch: true,
    // Có bước mở modal + gọi AI phân tích contact info công khai cho từng freelancer (2026-09-23,
    // chạy lâu vì tuần tự qua nhiều trang pagination) — bật ô "Max leads to crawl" trong popup để
    // giới hạn số lead crawl (mặc định 50, xem readMaxLeads() trong popup.js).
    deepAnalyze: true,
  },
  fiverr: {
    key: 'fiverr',
    label: 'Fiverr',
    hostSuffix: 'fiverr.com',
    crawlMode: 'dom',
    // URL + selector search-list + selector gig detail đã xác nhận thật, orchestration (popup.js
    // crawlFiverrSellers()) đã nối xong (2026-09-24) — xem TODO cuối CLAUDE.md cho phần còn thiếu
    // (bước AI phân tích contact, chưa viết ai/fiverr-analyzer.js).
    implemented: true,
    // Xác nhận thật từ URL user gửi (2026-09-24): search_in=category&sub_category={id}
    // (&nested_sub_category={id} nếu có) khi chọn category cụ thể, search_in=everywhere khi All
    // Categories. `ref` luôn có seller_level:top_rated_seller (mặc định bắt buộc, không cho tắt,
    // user xác nhận) + leaf_category:{sub_category} nếu có chọn category + seller_location:{CC}
    // nếu có chọn country, nối bằng "|" rồi encode nguyên cụm (buildFiverrSearchUrl bên dưới).
    // Best Selling trên UI Fiverr được URL mẫu xác nhận bằng cặp
    // `source=sorting_by&filter=rating`; đây là sort mặc định bắt buộc cho Hunt-Ex.
    // Chỉ giữ `source` này, còn các param autocomplete-tracking (acmpl/search-autocomplete-*/
    // ref_ctx_id) vẫn bị loại vì chỉ là state của UI gợi ý lúc user gõ/click.
    searchUrlTemplate: 'https://www.fiverr.com/search/gigs?query={q}&source=sorting_by&filter=rating',
    // Dropdown chọn 1 category (mặc định "All Categories" = không truyền sub_category), dùng
    // FIVERR_CATEGORIES bên dưới. KHÔNG dùng chung `location-section` (input tự do, kiểu Upwork) —
    // Fiverr cần đúng country code cố định trong FIVERR_COUNTRIES nên có dropdown riêng, xem popup.js.
    supportsCategory: true,
    // "Số freelancer muốn cào" user yêu cầu — dùng lại UI "Max leads to crawl" có sẵn (trước đây
    // chỉ bật cho deepAnalyze/Upwork), KHÔNG phải deepAnalyze (Fiverr chưa có bước AI phân tích
    // profile). Crawl logic chưa đọc field này (content script còn là stub).
    supportsResultLimit: true,
    // Theo đúng flow user mô tả (mở UI -> gõ thẳng search + chọn filter -> cào), không nhắc gì tới
    // bước "mô tả khách hàng -> AI phân tích" — giả định giống quyết định 2026-09-23 của Upwork
    // (directSearch, bỏ bước AI intent). CHƯA hỏi lại user, có thể sai — sửa nếu user muốn khác.
    directSearch: true,
    noKeywordFilter: true,
  },
};

// Danh sách category Fiverr cho dropdown filter — lấy nguyên từ HTML dropdown "search_in=category"
// user gửi (2026-09-24, ngữ cảnh gõ "media ads"). value = sub_category, hoặc "sub_category:
// nested_sub_category" cho category con (xem buildFiverrSearchUrl). LƯU Ý: đây là snapshot 1 lần
// suggest theo đúng câu query đó — Fiverr có thể gợi ý category khác cho câu search khác, nhưng
// sub_category id là id thật cố định trong hệ category Fiverr nên vẫn hoạt động đúng dù query đổi.
export const FIVERR_CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: '149', label: 'Social Media Design' },
  { value: '149:2361', label: 'Social Posts & Banners Design' },
  { value: '67', label: 'Social Media Marketing' },
  { value: '549', label: 'UGC Videos' },
  { value: '67:2063', label: 'Social Media Management' },
  { value: '329', label: 'Video Ads & Commercials' },
  { value: '549:2852', label: 'Human UGC' },
  { value: '67:2688', label: 'Paid Social Media' },
  { value: '99', label: 'Video Editing' },
  { value: '482', label: 'Social Media Videos' },
];

// Danh sách country cho dropdown "Seller lives in" — lấy nguyên từ HTML checkbox list user gửi
// (2026-09-24, cùng ngữ cảnh "media ads"). Cùng lưu ý snapshot như FIVERR_CATEGORIES: đây không
// chắc là toàn bộ danh sách quốc gia Fiverr hỗ trợ lọc, chỉ là các nước có seller khớp query lúc đó.
export const FIVERR_COUNTRIES = [
  { value: '', label: 'Any location' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'BD', label: 'Bangladesh' },
  { value: 'BA', label: 'Bosnia and Herzegovina' },
  { value: 'BR', label: 'Brazil' },
  { value: 'BG', label: 'Bulgaria' },
  { value: 'CL', label: 'Chile' },
  { value: 'CY', label: 'Cyprus' },
  { value: 'FR', label: 'France' },
  { value: 'IN', label: 'India' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'IT', label: 'Italy' },
  { value: 'XK', label: 'Kosovo' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'PK', label: 'Pakistan' },
  { value: 'PT', label: 'Portugal' },
  { value: 'LK', label: 'Sri Lanka' },
  { value: 'TR', label: 'Turkey' },
  { value: 'UA', label: 'Ukraine' },
];

export function detectPlatformFromUrl(url) {
  if (!url) return null;
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  return (
    Object.values(PLATFORMS).find(
      (p) => hostname === p.hostSuffix || hostname.endsWith(`.${p.hostSuffix}`)
    ) || null
  );
}

export function buildSearchUrl(platform, query, location, accountType, category) {
  if (!platform.searchUrlTemplate) {
    throw new Error(
      `Search not configured for ${platform.label} yet — need a real search-results URL (search on ${platform.label} yourself and send the URL).`
    );
  }
  let url = platform.searchUrlTemplate.replace('{q}', encodeURIComponent(query));
  if (platform.supportsAccountType) {
    url = url.replace('{pt}', accountType === 'agency' ? 'agency' : 'independent');
  }
  if (platform.supportsCategory) return buildFiverrSearchUrl(url, category, location);
  const slug = platform.supportsLocation && location ? slugify(location) : '';
  if (slug) url += `&loc=${encodeURIComponent(slug)}`;
  return url;
}

// `category` = '' (All Categories) hoặc "sub_category" hoặc "sub_category:nested_sub_category"
// (xem FIVERR_CATEGORIES). `countryCode` = '' (Any location) hoặc ISO code (xem FIVERR_COUNTRIES).
// top_rated_seller luôn có trong `ref`, không phụ thuộc category/location — user xác nhận đây là
// mặc định bắt buộc cho mọi search Fiverr của Hunt-Ex. Best Selling đã có sẵn trong
// `baseUrl` qua `source=sorting_by&filter=rating`.
function buildFiverrSearchUrl(baseUrl, category, countryCode) {
  const [subCategory, nestedSubCategory] = (category || '').split(':').filter(Boolean);
  let url = `${baseUrl}&search_in=${subCategory ? 'category' : 'everywhere'}`;
  if (subCategory) url += `&sub_category=${encodeURIComponent(subCategory)}`;
  if (nestedSubCategory) url += `&nested_sub_category=${encodeURIComponent(nestedSubCategory)}`;
  const refParts = [];
  if (subCategory) refParts.push(`leaf_category:${subCategory}`);
  refParts.push('seller_level:top_rated_seller');
  if (countryCode) refParts.push(`seller_location:${countryCode}`);
  return `${url}&ref=${encodeURIComponent(refParts.join('|'))}`;
}

function slugify(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
