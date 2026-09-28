import { PLATFORMS, detectPlatformFromUrl, buildSearchUrl, FIVERR_CATEGORIES, FIVERR_COUNTRIES } from '../shared/platforms.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

let currentPlatform = null;
let activeCrawlTabId = null;
// Freelancer crawl: vòng lặp nằm TRONG content script (1 message START_CRAWL/1 response), Stop
// đi qua STOP_CRAWL gửi thẳng activeCrawlTabId. Agency crawl (crawlAgencies() dưới) khác hẳn: vòng
// lặp nằm ở ĐÂY (panel), vì phải điều hướng 1 tab riêng qua nhiều agency detail page tuần tự — panel
// không thể "gửi 1 message rồi chờ" như freelancer, nên cần cờ dừng riêng kiểm tra giữa mỗi agency.
let agencyCrawlStopRequested = false;

// Gate lúc mới mở panel (2026-09-25): trước đây extension đã có sẵn OpenAI key qua .env/config.js
// (người build nạp sẵn), giờ marketing team tự nhập key qua UI (không tự thêm .env được) nên phải
// chặn home-view lại cho tới khi có key hợp lệ đã lưu — xem GET_API_KEY_STATUS trong background.js.
// `provider` (2026-09-28, thêm Exa.ai làm lựa chọn khác cho phần research) chọn sẵn đúng radio +
// hiện đúng ô input tương ứng, khớp research provider background.js báo về (mặc định 'openai').
function setApiKeyProviderView(provider) {
  document.querySelector(`input[name="apikey-provider"][value="${provider}"]`).checked = true;
  $('openai-key-fields').hidden = provider !== 'openai';
  $('exa-key-fields').hidden = provider !== 'exa';
}

document.querySelectorAll('input[name="apikey-provider"]').forEach((radio) => {
  radio.addEventListener('change', (e) => setApiKeyProviderView(e.target.value));
});

function showApiKeyGate(provider = 'openai') {
  currentPlatform = null;
  setApiKeyProviderView(provider);
  $('apikey-view').hidden = false;
  $('home-view').hidden = true;
  $('platform-view').hidden = true;
  $('leads-section').hidden = true;
}

function showHome() {
  currentPlatform = null;
  $('apikey-view').hidden = true;
  $('home-view').hidden = false;
  $('platform-view').hidden = true;
  $('leads-section').hidden = false;
  showStatus('');
}

function enterPlatformView(platformKey) {
  currentPlatform = PLATFORMS[platformKey];
  $('home-view').hidden = true;
  $('platform-view').hidden = false;
  $('platform-view-title').textContent = currentPlatform.implemented
    ? `Finding leads on: ${currentPlatform.label}`
    : `${currentPlatform.label} — crawling not supported yet (in development)`;
  $('description').value = '';
  $('analyze-section').hidden = Boolean(currentPlatform.directSearch);
  $('search-query').value = '';
  $('keywords-section').hidden = !currentPlatform.directSearch;
  $('relevance-filter-section').hidden = Boolean(currentPlatform.noKeywordFilter);
  $('location-section').hidden = !currentPlatform.supportsLocation;
  $('location').value = '';
  $('fiverr-filters-section').hidden = !currentPlatform.supportsCategory;
  $('fiverr-category').value = '';
  $('fiverr-location').value = '';
  $('account-type-section').hidden = !currentPlatform.supportsAccountType;
  $('platform-view').querySelector('input[name="account-type"][value="independent"]').checked = true;
  updateMaxLeadsLabel();
  // deepAnalyze (Upwork, mở modal + AI chạy lâu) hoặc supportsResultLimit (Fiverr, user muốn giới
  // hạn số seller cào) đều cần ô "Max leads to crawl" — LinkedIn chưa cần (crawl 1 trang, chưa giới hạn).
  $('max-leads-section').hidden = !(currentPlatform.deepAnalyze || currentPlatform.supportsResultLimit);
  $('max-leads').value = '50';
  $('auto-hunt-btn').disabled = !currentPlatform.implemented;
  $('auto-hunt-btn').title = currentPlatform.implemented
    ? ''
    : `Auto-hunt not supported on ${currentPlatform.label} yet.`;
  showStatus('');
  refreshPlatformState();
}

function populateSelect(select, options) {
  select.innerHTML = '';
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    select.appendChild(el);
  }
}
populateSelect($('fiverr-category'), FIVERR_CATEGORIES);
populateSelect($('fiverr-location'), FIVERR_COUNTRIES);

document.querySelectorAll('.platform-btn').forEach((btn) => {
  btn.addEventListener('click', () => enterPlatformView(btn.dataset.platform));
});
$('back-btn').addEventListener('click', showHome);

function showStatus(msg, isError = true) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('status-success', !isError);
}

