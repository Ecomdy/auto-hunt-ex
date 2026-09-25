// Content script cho Upwork (trang search talent — upwork.com/nx/search/talent?q=...).
// Nhận lệnh crawl từ popup: với mỗi freelancer trong list, (1) lấy field có sẵn trên card,
// (2) click mở modal chi tiết profile, chuẩn hoá thành dữ liệu định danh gọn (bỏ UI noise/feedback),
// (3) gửi thẳng cho background (ANALYZE_PROFILE) để AI tìm contact info công khai, (4) đóng modal,
// sang freelancer kế tiếp. Hết card trên trang mà vẫn chưa đủ `limit` -> tự bấm pagination "Next"
// (getPaginationInfo()/goToNextPage(), CHƯA verify live — viết từ HTML mẫu user gửi 2026-09-23)
// sang trang kế tiếp, dừng khi đủ limit/hết trang/bị stop. Trả về lead list (mỗi lead có thêm field
// `analysis`).
//
// Selector card viết từ mẫu HTML thật (2026-09-23). Card không có [data-test] riêng ở cấp
// <article> — dùng id="talent-tile-{contractorId}" (ổn định, không phải class hash) làm selector
// chính, field bên trong ưu tiên [data-test].
//
// PHẦN MODAL LÀ BEST-EFFORT, CHƯA VERIFY THẬT TRÊN TRÌNH DUYỆT LIVE (xem CLAUDE.md):
// - Mở modal: click bằng cách dispatch MouseEvent vào <article> (có class "cursor-pointer" — suy
//   ra cả card clickable, và href của link "View full profile" trong mẫu modal cho thấy URL khi
//   modal mở là /nx/search/talent/details/~{id}/profile, khớp id lấy từ card). CHƯA có xác nhận
//   click thật có mở đúng modal không.
// - Đóng modal: dispatch phím Escape (quy ước chuẩn cho overlay/slider) — mẫu HTML modal user gửi
//   bị cắt ở phần header, KHÔNG thấy nút close desktop rõ ràng để bấm trực tiếp.
// - Loại "Client Feedback": heuristic tìm heading có chữ "feedback"/"review" rồi bỏ cả khối đó —
//   CHƯA thấy phần đó trong mẫu (modal HTML bị cắt ở đầu, chưa tới lúc). Nếu feedback nằm rải rác
//   trong nhiều mục nhỏ (vd lồng trong "Work history" theo từng job) thay vì 1 section riêng,
//   heuristic này sẽ sót — cần mẫu HTML thật của phần đó để làm chính xác hơn.
// Nếu 1 trong 2 bước mở/đóng modal thất bại (timeout), bỏ qua freelancer đó (không chặn cả crawl).
//
// AGENCY FLOW (pt=agency search, thêm 2026-09-24) — khác hẳn luồng freelancer ở trên:
// DISCOVER_AGENCIES quét khối "Associated with {agency}" trên từng freelancer card (ảnh org-logo,
// xem collectAgencyLinks() — KHÔNG phải link <a>, bản đầu đoán sai đã sửa sau khi có HTML thật),
// dedupe theo agencyId (không mở modal). EXTRACT_AGENCY_DETAIL chạy trên chính trang chi tiết 1
// agency — ĐÃ implement từ HTML mẫu thật (2026-09-24, xem extractAgencyDetail()). Vòng lặp điều hướng
// qua từng agency detail page nằm ở popup.js (crawlAgencies()), không nằm trong content script này
// như freelancer — content script chỉ trả lời từng message rời rạc cho mỗi agency. Vì không có link
// để "click", việc sang agency kế là điều hướng thẳng URL đã build sẵn (chrome.tabs.update) — bù lại
// bằng delay ngẫu nhiên giữa các lần điều hướng (giống humanDelay() ở freelancer), xem popup.js.
(function () {
  'use strict';

  // Vòng lặp mở modal + gọi AI tuần tự cho từng freelancer chạy khá lâu — cho phép panel gửi
  // STOP_CRAWL để huỷ giữa chừng, kiểm tra cờ này trước mỗi freelancer (không ngắt giữa lúc đang
  // mở/đóng modal), trả về những lead đã xử lý xong tính tới lúc đó.
  let stopRequested = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'STOP_CRAWL') {
      stopRequested = true;
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === 'START_CRAWL') {
      stopRequested = false;
      scrapeCurrentPage(message.keywords || [], message.limit)
        .then((leads) => sendResponse({ ok: true, leads }))
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }
    // Agency flow (pt=agency search) — xem CLAUDE.md TODO "Upwork: filter freelancer/agency".
    // DISCOVER_AGENCIES chạy trên trang search, EXTRACT_AGENCY_DETAIL chạy trên trang chi tiết
    // 1 agency (`/agencies/{id}/`) — cùng content script vì cả 2 URL đều khớp match "*://*.upwork.com/*".
    if (message?.type === 'DISCOVER_AGENCIES') {
      stopRequested = false;
      discoverAgencies(message.limit)
        .then((agencies) => sendResponse({ ok: true, agencies }))
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }
    if (message?.type === 'EXTRACT_AGENCY_DETAIL') {
      extractAgencyDetail()
        .then((detail) => sendResponse({ ok: true, detail }))
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }
    return false;
  });

  function textOf(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Delay ngẫu nhiên giả lập người dùng thật (không click-đọc-đóng liên tục như bot) — user yêu
  // cầu 2026-09-23. Cũng giảm rủi ro bị Upwork coi là traffic tự động.
  function humanDelay(minMs, maxMs) {
    return sleep(minMs + Math.random() * (maxMs - minMs));
  }

  function waitFor(check, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        const result = check();
        if (result) return resolve(result);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(poll, 200);
      })();
    });
  }

  function getTalentCards() {
    return [...document.querySelectorAll('article[id^="talent-tile-"]')];
  }

  // Selector từ HTML mẫu thật (2026-09-23): container pagination có 2 token trong `data-test`
  // ("UpCPagination ProfilesPagination") -> dùng ~= để khớp 1 token. `data-ev-current_page_index`
  // là số trang hiện tại (đáng tin hơn parse text "1 of 31"). Next button còn bấm được khi có href
  // thật và KHÔNG bị đánh dấu disabled (mẫu cho thấy first/prev-page lúc disabled có cả class
  // "is-disabled" lẫn aria-disabled="true" — suy ra next/last cũng theo quy ước này ở trang cuối).
  function getPaginationInfo() {
    const container = document.querySelector('[data-test~="ProfilesPagination"]');
    const nextBtn = document.querySelector('a[data-test="next-page"]');
    const hasNext = Boolean(
      nextBtn &&
        nextBtn.getAttribute('href') &&
        nextBtn.getAttribute('aria-disabled') !== 'true' &&
        !nextBtn.classList.contains('is-disabled')
    );
    return {
      currentPage: container ? Number(container.getAttribute('data-ev-current_page_index')) : null,
      nextBtn,
      hasNext,
    };
  }

  // CHƯA verify live thật hoàn toàn (2026-09-24): user xác nhận .click() CÓ tác dụng thật — URL đổi
  // thành `&page=2&nav_dir=pop` sau khi bấm (bằng chứng thật, không phải đoán) — vậy bug không nằm ở
  // cách bấm. Nghi vấn còn lại: Upwork có thể đổi URL (pushState) trước rồi mới fetch/render card
  // trang mới — nếu fetch chậm (server tính lại ranking cho badge filter rising_talent/top_rated...)
  // thì URL đã đổi nhưng card đứng yên tới khi hết 10s cũ. Tăng timeout lên 20s (chưa chắc đủ, chỉ là
  // ước lượng rộng rãi hơn) và log rõ URL + id card trước/sau ngay cả khi fail — nếu vẫn lỗi, đọc log
  // này sẽ biết chắc là do chậm (URL đổi, card cuối cùng cũng đổi nhưng quá 20s) hay do nguyên nhân
  // khác hẳn (URL đổi nhưng card KHÔNG BAO GIỜ đổi dù chờ lâu) — không đoán thêm khi chưa có log đó.
  async function goToNextPage() {
    const { currentPage, nextBtn, hasNext } = getPaginationInfo();
    if (!hasNext) return false;

    const urlBefore = window.location.href;
    console.log('[Hunt-Ex] Clicking next page from page', currentPage, '— url before:', urlBefore);
    const firstCardIdBefore = getTalentCards()[0]?.id || null;
    await humanDelay(600, 1500); // giả lập thời gian "nhìn hết" trang trước khi sang trang kế
    nextBtn.click();

    const loaded = await waitFor(() => {
      const cards = getTalentCards();
      return cards.length > 0 && cards[0].id !== firstCardIdBefore;
    }, 20000);

    const firstCardIdAfter = getTalentCards()[0]?.id || null;
    console.log(
      '[Hunt-Ex] After clicking next page — url now:', window.location.href,
      '| first card id before:', firstCardIdBefore,
      '| first card id now:', firstCardIdAfter,
      '| card count now:', getTalentCards().length
    );

    if (!loaded) {
      throw new Error(
        `Next page did not load new talent cards after clicking pagination (waited 20s). URL before: ${urlBefore} — URL now: ${window.location.href} — first card id stayed: ${firstCardIdAfter || 'none'}.`
      );
    }

    await humanDelay(800, 1800); // giả lập thời gian đọc trang mới trước khi crawl tiếp
    return true;
  }

  function extractBadges(card) {
    return [...card.querySelectorAll('[data-test^="freelancer-tile-badges-"] .air3-badge')]
      .map(textOf)
      .filter(Boolean);
  }

  function extractSkills(card) {
    return [...card.querySelectorAll('.air3-token-container button.air3-token')]
      .map(textOf)
      .filter(Boolean);
  }

  function getProfileUrl(card) {
    const link = card.querySelector('h5.name a.profile-link');
    if (!link) return null;
    const url = new URL(link.getAttribute('href'), window.location.href);
    url.search = ''; // bỏ ?referrer_url_path=... — không cần cho lead/AI, chỉ cần URL profile gốc
    return url.href;
  }

  function extractCard(card) {
    const nameLink = card.querySelector('h5.name a.profile-link');
    const titleLink = card.querySelector('h4.title a.profile-link');
    if (!nameLink) return null; // không xác định được freelancer -> bỏ qua

    const name = textOf(nameLink);
    const headline = textOf(titleLink);
    const freelancerLocation = textOf(card.querySelector('.location'));
    const rate = textOf(card.querySelector('[data-test="rate-per-hour"]')) + textOf(card.querySelector('[data-test="rate-per-hour-label"]'));
    const jobSuccess = textOf(card.querySelector('[data-test="i18n-t"] > span'));
    const earnings = textOf(card.querySelector('[data-test="freelancer-tile-earnings"] strong'));
    const badges = extractBadges(card);
    const skills = extractSkills(card);
    const description = textOf(card.querySelector('.description'));

    const snippet = [
      freelancerLocation,
      rate,
      jobSuccess && `${jobSuccess} job success`,
      earnings,
      badges.join(', '),
      skills.join(', '),
      description,
    ]
      .filter(Boolean)
      .join(' — ');

    return {
      platform: 'upwork',
      title: headline ? `${name} — ${headline}` : name,
      url: getProfileUrl(card),
      snippet,
      postedAt: null,
      extractedAt: new Date().toISOString(),
    };
  }

  function extractProfileIdentity(card) {
    return {
      displayName: textOf(card.querySelector('h5.name a.profile-link')),
      headline: textOf(card.querySelector('h4.title a.profile-link')),
      location: textOf(card.querySelector('.location')),
    };
  }

  // ponytail: modal mount ngay nhưng nội dung thân (about/skill/portfolio/work history) load bằng
  // fetch nội bộ của Upwork SAU KHI mount (thấy log "fetchRelevantPortfolioV2Items" chạy async lúc
  // verify live 2026-09-23).
  //
  // BUG đã sửa (2026-09-23): bản trước chỉ "chờ tới khi textContent ngừng phình to" (2 lần đo liên
  // tiếp bằng nhau) mà KHÔNG bắt buộc chờ tối thiểu — nếu mạng chậm và fetch CHƯA KỊP BẮT ĐẦU, 2 lần
  // đo đầu (cùng là "chưa có gì") bị hiểu nhầm thành "đã ổn định", chốt lấy content ngay khi còn
  // rỗng (bằng chứng thật: lần chạy sau có mạng chậm hơn, profile_text còn ngắn hơn cả lần trước).
  // Sửa: bắt buộc chờ đủ `minWaitMs` trước, sau đó mới bắt đầu đếm ổn định.
  // Ceiling: đây vẫn là suy đoán về thời gian load, KHÔNG có cách chắc chắn 100% biết khi nào xong
  // (mẫu HTML "Work history" user gửi có anchor thật `#hor-anc-id-work-history`, có thể dùng làm
  // tín hiệu "đã load" đáng tin hơn — nhưng freelancer chưa có work history sẽ không có anchor này,
  // nên chưa dùng làm điều kiện chính, chỉ tăng minWaitMs cho an toàn hơn). Nếu vẫn thấy
  // profile_text ngắn/thiếu sau fix này, gửi tiếp log để tăng minWaitMs hoặc đổi cách chờ, không
  // đoán thêm.
  // Chưa xác nhận chắc phần tử nào thật sự scroll bên trong modal (chưa có mẫu HTML xác nhận) —
  // thử scroll cả modal, container cha `.air3-slider-body`, và window. Set scrollTop lên phần tử
  // không thật sự scroll được là no-op vô hại, không cần biết chính xác cái nào mới đúng.
  function scrollModalToBottom(modal) {
    modal.scrollTop = modal.scrollHeight;
    const sliderBody = modal.closest('.air3-slider-body');
    if (sliderBody) sliderBody.scrollTop = sliderBody.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  }

  // User yêu cầu (2026-09-23): chủ động scroll xuống cuối để kích hoạt phần lazy-load-on-scroll
  // (nếu Upwork dùng kiểu này cho phần dưới của modal), không chỉ chờ fetch load xong rồi đứng yên.
  // Scroll ngay trong MỖI lần đo (không phải 1 lần ở cuối) — nếu scroll làm mount thêm nội dung mới,
  // vòng lặp ổn định (2 lần đo liên tiếp bằng nhau) sẽ tự kéo dài thêm cho tới khi thật sự hết.
  async function waitForModalContentStable(modal, { minWaitMs = 2500, timeoutMs = 10000, intervalMs = 400 } = {}) {
    const start = Date.now();
    await sleep(minWaitMs);

    let lastLength = -1;
    let stableStreak = 0;
    while (Date.now() - start < timeoutMs) {
      scrollModalToBottom(modal);
      const length = modal.textContent.length;
      if (length === lastLength) {
        stableStreak++;
        if (stableStreak >= 2) return;
      } else {
        stableStreak = 0;
        lastLength = length;
      }
      await sleep(intervalMs);
    }
  }

  async function openProfileModal(card) {
    console.log('[Hunt-Ex] Clicking card to open modal:', card.id);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    const modal = await waitFor(() => document.querySelector('[data-test-route="modal-profile-details"]'), 8000);
    console.log('[Hunt-Ex] Modal found after click?', Boolean(modal));
    if (!modal) throw new Error('Modal did not open after clicking the card');
    await waitForModalContentStable(modal);
    console.log('[Hunt-Ex] Modal content length after waiting for it to stabilize:', modal.textContent.length);
    return modal;
  }

  // User xác nhận (2026-09-23, sau khi cho xem HTML): dispatch Escape đôi khi KHÔNG đóng được modal
  // khi chạy hàng loạt (lý do chưa rõ — có thể do focus không nằm trong modal lúc đó). Cách chắc ăn
  // hơn: bấm thẳng nút back của air3-slider (`data-test="BackButton"`, mũi tên trái góc trên modal —
  // user xác nhận bấm nút này đóng HẲN modal về search list, dù data-test tên là "Back" chứ không
  // phải "Close" — vì modal này là kiểu air3-slider trượt từ cạnh, "back" từ slide gốc = thoát
  // slider). Vẫn giữ Escape làm fallback phòng khi vì lý do nào đó nút back không có trong DOM.
  async function closeProfileModal() {
    const modal = document.querySelector('[data-test-route="modal-profile-details"]');
    const backBtn = modal?.querySelector('[data-test="BackButton"]');
    if (backBtn) {
      backBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }
    await waitFor(() => !document.querySelector('[data-test-route="modal-profile-details"]'), 4000);
  }

  function extractStructuredLines(root) {
    const lines = [];
    const blockTags = new Set([
      'ADDRESS',
      'ARTICLE',
      'ASIDE',
      'BLOCKQUOTE',
      'BR',
      'DD',
      'DIV',
      'DL',
      'DT',
      'FIGCAPTION',
      'FIGURE',
      'FOOTER',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'HEADER',
      'LI',
      'MAIN',
      'NAV',
      'OL',
      'P',
      'SECTION',
      'TABLE',
      'TD',
      'TH',
      'TR',
      'UL',
    ]);
    let current = '';

    function flush() {
      const value = current.replace(/\s+/g, ' ').trim();
      if (value) lines.push(value);
      current = '';
    }

    function walk(node) {
      if (node.nodeType === 3) {
        current += ` ${node.nodeValue || ''}`;
        return;
      }
      if (node.nodeType !== 1) return;

      const tag = node.tagName;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(tag)) return;
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return;

      const isBlock = blockTags.has(tag) || node.getAttribute('role') === 'heading';
      if (isBlock) flush();
      for (const child of node.childNodes) walk(child);
      if (isBlock) flush();
    }

    walk(root);
    flush();
    return lines;
  }

  function extractModalSkills(modal, card) {
    const selectors = [
      '.air3-token-container button.air3-token',
      'button.air3-token',
      '[data-test*="skill"] .air3-token',
      '[data-test*="skill"] button',
    ];
    const values = [...extractSkills(card)];
    for (const selector of selectors) {
      for (const element of modal.querySelectorAll(selector)) values.push(textOf(element));
    }
    return values.filter((value) => value && value.length <= 100);
  }

  function extractExternalLinks(modal) {
    const links = [];
    for (const anchor of modal.querySelectorAll('a[href]')) {
      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue;

      if (rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
        links.push({ label: textOf(anchor), url: rawHref });
        continue;
      }

      let url;
      try {
        url = new URL(rawHref, window.location.href);
      } catch {
        continue;
      }
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (/(^|\.)upwork\.com$/i.test(url.hostname)) continue;
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:utm_|ref$|referrer|source$)/i.test(key)) url.searchParams.delete(key);
      }
      url.hash = '';
      links.push({ label: textOf(anchor), url: url.href });
    }
    return links;
  }

  function extractProfileData(modal, card) {
    const cleaner = globalThis.HuntExUpworkProfileCleaner;
    if (!cleaner?.cleanUpworkProfileData) {
      throw new Error('Upwork profile cleaner is not loaded. Reload the extension and try again.');
    }
    return cleaner.cleanUpworkProfileData({
      rawText: textOf(modal),
      structuredLines: extractStructuredLines(modal),
      identity: extractProfileIdentity(card),
      skills: extractModalSkills(modal, card),
      externalLinks: extractExternalLinks(modal),
    });
  }

  async function analyzeProfile(upworkProfileUrl, profileData, crawledAt) {
    const res = await chrome.runtime.sendMessage({
      type: 'ANALYZE_PROFILE',
      upworkProfileUrl,
      profileData,
      crawledAt,
    });
    if (!res?.ok) throw new Error(res?.error || 'Profile analysis failed');
    return res.result;
  }

  // Báo tiến độ về panel (popup.js lắng nghe CRAWL_PROGRESS) — vì cả loop này chạy rất lâu
  // (mở modal + gọi AI tuần tự cho từng freelancer), không có progress thì UI trông như treo.
  // Fire-and-forget: .catch() nuốt lỗi "no receiver" nếu panel lỡ không lắng nghe.
  function reportProgress(current, total, message) {
    chrome.runtime.sendMessage({ type: 'CRAWL_PROGRESS', current, total, message }).catch(() => {});
  }

  // Lặp qua nhiều trang pagination cho tới khi đủ `limit` lead hoặc hết trang (list ít hơn limit
  // thì lấy hết, không coi là lỗi). `limit` falsy (0/undefined) = không giới hạn, chỉ dừng khi hết
  // trang hoặc bị stop — dùng cho crawl thủ công không qua ô "Max leads" (xem popup.js readMaxLeads()).
  async function scrapeCurrentPage(_keywords, limit) {
    const leads = [];
    const seenUrls = new Set();
    let pageIndex = 1;

    while (true) {
      const cards = getTalentCards();
      console.log('[Hunt-Ex] Found', cards.length, 'talent card(s) on page', pageIndex, window.location.href);

      for (let i = 0; i < cards.length; i++) {
        if (limit && leads.length >= limit) break;

        if (stopRequested) {
          reportProgress(leads.length, limit || leads.length, `Stopped — kept ${leads.length} lead(s) processed so far.`);
          return leads;
        }

        const lead = extractCard(cards[i]);
        if (!lead) continue;
        // Freelancer đã crawl rồi (quan sát thật 2026-09-23: cùng 1 freelancer bị lặp lại ở ranh
        // giới 2 trang pagination, chưa rõ do Upwork tự xếp hạng lại giữa 2 lần load trang hay do
        // DOM chưa kịp đổi hết khi ta kiểm tra "đã sang trang mới" — dedupe ở đây chặn được symptom
        // dù nguyên nhân là gì, tránh tốn thêm 1 lượt gọi AI cho cùng 1 người).
        if (lead.url && seenUrls.has(lead.url)) continue;
        if (lead.url) seenUrls.add(lead.url);

        const position = `${leads.length + 1}/${limit || cards.length}`;
        await humanDelay(600, 1500); // giả lập thời gian "nhìn" card trước khi bấm vào
        reportProgress(leads.length + 1, limit || cards.length, `Opening profile ${position}: ${lead.title}`);

        try {
          const modal = await openProfileModal(cards[i]);
          const rawLength = modal.textContent.length;
          const profileData = extractProfileData(modal, cards[i]);
          const crawledAt = new Date().toISOString(); // ngay sau khi chuẩn hoá xong, không phải lúc gọi AI
          const serializedLength = JSON.stringify(profileData).length;
          const reduction = rawLength ? Math.round((1 - serializedLength / rawLength) * 100) : 0;
          console.log(
            `[Hunt-Ex] cleaned profile_data for ${lead.url} (${rawLength} -> ${serializedLength} chars, ${reduction}% smaller):`,
            profileData
          );
          reportProgress(leads.length + 1, limit || cards.length, `Analyzing ${position}: ${lead.title}...`);
          lead.analysis = await analyzeProfile(lead.url, profileData, crawledAt);
          reportProgress(leads.length + 1, limit || cards.length, `Done ${position}: ${lead.title}`);
        } catch (err) {
          lead.analysisError = err.message || String(err);
          reportProgress(leads.length + 1, limit || cards.length, `Skipped ${position}: ${lead.title} — ${lead.analysisError}`);
          console.warn('[Hunt-Ex] Skipped profile analysis for', lead.url, '—', lead.analysisError);
        } finally {
          await closeProfileModal();
          await humanDelay(800, 2000); // giả lập thời gian nghỉ giữa 2 profile, không lướt liên tục
        }

        leads.push(lead);
      }

      if (limit && leads.length >= limit) break;
      if (stopRequested) break;

      reportProgress(leads.length, limit || leads.length, `Page ${pageIndex} done — moving to next page...`);
      let advanced;
      try {
        advanced = await goToNextPage();
      } catch (err) {
        // goToNextPage() throw (vd timeout chờ card đổi) không được làm mất lead đã crawl xong ở
        // các trang trước — trả về những gì có, giống hệt cách xử lý STOP_CRAWL ở trên.
        reportProgress(leads.length, limit || leads.length, `Pagination stopped — kept ${leads.length} lead(s): ${err.message}`);
        console.warn('[Hunt-Ex] Pagination failed, returning leads collected so far —', err.message);
        break;
      }
      if (!advanced) break;
      pageIndex++;
    }

    return leads;
  }

  // Quét toàn trang tìm khối "Associated with {agency}" trên freelancer card — xác nhận qua HTML
  // thật (2026-09-24): KHÔNG có thẻ <a href> nào (bản đầu đoán sai), chỉ có
  // <img class="air3-avatar-company" src=".../org-logo/{id}" alt="{agency name}">. Số trong
  // "org-logo/{id}" xác nhận thật CHÍNH LÀ agencyId của `/agencies/{id}/` (user tự mở URL kiểm
  // tra). `alt` luôn trùng tên hiển thị trong `.name` div kế bên — dùng thẳng `alt`, không cần dò
  // DOM cha/anh em. Dedupe theo agencyId vì 1 agency lặp lại ở nhiều freelancer card.
  // Logic parse/dedupe nằm ở upwork-agency-links.js (pure, có unit test) — file này chỉ đọc DOM.
  function collectAgencyLinks(root = document) {
    const helper = globalThis.HuntExUpworkAgencyLinks;
    if (!helper?.collectAgencies) {
      throw new Error('Upwork agency-links helper is not loaded. Reload the extension and try again.');
    }
    const images = [...root.querySelectorAll('img[src*="/org-logo/"]')].map((img) => ({
      src: img.getAttribute('src'),
      alt: img.getAttribute('alt'),
    }));
    return helper.collectAgencies(images, window.location.href);
  }

  // Lặp qua các trang pagination (tái dùng goToNextPage() — đã tự chờ card đổi thật sự trước khi
  // coi là sang trang mới) gom link agency, dedupe XUYÊN SUỐT các trang. Không dùng
  // MutationObserver riêng: goToNextPage() đã là tín hiệu "trang mới render xong" đáng tin, đủ cho
  // cả link agency lẫn card freelancer cùng lúc.
  async function discoverAgencies(limit) {
    const found = new Map();
    let pageIndex = 1;

    while (true) {
      for (const [id, agency] of collectAgencyLinks(document)) {
        if (!found.has(id)) found.set(id, agency);
      }
      reportProgress(found.size, limit || found.size, `Page ${pageIndex}: ${found.size} unique agenc${found.size === 1 ? 'y' : 'ies'} found so far...`);

      if (limit && found.size >= limit) break;
      if (stopRequested) break;

      let advanced;
      try {
        advanced = await goToNextPage();
      } catch (err) {
        console.warn('[Hunt-Ex] Agency discovery pagination stopped —', err.message);
        break;
      }
      if (!advanced) break;
      pageIndex++;
    }

    const agencies = [...found.values()];
    return limit ? agencies.slice(0, limit) : agencies;
  }

  // Selector viết từ HTML mẫu thật trang chi tiết agency user gửi (2026-09-24). Giữ tối giản theo
  // Trích detail đầy đủ để dùng được ở UI/debug về sau. Riêng payload gửi OpenAI được agency-
  // analyzer.js whitelist cứng còn đúng name, description, location, service để không phình token.
  //
  // SỬA 2026-09-24: regex cũ chỉ nhận ID SỐ (`\d+`) vì lúc viết chỉ thấy dạng URL
  // `/agencies/{numericId}/` (org-logo id, xem collectAgencyLinks()). Bug thật user báo cáo: Upwork
  // redirect URL số đó sang URL slug tên công ty (`/agencies/digiestate/`, `/agencies/uprango/`) —
  // window.location.pathname lúc content script chạy đã là slug, không còn digit nào, nên hàm cũ
  // trả về null và extractAgencyDetail() throw "Not an agency detail page" dù đang đứng đúng trang.
  // Nới regex nhận bất kỳ segment nào sau /agencies/ (số hoặc slug) — giá trị trả về chỉ dùng để
  // null-check "có đang ở trang chi tiết agency không" + build lại `detail.upworkUrl`, không có chỗ
  // nào khác trong code base giả định nó phải là số (đã kiểm tra: agency-analyzer.js không đọc field
  // này, ANALYZE_AGENCY không cache theo id, lead storage không dedupe theo id).
  function extractAgencyIdFromUrl() {
    const match = window.location.pathname.match(/\/agencies\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  function extractOverview() {
    const text = textOf(document.querySelector('p.white-space-pre-wrap'));
    if (!text) return null;
    return text.length > 1500 ? text.slice(0, 1500) : text; // cap 1500 ký tự (giống giới hạn đã định ban đầu)
  }

  // Mỗi service là 1 <h5 data-ev-sublocation="services">{tên}</h5> (button collapse bên trong
  // không có text) — CHỈ service đầu tiên có mô tả render sẵn trong DOM (còn lại collapsed, Vue
  // chưa mount nội dung), nên chỉ lấy được TÊN, không lấy được mô tả cho service #2 trở đi.
  function extractServices() {
    return [...document.querySelectorAll('h5[data-ev-sublocation="services"]')]
      .map(textOf)
      .filter(Boolean)
      .slice(0, 15);
  }

  function extractAgencySkills() {
    const heading = document.querySelector('h3[data-ev-sublocation="skills"]');
    const section = heading?.closest('.air3-card-section');
    if (!section) return [];
    return [...section.querySelectorAll('.air3-token')].map(textOf).filter(Boolean);
  }

  // Chỉ lấy những gì đã render sẵn (2 item đầu, có nút "See more portfolio pieces" chưa bấm) —
  // cùng hạn chế đã biết với freelancer flow (không tự bấm load thêm).
  function extractPortfolio() {
    return [...document.querySelectorAll('a[name="modal-portfolio-project"]')]
      .map(textOf)
      .filter(Boolean)
      .slice(0, 10);
  }

  function extractFeaturedClients() {
    return [...document.querySelectorAll('a[name="modal-featured-client"]')].map(textOf).filter(Boolean);
  }

  // Chỉ lấy tên job — CỐ Ý bỏ review text khách hàng (<p class="mb-3x"><em>"..."</em></p> đi kèm
  // mỗi work-history entry), cùng tinh thần loại "Client Feedback" đã làm ở freelancer flow.
  function extractWorkHistoryTitles() {
    return [...document.querySelectorAll('a[name="modal-work-history"]')]
      .map(textOf)
      .filter(Boolean)
      .slice(0, 12);
  }

  // "Business managers" section — đây chính là nguồn cho primaryContact/"người đứng đầu". Vai trò
  // lấy nguyên văn từ nút Invite: aria-label="Invite {name} ({role}) to Job" (vd "Agency business
  // manager") — xác nhận thật qua HTML mẫu, không đoán. Nếu agency khác có "Agency owner"/"Founder"
  // thay vì "business manager", regex này vẫn lấy đúng vì không hardcode chuỗi role cụ thể.
  function extractMembers() {
    const members = [];
    for (const card of document.querySelectorAll('.member-card')) {
      const link = card.querySelector('a.up-n-link[href*="/freelancers/"]');
      if (!link) continue;
      const name = textOf(link);
      const inviteBtn = card.querySelector('button[aria-label^="Invite "]');
      const roleMatch = inviteBtn?.getAttribute('aria-label')?.match(/\(([^)]+)\)/);
      let profileUrl = null;
      try {
        profileUrl = new URL(link.getAttribute('href'), window.location.href).href;
      } catch {
        // bỏ qua href hỏng, không chặn cả agency
      }
      members.push({ name: name || null, role: roleMatch ? roleMatch[1] : null, profileUrl });
    }
    return members.slice(0, 10);
  }

  // "Office locations"/"Upwork activity"/"Company information" KHÔNG có data-test/data-ev-sublocation
  // ổn định trên chính heading (data-v-* là hash Vue theo build, không dùng được — xem CLAUDE.md) —
  // dùng text của <h3> để tìm đúng section, sau đó chỉ query BÊN TRONG section đó.
  function findSectionByHeadingText(headingText) {
    for (const heading of document.querySelectorAll('h3')) {
      if (textOf(heading) === headingText) return heading.closest('.air3-card-section');
    }
    return null;
  }

  // Agency có thể có nhiều văn phòng — mỗi item là <strong class="d-block">{location}</strong> +
  // <small>Primary location</small> (nếu là văn phòng chính). Xác nhận thật qua HTML mẫu 2026-09-24.
  function extractOfficeLocations() {
    const section = findSectionByHeadingText('Office locations');
    if (!section) return [];
    const items = [];
    for (const row of section.querySelectorAll('.pl-2x')) {
      const location = textOf(row.querySelector('strong'));
      if (!location) continue;
      const isPrimary = [...row.querySelectorAll('small')].some((s) => /primary location/i.test(textOf(s)));
      items.push({ location, isPrimary });
    }
    return items;
  }

  // Cặp <small>{label}</small> + 1-N <h4>{value}</h4> theo SAU nó trong THỨ TỰ DOM — dùng chung cho
  // cả "Upwork activity" (Hourly rate/Total earned/Total hours/Total jobs/Member since) lẫn
  // "Company information" (Agency size/Year founded/Client focus). Không dựa vào quan hệ cha/con
  // trực tiếp vì Upwork lồng khác nhau tuỳ field (vd "Client focus" có 2 <h4> — gộp lại bằng ', ').
  // Xác nhận thật qua HTML mẫu 2026-09-24.
  function extractLabeledStats(section) {
    if (!section) return {};
    const values = {};
    let currentLabel = null;
    for (const el of section.querySelectorAll('small.text-light-on-inverse, h4')) {
      if (el.tagName === 'SMALL') {
        currentLabel = textOf(el) || null;
        if (currentLabel && !values[currentLabel]) values[currentLabel] = [];
      } else if (currentLabel && values[currentLabel]) {
        const value = textOf(el);
        if (value) values[currentLabel].push(value);
      }
    }
    const stats = {};
    for (const [label, parts] of Object.entries(values)) stats[label] = parts.join(', ') || null;
    return stats;
  }

  async function extractAgencyDetail() {
    const agencyId = extractAgencyIdFromUrl();
    if (!agencyId) {
      throw new Error(`Not an agency detail page (URL: ${window.location.href}).`);
    }
    // Trang có vẻ SSR (thấy data-umq-ssr="1" trong HTML mẫu) nên nội dung thường có sẵn ngay khi
    // tab "load complete" — chờ thêm 1 khoảng cố định ngắn cho chắc. ponytail: fixed wait, không
    // poll phức tạp như modal freelancer (chưa có bằng chứng cần hơn) — tăng nếu sau này thấy
    // profile_data thiếu/ngắn bất thường.
    await sleep(500);

    const officeLocations = extractOfficeLocations();
    const primaryLocation = officeLocations.find((l) => l.isPrimary) || officeLocations[0] || null;
    const activityStats = extractLabeledStats(findSectionByHeadingText('Upwork activity'));
    const companyInfo = extractLabeledStats(findSectionByHeadingText('Company information'));

    return {
      agencyId,
      upworkUrl: `${window.location.origin}/agencies/${agencyId}/`,
      upworkName: textOf(document.querySelector('h1.agency-title')) || null,
      tagline: textOf(document.querySelector('[data-test="agency-title"]')) || null,
      // Chuỗi "City, Country" của văn phòng chính (agency-analyzer.js dùng field này y hệt cách
      // freelancer dùng identity.location) — officeLocations giữ nguyên mảng đầy đủ nếu có >1 văn phòng.
      location: primaryLocation?.location || null,
      officeLocations,
      overview: extractOverview(),
      services: extractServices(),
      skills: extractAgencySkills(),
      portfolio: extractPortfolio(),
      featuredClients: extractFeaturedClients(),
      workHistoryTitles: extractWorkHistoryTitles(),
      members: extractMembers(),
      hourlyRate: activityStats['Hourly rate'] || null,
      totalEarned: activityStats['Total earned'] || null,
      totalJobs: activityStats['Total jobs'] || null,
      memberSince: activityStats['Member since'] || null,
      agencySize: companyInfo['Agency size'] || null,
      yearFounded: companyInfo['Year founded'] || null,
      clientFocus: companyInfo['Client focus'] || null,
    };
  }
})();