// Nhận tiến độ live từ content script (upwork.js) trong lúc mở modal + phân tích AI từng
// freelancer — bước này chạy tuần tự và có thể mất vài phút, không có progress thì trông như treo.
// chrome.runtime.sendMessage() broadcast TOÀN EXTENSION, không giới hạn theo tab/cửa sổ — nếu chạy
// song song 2 cửa sổ (2 instance popup.js khác nhau, xem comment đầu file), CẢ HAI panel đều nhận
// được CRAWL_PROGRESS của CẢ HAI crawl, chồng lẫn lộn lên `#status` của nhau (bug thật user báo cáo
// lúc chạy live 2 cửa sổ, 2026-09-25). Lọc bằng `sender.tab.id === activeCrawlTabId` — biến này
// chính là tab mà CỬA SỔ NÀY đang tự theo dõi — để mỗi panel chỉ hiện progress của crawl do chính
// nó khởi động, bỏ qua progress phát ra từ tab thuộc crawl của cửa sổ khác.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'CRAWL_PROGRESS' && sender.tab?.id === activeCrawlTabId) {
    showStatus(`[${message.current}/${message.total}] ${message.message}`, false);
  }
});

// Nhiều cửa sổ có thể chạy song song, mỗi cửa sổ 1 instance popup.js riêng — trước đây
// refreshLeads() chỉ chạy khi CHÍNH cửa sổ này tự crawl xong/dừng/xoá/mở panel, nên khi cửa sổ
// khác lưu lead xong, cửa sổ này vẫn hiện dữ liệu cũ (nhóm platform kia trông như "vẫn rỗng") cho
// tới lần refresh kế tiếp của riêng nó — không phải bug ẩn/hiện, chỉ là snapshot cũ (bug thật user
// báo cáo, 2026-09-25). chrome.storage.onChanged bắn ở MỌI context (kể cả side panel cửa sổ khác)
// mỗi khi storage.session đổi — dùng để tự đồng bộ list real-time giữa các cửa sổ. Lọc đúng key
// `huntex_leads` (STORAGE_KEY trong local-lead-repository.js) để không refetch vô ích mỗi khi
// profile-research-cache.js ghi cache (cũng dùng chung storage.session, key khác).
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && changes.huntex_leads) refreshLeads();
});

function setLoading(btn, loading, loadingLabel) {
  if (loading) {
    btn.dataset.originalLabel = btn.textContent;
    btn.textContent = loadingLabel;
    btn.disabled = true;
    btn.classList.add('is-loading');
  } else {
    btn.textContent = btn.dataset.originalLabel || btn.textContent;
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

function sendToBackground(message) {
  return chrome.runtime.sendMessage(message).then((res) => {
    if (!res?.ok) throw new Error(res?.error || 'Unknown error');
    return res.result;
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Chỉ gate nút "crawl thủ công" (nút phụ) — auto-hunt tự mở tab riêng nên không phụ thuộc
// tab đang active, KHÔNG cần cảnh báo ở cấp toàn panel (trước đây để badge to ở header,
// gây hiểu lầm "extension lỗi" khi user chuyển tab làm việc khác trong lúc auto-hunt chạy nền).
// Nút chỉ bật khi tab đang active TRÙNG với platform đang chọn trong panel (không phải bất
// kỳ platform nào đã implement) — tránh crawl nhầm platform khác platform đang xem trong UI.
function updateCrawlAvailability(activeTabPlatform) {
  if (!currentPlatform) return; // đang ở home view, không có nút crawl-btn để cập nhật
  const btn = $('crawl-btn');
  const hint = $('crawl-hint');
  const supported = Boolean(
    activeTabPlatform && activeTabPlatform.implemented && activeTabPlatform.key === currentPlatform.key
  );
  btn.disabled = !supported;
  hint.textContent = supported ? '' : `Open a ${currentPlatform.label} tab to use this button.`;
}

async function refreshPlatformState() {
  const tab = await getActiveTab();
  const platform = detectPlatformFromUrl(tab?.url);
  updateCrawlAvailability(platform);
  return platform;
}

// Side panel không đóng khi chuyển tab (khác popup cũ) — phải tự cập nhật trạng thái nút
// mỗi khi user chuyển sang tab khác, chứ không chỉ tính 1 lần lúc panel mở.
chrome.tabs.onActivated.addListener(() => refreshPlatformState());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) refreshPlatformState();
});

function appendTextField(dl, label, text) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = text;
  dl.append(dt, dd);
}

function appendLinkField(dl, label, url) {
  if (!url) return;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = url;
  dd.appendChild(a);
  dl.append(dt, dd);
}

// items: mảng {value, type?, purpose?, platform?} (emails/phones/other_contacts trong OUTPUT_SCHEMA).
function appendContactFields(dl, label, items, hrefFor) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item?.value) continue;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    const a = document.createElement('a');
    a.href = hrefFor(item.value);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.value;
    dd.appendChild(a);
    const tags = [item.platform, item.type, item.purpose].filter(Boolean);
    if (tags.length) {
      const tag = document.createElement('span');
      tag.className = 'contact-tag';
      tag.textContent = tags.join(' · ');
      dd.appendChild(tag);
    }
    dl.append(dt, dd);
  }
}

// Lead có analysis (deepAnalyze — Upwork/Agency/Fiverr, cùng OUTPUT_SCHEMA): render thành 1 <details>
// collapse được (native, không cần JS toggle riêng) thay vì dump nguyên JSON — summary tóm tắt
// tên/loại/số contact tìm được, mở ra mới thấy chi tiết từng field.
function buildAnalysisCard(analysis) {
  const details = document.createElement('details');
  details.className = 'analysis-card';

  const summary = document.createElement('summary');
  const content = document.createElement('span');
  content.className = 'analysis-summary-content';

  const name = document.createElement('span');
  name.className = 'analysis-name';
  name.textContent = analysis.name || '(unknown name)';
  content.appendChild(name);

  const badgeText = [analysis.source, analysis.type].filter(Boolean).join(' · ');
  if (badgeText) {
    const badge = document.createElement('span');
    badge.className = 'analysis-badge';
    badge.textContent = badgeText;
    content.appendChild(badge);
  }

  // Bug thật gặp lúc chạy live (2026-09-25): lead chỉ tìm được LinkedIn (không email/phone/other)
  // vẫn bị gắn nhãn "No public contact found" vì count cũ bỏ sót linkedin.url/website.url — 2 field
  // này cũng là kết quả research thật sự tìm được, không kém giá trị hơn email/phone.
  const contactCount =
    (analysis.emails?.length || 0) +
    (analysis.phones?.length || 0) +
    (analysis.other_contacts?.length || 0) +
    (analysis.linkedin?.url ? 1 : 0) +
    (analysis.website?.url ? 1 : 0);
  const count = document.createElement('span');
  count.className = 'analysis-contact-count';
  count.textContent = contactCount
    ? `${contactCount} contact${contactCount > 1 ? 's' : ''} found`
    : 'No public contact found';
  content.appendChild(count);

  summary.appendChild(content);
  details.appendChild(summary);

  const dl = document.createElement('dl');
  dl.className = 'analysis-fields';
  // analysis.location là object {city, state_region, country} (xem normalizeResearchResult() ở
  // agency/fiverr-analyzer.js, parseLocation() ở profile-analyzer.js) — gán thẳng object vào
  // .textContent bị JS tự convert thành chuỗi "[object Object]" (bug thật gặp lúc chạy live,
  // 2026-09-25). Join phần nào có giá trị (agency/fiverr hiện chỉ có country, freelancer Upwork có
  // thể có đủ cả 3) thành 1 chuỗi hiển thị được.
  const locationText = [analysis.location?.city, analysis.location?.state_region, analysis.location?.country]
    .filter(Boolean)
    .join(', ');
  // headline (2026-09-25, theo yêu cầu user): title nghề thô cào trực tiếp từ profile/gig/agency
  // detail page (vd "Google Ads Partner Agency Owner") — deterministic, không qua AI, xem
  // buildFinalResult()/analyzeAgency()/analyzeFiverrSeller() ở 3 file ai/*-analyzer.js.
  if (analysis.headline) appendTextField(dl, 'Headline', analysis.headline);
  if (locationText) appendTextField(dl, 'Location', locationText);
  appendLinkField(dl, 'Website', analysis.website?.url);
  appendLinkField(dl, 'LinkedIn', analysis.linkedin?.url);
  appendContactFields(dl, 'Email', analysis.emails, (v) => `mailto:${v}`);
  appendContactFields(dl, 'Phone', analysis.phones, (v) => `tel:${v}`);
  appendContactFields(dl, 'Other', analysis.other_contacts, (v) => v);
  appendLinkField(dl, 'Profile', analysis.upwork_profile_url || analysis.fiverr_profile_url);
  details.appendChild(dl);

  // Nút xem JSON gốc — góc dưới bên phải mỗi card, chỉ hiện khi user tự mở collapse (yêu cầu
  // 2026-09-25, để đối chiếu nhanh field nào model thật sự trả về so với card đã format gọn).
  const rawToggle = document.createElement('button');
  rawToggle.type = 'button';
  rawToggle.className = 'btn btn-ghost analysis-raw-toggle';
  rawToggle.textContent = 'View raw JSON';
  const rawPre = document.createElement('pre');
  rawPre.className = 'analysis-output';
  rawPre.hidden = true;
  rawPre.textContent = JSON.stringify(analysis, null, 2);
  rawToggle.addEventListener('click', () => {
    rawPre.hidden = !rawPre.hidden;
    rawToggle.textContent = rawPre.hidden ? 'View raw JSON' : 'Hide raw JSON';
  });
  details.append(rawToggle, rawPre);

  return details;
}

function buildLeadItem(lead) {
  const li = document.createElement('li');

  // Lead đã có analysis (deepAnalyze — Upwork/Agency/Fiverr): render collapse card thay vì JSON thô —
  // không kèm link profile riêng vì thông tin đã nằm trong card (field "Profile").
  // Lead KHÔNG có analysis (LinkedIn, hoặc analysis lỗi): vẫn cần link để tự mở xem profile.
  if (lead.analysis) {
    li.appendChild(buildAnalysisCard(lead.analysis));
  } else {
    const a = document.createElement('a');
    a.href = lead.url;
    a.target = '_blank';
    a.textContent = `[${lead.platform}] ${lead.title}`;
    li.appendChild(a);

    if (lead.analysisError) {
      const p = document.createElement('p');
      p.className = 'analysis-output analysis-output-error';
      p.textContent = `Analysis failed: ${lead.analysisError}`;
      li.appendChild(p);
    }
  }

  if (lead.closeError) {
    const p = document.createElement('p');
    p.className = 'analysis-output analysis-output-error';
    p.textContent = `Crawl stopped: ${lead.closeError}`;
    li.appendChild(p);
  }

  return li;
}

// Tách list hiển thị theo 4 nhóm (2026-09-25, theo yêu cầu user — chạy song song nhiều case ở
// nhiều cửa sổ nên cần phân biệt kết quả nhóm nào ra nhóm đó cho demo, thay vì 1 list chung lẫn
// lộn). `platform` KHÔNG đủ để tách Upwork Freelancer/Agency (cả 2 đều ghi platform: 'upwork') —
// chỉ `lead.analysis.type` mới phân biệt được, và field này chỉ tồn tại khi phân tích AI thành
// công. Lead Upwork bị lỗi phân tích (analysisError, không có lead.analysis) mặc định rơi vào
// nhóm Freelancer (quyết định của user — không tách riêng nhóm "lỗi/chưa xác định").
function leadCategoryKey(lead) {
  if (lead.platform === 'linkedin') return 'linkedin';
  if (lead.platform === 'fiverr') return 'fiverr';
  if (lead.platform === 'upwork') return lead.analysis?.type === 'agency' ? 'upwork-agency' : 'upwork-freelancer';
  return null;
}

const LEAD_GROUP_KEYS = ['linkedin', 'upwork-freelancer', 'upwork-agency', 'fiverr'];

async function refreshLeads() {
  const leads = await sendToBackground({ type: 'GET_LEADS' });
  $('leads-count').textContent = `${leads.length} leads saved`;

  const byGroup = { linkedin: [], 'upwork-freelancer': [], 'upwork-agency': [], fiverr: [] };
  for (const lead of leads) {
    const key = leadCategoryKey(lead);
    if (key) byGroup[key].push(lead);
  }

  for (const key of LEAD_GROUP_KEYS) {
    const groupLeads = byGroup[key];
    $(`leads-count-${key}`).textContent = `${groupLeads.length}`;
    const list = $(`leads-list-${key}`);
    list.innerHTML = '';
    for (const lead of groupLeads.slice(-20).reverse()) {
      list.appendChild(buildLeadItem(lead));
    }
    // Ẩn hẳn nhóm rỗng (2026-09-25, theo yêu cầu user — trước đó luôn hiện cả 4 nhóm kèm "No leads
    // yet." cho demo, nhưng lúc chưa crawl gì hoặc chỉ chạy 1-2 platform thì nhìn rối vì nhiều label
    // rỗng). Chỉ nhóm có ít nhất 1 lead mới hiện label + list.
    list.closest('.lead-group').hidden = groupLeads.length === 0;
  }

  return leads;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cùng lý do với humanDelay() bên upwork.js (freelancer flow): agency crawl không có link để
// "click" (điều hướng thẳng bằng chrome.tabs.update, xem crawlAgencies()) — delay ngẫu nhiên giữa
// các lần điều hướng để tránh pattern request đều đặn/tức thời trông như bot.
function humanDelay(minMs, maxMs) {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

// Lead bị loại nếu: chứa 1 trong excludeKeywords, HOẶC (có khai báo keywords mà) không
// chứa bất kỳ keyword nào — "không liên quan thì bỏ". So khớp substring, không phân biệt hoa/thường.
function filterLeads(leads, keywords, excludeKeywords) {
  const incl = (keywords || []).map((k) => k.toLowerCase()).filter(Boolean);
  const excl = (excludeKeywords || []).map((k) => k.toLowerCase()).filter(Boolean);
  if (!incl.length && !excl.length) return leads;
  return leads.filter((lead) => {
    const text = `${lead.title} ${lead.snippet}`.toLowerCase();
    if (excl.some((k) => text.includes(k))) return false;
    if (incl.length && !incl.some((k) => text.includes(k))) return false;
    return true;
  });
}

// Chờ tab load xong (status "complete"). LinkedIn là SPA nên "complete" chưa chắc đã render
// xong nội dung — xem retry trong crawlWithRetry() để bù thêm thời gian render.
// Timeout ở đây là tín hiệu cấp browser (tab đã "complete" hay chưa) — xảy ra TRƯỚC khi content
// script của Hunt-Ex chạy bất kỳ selector nào, nên nếu gặp thì không phải bug DOM/selector mà là
// mạng chậm hoặc trang chặn tab tự động mở (không tương tác chuột/session trước đó, dễ bị coi là
// bot). Log kèm trạng thái tab thật lúc timeout (url/status) để biết ngay nguyên nhân mà không cần
// tự mở tab lên xem — vd url vẫn y hệt lúc mở (nghẽn mạng/bị treo) hay đã redirect sang chỗ khác.
function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      chrome.tabs.onUpdated.removeListener(listener);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      console.log('[Hunt-Ex] Tab load timeout — tab state at time of failure:', tab);
      reject(new Error(`Page took too long to load (>20s) — check the tab that just opened, you may need to log in to ${currentPlatform?.label || 'the site'} again.`));
    }, timeoutMs);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ponytail: retry cố định (không poll DOM thật) — đủ dùng vì LinkedIn thường render xong
// trong ~1-2 lần lặp. Nâng cấp sau nếu cần: poll DOM đến khi thấy card thay vì đoán số lần retry.
async function crawlWithRetry(tabId, keywords, limit, attempts = 4, delayMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'START_CRAWL', keywords, limit });
    if (!res?.ok) throw new Error(res?.error || 'Crawl failed');
    if (res.leads.length > 0 || i === attempts - 1) return res;
    await sleep(delayMs);
  }
  return { leads: [], warning: null };
}

async function autoHunt(url, keywords, excludeKeywords, limit) {
  const tab = await chrome.tabs.create({ url });
  activeCrawlTabId = tab.id;
  await waitForTabLoad(tab.id);
  const result = await crawlWithRetry(tab.id, keywords, limit);
  return { leads: filterLeads(result.leads, keywords, excludeKeywords), warning: result.warning };
}

function discoverAgenciesOnTab(tabId, limit) {
  return chrome.tabs.sendMessage(tabId, { type: 'DISCOVER_AGENCIES', limit }).then((res) => {
    if (!res?.ok) throw new Error(res?.error || 'Agency discovery failed');
    return res.agencies;
  });
}

// Cùng lý do retry với crawlWithRetry() (SPA render lag sau khi tab "load complete").
async function discoverAgenciesWithRetry(tabId, limit, attempts = 4, delayMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    const agencies = await discoverAgenciesOnTab(tabId, limit);
    if (agencies.length > 0 || i === attempts - 1) return agencies;
    await sleep(delayMs);
  }
  return [];
}

function extractAgencyDetail(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_AGENCY_DETAIL' }).then((res) => {
    if (!res?.ok) throw new Error(res?.error || 'Agency detail extraction failed');
    return res.detail;
  });
}

// Pipeline riêng cho case tick "Agency" — khác hẳn autoHunt() (freelancer):
// 1. Tab search (pt=agency) chỉ dùng để DISCOVER link "Associated with" agency (không click mở
//    modal ở đây) — dedupe theo agencyId, 1 agency có thể lặp lại ở nhiều freelancer trên list.
// 2. Mở THÊM 1 tab riêng (inactive) tái sử dụng cho MỌI agency — điều hướng tuần tự qua từng
//    agency detail page (`chrome.tabs.update`), không mở 1 tab/agency.
// 3. Mỗi agency: content script trích dữ liệu gọn (EXTRACT_AGENCY_DETAIL) -> gửi background phân
//    tích AI (ANALYZE_AGENCY, cùng chuẩn output với freelancer) -> lead.
// Vòng lặp chạy trong side panel (không phải background service worker) nên không lo bị suspend
// giữa chừng — side panel không tự đóng khi chuyển tab (xem CLAUDE.md).
// Bug thật gặp ở crawlFiverrSellers() (cùng khuôn code, 2026-09-25) áp dụng y hệt ở đây: crawlerTab
// tạo `active: false` bị Chrome throttle tab nền, "Page took too long to load" và dừng hẳn tiến
// trình nếu user không tự click focus vào tab. Bỏ `active: false` phòng ngừa trước khi user tự gặp
// (agency flow tại thời điểm này CHƯA verify live — xem TODO cuối CLAUDE.md).
async function crawlAgencies(searchUrl, limit) {
  const searchTab = await chrome.tabs.create({ url: searchUrl });
  activeCrawlTabId = searchTab.id;
  await waitForTabLoad(searchTab.id);
  showStatus('Scanning search results for agency links...', false);
  const agencies = await discoverAgenciesWithRetry(searchTab.id, limit);
  if (!agencies.length) return [];

  const crawlerTab = await chrome.tabs.create({ url: agencies[0].upworkUrl });
  await waitForTabLoad(crawlerTab.id); // bug đã sửa: bản trước thiếu chờ này cho agency ĐẦU TIÊN
  const leads = [];
  try {
    for (let i = 0; i < agencies.length; i++) {
      if (agencyCrawlStopRequested) break;
      const agency = agencies[i];
      const position = `${i + 1}/${agencies.length}`;

      if (i > 0) {
        await humanDelay(700, 1600); // "cân nhắc" trước khi sang agency kế, không nhảy URL tức thời
        await chrome.tabs.update(crawlerTab.id, { url: agency.upworkUrl });
        await waitForTabLoad(crawlerTab.id);
      }

      showStatus(`[${position}] Analyzing ${agency.agencyName || agency.agencyId}...`, false);
      const lead = {
        platform: 'upwork',
        title: agency.agencyName || agency.agencyId,
        url: agency.upworkUrl,
        snippet: '',
        postedAt: null,
        extractedAt: new Date().toISOString(),
      };
      try {
        const detail = await extractAgencyDetail(crawlerTab.id);
        lead.title = detail.upworkName || lead.title;
        lead.analysis = await sendToBackground({
          type: 'ANALYZE_AGENCY',
          upworkAgencyUrl: agency.upworkUrl,
          agencyData: detail,
          crawledAt: new Date().toISOString(),
        });
      } catch (err) {
        lead.analysisError = err.message || String(err);
      }
      leads.push(lead);
      await humanDelay(800, 1800); // nghỉ giữa 2 agency, cùng tinh thần humanDelay() bên content script
    }
  } finally {
    await chrome.tabs.remove(crawlerTab.id).catch(() => {});
  }
  return leads;
}

// Fiverr: cùng khuôn crawlAgencies() (1 crawler tab tái sử dụng, điều hướng tuần tự qua từng gig,
// mỗi gig gửi background phân tích AI ngay trong vòng lặp — 2026-09-25, ai/fiverr-analyzer.js).
// Bug thật gặp lúc chạy live (2026-09-25): crawlerTab tạo `active: false` (không lấy focus) khiến
// Chrome throttle mạnh tab nền (JS/network priority thấp hơn) — trang không kịp "complete" trong
// 20s, ném lỗi "Page took too long to load" và dừng hẳn tiến trình. User xác nhận: tự click focus
// vào tab đó thì crawl chạy bình thường — bằng chứng trực tiếp cho nguyên nhân throttle tab nền, xem
// waitForTabLoad(). Bỏ `active: false`: crawlerTab giữ nguyên foreground suốt vòng lặp (giống hệt
// searchTab phía trên, vốn đã mặc định active) — đánh đổi: tab này chiếm focus trình duyệt trong lúc
// crawl toàn bộ batch, nhưng đây là cách duy nhất chắc chắn không bị throttle.
async function crawlFiverrSellers(searchUrl, limit) {
  const searchTab = await chrome.tabs.create({ url: searchUrl });
  activeCrawlTabId = searchTab.id;
  await waitForTabLoad(searchTab.id);
  showStatus('Scanning Fiverr search results for sellers...', false);
  const discoverRes = await chrome.tabs.sendMessage(searchTab.id, { type: 'DISCOVER_FIVERR_SELLERS', limit });
  if (!discoverRes?.ok) throw new Error(discoverRes?.error || 'Fiverr seller discovery failed');
  const sellers = discoverRes.sellers;
  console.log('[Hunt-Ex] Fiverr sellers discovered:', sellers);
  if (!sellers.length) return [];

  const crawlerTab = await chrome.tabs.create({ url: sellers[0].gigUrl });
  await waitForTabLoad(crawlerTab.id);
  const leads = [];
  try {
    for (let i = 0; i < sellers.length; i++) {
      if (agencyCrawlStopRequested) break;
      const seller = sellers[i];
      const position = `${i + 1}/${sellers.length}`;

      if (i > 0) {
        await humanDelay(700, 1600);
        await chrome.tabs.update(crawlerTab.id, { url: seller.gigUrl });
        await waitForTabLoad(crawlerTab.id);
      }

      showStatus(`[${position}] Extracting ${seller.sellerName || seller.username}...`, false);
      const lead = {
        platform: 'fiverr',
        title: seller.sellerName || seller.username,
        url: seller.gigUrl,
        snippet: seller.gigTitle || '',
        postedAt: null,
        extractedAt: new Date().toISOString(),
      };
      try {
        const detailRes = await chrome.tabs.sendMessage(crawlerTab.id, { type: 'EXTRACT_FIVERR_DETAIL' });
        if (!detailRes?.ok) throw new Error(detailRes?.error || 'Fiverr gig detail extraction failed');
        console.log(`[Hunt-Ex] Fiverr detail [${position}]`, seller, detailRes.detail);
        lead.title = detailRes.detail.fiverrName || lead.title;
        lead.analysis = await sendToBackground({
          type: 'ANALYZE_FIVERR',
          fiverrGigUrl: seller.gigUrl,
          sellerData: { list: seller, detail: detailRes.detail },
          crawledAt: new Date().toISOString(),
        });
      } catch (err) {
        lead.analysisError = err.message || String(err);
        console.log(`[Hunt-Ex] Fiverr error [${position}]`, seller, lead.analysisError);
      }
      leads.push(lead);
      await humanDelay(800, 1800);
    }
  } finally {
    await chrome.tabs.remove(crawlerTab.id).catch(() => {});
  }
  return leads;
}

function toCsv(leads) {
  const cols = ['platform', 'title', 'url', 'snippet', 'postedAt', 'extractedAt'];
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(',')].concat(leads.map((l) => cols.map((c) => escape(l[c])).join(',')));
  return rows.join('\n');
}

function readKeywordsField(id) {
  if (currentPlatform?.noKeywordFilter) return [];
  return $(id).value.split(',').map((k) => k.trim()).filter(Boolean);
}

// undefined cho platform không có deep-analyze -> scrapeCurrentPage() không giới hạn (giữ nguyên
// hành vi cũ: lấy hết card trên trang). Input ẩn/không áp dụng thì không nên âm thầm áp limit.
function readAccountType() {
  return document.querySelector('input[name="account-type"]:checked')?.value || 'independent';
}

// "Max leads to crawl" (freelancer) vs "Max agencies to crawl" (agency) — cùng 1 input #max-leads,
// chỉ đổi nhãn cho rõ nghĩa khi user đổi lựa chọn.
function updateMaxLeadsLabel() {
  const label = document.querySelector('label[for="max-leads"]');
  if (label) label.textContent = readAccountType() === 'agency' ? 'Max agencies to crawl' : 'Max leads to crawl';
}
document.querySelectorAll('input[name="account-type"]').forEach((radio) => {
  radio.addEventListener('change', updateMaxLeadsLabel);
});

function readMaxLeads() {
  if (!currentPlatform?.deepAnalyze && !currentPlatform?.supportsResultLimit) return undefined;
  const raw = Number($('max-leads').value);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
}

$('analyze-btn').addEventListener('click', async () => {
  const description = $('description').value.trim();
  showStatus('');
  setLoading($('analyze-btn'), true, 'Analyzing...');
  try {
    const { searchQuery, keywords, excludeKeywords, notes } = await sendToBackground({
      type: 'ANALYZE_INTENT',
      description,
      platformLabel: currentPlatform?.label,
    });
    $('search-query').value = searchQuery;
    $('keywords').value = keywords.join(', ');
    $('exclude-keywords').value = excludeKeywords.join(', ');
    $('ai-notes').textContent = notes || '';
    $('keywords-section').hidden = false;
  } catch (err) {
    showStatus(err.message);
  } finally {
    setLoading($('analyze-btn'), false);
  }
});

$('stop-btn').addEventListener('click', () => {
  agencyCrawlStopRequested = true;
  if (activeCrawlTabId) chrome.tabs.sendMessage(activeCrawlTabId, { type: 'STOP_CRAWL' }).catch(() => {});
  $('stop-btn').disabled = true;
  $('stop-btn').textContent = 'Stopping...';
});

$('auto-hunt-btn').addEventListener('click', async () => {
  showStatus('');
  const searchQuery = $('search-query').value.trim();
  if (!searchQuery) return showStatus('No search query yet — analyze again or enter one manually.');
  setLoading($('auto-hunt-btn'), true, 'Auto-hunting leads...');
  $('stop-btn').hidden = false;
  $('stop-btn').disabled = false;
  $('stop-btn').textContent = 'Stop';
  agencyCrawlStopRequested = false;
  try {
    const location = currentPlatform.supportsCategory ? $('fiverr-location').value : $('location').value.trim();
    const category = currentPlatform.supportsCategory ? $('fiverr-category').value : '';
    const accountType = readAccountType();
    const limit = readMaxLeads();
    const url = buildSearchUrl(currentPlatform, searchQuery, location, accountType, category);
    if (currentPlatform.key === 'fiverr') {
      console.log('[Hunt-Ex] Fiverr auto-hunt inputs:', { searchQuery, location, category, limit, url });
    }
    let leads;
    let crawlWarning = null;
    if (currentPlatform.key === 'upwork' && accountType === 'agency') {
      leads = await crawlAgencies(url, readMaxLeads());
    } else if (currentPlatform.key === 'fiverr') {
      leads = await crawlFiverrSellers(url, limit);
    } else {
      const keywords = readKeywordsField('keywords');
      const excludeKeywords = readKeywordsField('exclude-keywords');
      const result = await autoHunt(url, keywords, excludeKeywords, readMaxLeads());
      leads = result.leads;
      crawlWarning = result.warning;
    }
    if (leads.length) await sendToBackground({ type: 'SAVE_LEADS', leads });
    await refreshLeads();
    showStatus(
      crawlWarning ? `Added ${leads.length} lead(s). Crawl stopped: ${crawlWarning}` :
        leads.length ? `Added ${leads.length} leads.` : 'No matching leads found — try a different search query.',
      Boolean(crawlWarning) || !leads.length
    );
  } catch (err) {
    showStatus(err.message);
  } finally {
    setLoading($('auto-hunt-btn'), false);
    $('stop-btn').hidden = true;
    activeCrawlTabId = null;
  }
});

$('crawl-btn').addEventListener('click', async () => {
  showStatus('');
  if (readAccountType() === 'agency') {
    return showStatus('Manual crawl is not supported in Agency mode yet — use Auto-hunt instead.');
  }
  setLoading($('crawl-btn'), true, 'Crawling...');
  try {
    const tab = await getActiveTab();
    const platform = detectPlatformFromUrl(tab?.url);
    if (!platform || !platform.implemented || platform.key !== currentPlatform?.key) {
      throw new Error(`Current tab isn't ${currentPlatform?.label} — switch to the right tab and try again.`);
    }
    const keywords = readKeywordsField('keywords');
    const excludeKeywords = readKeywordsField('exclude-keywords');
    activeCrawlTabId = tab.id;
    $('stop-btn').hidden = false;
    $('stop-btn').disabled = false;
    $('stop-btn').textContent = 'Stop';
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'START_CRAWL', keywords, limit: readMaxLeads() });
    if (!res?.ok) throw new Error(res?.error || 'Crawl failed');
    const leads = filterLeads(res.leads, keywords, excludeKeywords);
    if (leads.length) await sendToBackground({ type: 'SAVE_LEADS', leads });
    await refreshLeads();
    showStatus(res.warning ? `Added ${leads.length} lead(s). Crawl stopped: ${res.warning}` : `Added ${leads.length} leads.`, Boolean(res.warning));
  } catch (err) {
    showStatus(err.message);
  } finally {
    setLoading($('crawl-btn'), false);
    $('stop-btn').hidden = true;
    activeCrawlTabId = null;
  }
});

$('export-btn').addEventListener('click', async () => {
  const leads = await sendToBackground({ type: 'GET_LEADS' });
  if (!leads.length) return showStatus('No leads to export yet.');
  const csv = toCsv(leads);
  const url = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  chrome.downloads.download({ url, filename: `hunt-ex-leads-${Date.now()}.csv` });
});

$('clear-btn').addEventListener('click', async () => {
  await sendToBackground({ type: 'CLEAR_LEADS' });
  await refreshLeads();
});

$('options-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Test trước khi lưu (không lưu nếu test fail) — tránh trường hợp gõ nhầm key, lưu xong mới biết
// sai lúc bấm Auto-hunt (lỗi mơ hồ hơn nhiều so với báo ngay tại đây). `provider` (2026-09-28) đọc
// từ radio đang chọn — chọn provider nào thì chỉ cần nhập/lưu đúng key của provider đó, không bắt
// buộc phải có cả 2 (xem CLAUDE.md).
$('apikey-save-btn').addEventListener('click', async () => {
  const provider = document.querySelector('input[name="apikey-provider"]:checked').value;
  const apiKey = (provider === 'exa' ? $('exa-apikey-input') : $('apikey-input')).value.trim();
  if (!apiKey) return showStatus('Please enter an API key.');
  showStatus('');
  setLoading($('apikey-save-btn'), true, 'Testing key...');
  try {
    const testResult = await sendToBackground({ type: 'TEST_API_KEY', provider, apiKey });
    if (!testResult.ok) {
      showStatus(`Key test failed: ${testResult.error}`);
      return;
    }
    await sendToBackground({ type: 'SAVE_API_KEY', provider, apiKey });
    showHome();
    showStatus('API key saved and working.', false);
  } catch (err) {
    showStatus(err.message);
  } finally {
    setLoading($('apikey-save-btn'), false);
  }
});

async function initView() {
  try {
    const { provider, hasKey } = await sendToBackground({ type: 'GET_API_KEY_STATUS' });
    if (hasKey) showHome();
    else showApiKeyGate(provider);
  } catch (err) {
    // GET_API_KEY_STATUS chỉ đọc chrome.storage, gần như không bao giờ throw — nhưng nếu có (vd
    // service worker vừa restart), rơi về gate để user tự nhập lại thay vì kẹt màn hình trắng.
    showApiKeyGate();
    showStatus(err.message);
  }
}

initView();
refreshLeads();
