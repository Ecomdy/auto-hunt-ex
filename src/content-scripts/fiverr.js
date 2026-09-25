// Fiverr flow: search page chỉ discovery/dedupe seller; popup.js tái sử dụng một tab detail
// và gửi EXTRACT_FIVERR_DETAIL tuần tự cho từng gig. Không fetch endpoint nội bộ,
// không chạy song song và không cố vượt challenge/CAPTCHA của Fiverr.
(function () {
  'use strict';

  const extractor = globalThis.HuntExFiverrExtractor;
  let stopRequested = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'STOP_CRAWL') {
      stopRequested = true;
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === 'DISCOVER_FIVERR_SELLERS') {
      stopRequested = false;
      discoverSellers(message.limit)
        .then((sellers) => sendResponse({ ok: true, sellers }))
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }
    if (message?.type === 'EXTRACT_FIVERR_DETAIL') {
      extractDetail()
        .then((detail) => sendResponse({ ok: true, detail }))
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }
    if (message?.type === 'START_CRAWL') {
      sendResponse({ ok: false, error: 'Fiverr detail analysis requires Auto-hunt mode.' });
      return true;
    }
    return false;
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function humanDelay(minMs, maxMs) {
    return sleep(minMs + Math.random() * (maxMs - minMs));
  }

  function textOf(element) {
    return extractor.cleanText(element?.textContent || '');
  }

  function waitFor(check, timeoutMs) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      (function poll() {
        const result = check();
        if (result) return resolve(result);
        if (Date.now() - startedAt >= timeoutMs) return resolve(null);
        setTimeout(poll, 250);
      })();
    });
  }

  function assertNotBlocked() {
    if (extractor.isBlockedPageText(document.body?.innerText || '')) {
      throw new Error(
        'Fiverr verification required. Complete the security check in the crawler tab, then run Auto-hunt again.'
      );
    }
  }

  // Chỉ lấy field còn dùng tới (link gig + tên + title, cho fallback tên và headline) — bỏ
  // rating/reviewCount/startingPrice/badges/gigId (2026-09-25): không có giá trị tìm identity qua
  // OpenAI, và không còn ai đọc field này sau khi lead.analysis chuyển sang lưu kết quả AI thay vì
  // data thô. Dễ thêm lại nếu sau này cần hiển thị cho user (CSV/UI), hiện chưa ai yêu cầu.
  function readCards() {
    const nodes = [...document.querySelectorAll('.gig-card-layout')];
    return nodes.map((card) => {
      const gigLink = card.querySelector('a[aria-label="Go to gig"][href]');
      const profileLink = [...card.querySelectorAll('a[href]')].find((link) => {
        try {
          const url = new URL(link.href, window.location.href);
          return (
            url.searchParams.get('source') === 'gig_cards' &&
            url.pathname.split('/').filter(Boolean).length === 1
          );
        } catch {
          return false;
        }
      });
      return {
        gigHref: gigLink?.getAttribute('href'),
        sellerName:
          profileLink?.querySelector('[title]')?.getAttribute('title') ||
          profileLink?.getAttribute('title') ||
          textOf(profileLink),
        gigTitle:
          card.querySelector('.gig-header')?.getAttribute('title') || textOf(card.querySelector('.gig-header')),
      };
    });
  }

  function currentSellers(limit) {
    return extractor.collectSellerCandidates(readCards(), window.location.href, limit);
  }

  // Fiverr lazy-load card theo viewport. Scroll từng quãng ngắn + delay ngẫu nhiên, dừng khi
  // đủ seller hoặc card không tăng qua nhiều nhịp. Không tự click challenge.
  async function loadSearchResults(limit) {
    let previousCount = 0;
    let stableRounds = 0;
    for (let step = 0; step < 24 && !stopRequested; step++) {
      assertNotBlocked();
      const count = currentSellers(limit).length;
      if (limit && count >= limit) break;
      stableRounds = count > previousCount ? 0 : stableRounds + 1;
      previousCount = count;
      const atBottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 80;
      if (atBottom && stableRounds >= 3) break;
      window.scrollBy({
        top: Math.max(420, window.innerHeight * (0.55 + Math.random() * 0.25)),
        behavior: 'smooth',
      });
      await humanDelay(750, 1450);
    }
  }

  // Phân trang Fiverr (2026-09-26, xác nhận thật qua HTML mẫu khối cuối trang search — chụp lúc
  // đang ở trang 2, "Previous" trỏ page=1, "Next" trỏ page=3): search KHÔNG phải infinite-scroll
  // thuần như tưởng ban đầu — có phân trang thật qua param URL `&page=N`. KHÔNG tự dựng URL trang kế
  // bằng tay (offset=-41 trong URL không theo công thức rõ ràng — bội số lạ so với limit=48, đoán
  // sai dễ trùng/sót kết quả) — click thẳng link "Next" thật để lấy href do Fiverr tự sinh, giống
  // hệt goToNextPage() của upwork.js. Phát hiện "hết trang" bằng CHÍNH quy ước thấy trong mẫu: link
  // số trang HIỆN TẠI (trang "2" trong mẫu) không có thuộc tính href (khác mọi link trang khác đều
  // có href thật) — suy ra Next cũng mất href khi tới trang cuối theo đúng quy ước component này.
  // CHƯA có mẫu HTML thật của trang cuối để xác nhận 100% — sửa lại nếu sai khi chạy live.
  // Giả định thêm (dựa trên tiền lệ ĐÃ xác nhận của goToNextPage() bên upwork.js — cùng kiểu app
  // hiện đại render lại phía client, không phải hard reload): click Next chỉ đổi URL qua pushState +
  // re-render card, KHÔNG load lại trang — nên vẫn chờ card đầu đổi trong CÙNG JS context được. Nếu
  // hoá ra là hard navigation thật, script context sẽ bị huỷ giữa chừng và message channel về
  // popup.js sẽ báo lỗi rõ ràng (không phải im lặng sai) — sẽ biết ngay để sửa lại cách tiếp cận.
  function getPaginationInfo() {
    const nextLink = document.querySelector('a[aria-label="Next"][role="link"]');
    return { nextLink, hasNext: Boolean(nextLink?.getAttribute('href')) };
  }

  function firstGigHref() {
    return readCards()[0]?.gigHref || null;
  }

  async function goToNextPage() {
    const { nextLink, hasNext } = getPaginationInfo();
    if (!hasNext) return false;

    const urlBefore = window.location.href;
    const firstBefore = firstGigHref();
    console.log('[Hunt-Ex] Fiverr clicking next page — url before:', urlBefore);
    await humanDelay(600, 1500);
    nextLink.click();

    const loaded = await waitFor(() => {
      const href = firstGigHref();
      return href !== null && href !== firstBefore;
    }, 20000);

    console.log(
      '[Hunt-Ex] After clicking next page — url now:', window.location.href,
      '| first gig href before:', firstBefore, '| now:', firstGigHref()
    );

    if (!loaded) {
      throw new Error(
        `Next page did not load new gig cards after clicking pagination (waited 20s). URL before: ${urlBefore} — URL now: ${window.location.href}.`
      );
    }

    await humanDelay(800, 1800);
    return true;
  }

  // Chưa xác nhận Fiverr thật cho phép tối đa bao nhiêu trang/1 câu search — chỉ là mốc an toàn để
  // tránh loop vô hạn nếu không set "Max leads to crawl" (limit) hoặc goToNextPage() có bug, giống
  // tinh thần mốc "24 bước scroll" đã có ở loadSearchResults().
  const MAX_PAGES = 20;

  async function discoverSellers(limit) {
    if (!/\/search\/gigs\/?$/.test(window.location.pathname)) {
      throw new Error(`Not a Fiverr search page (URL: ${window.location.href}).`);
    }
    await waitFor(() => document.querySelector('.gig-card-layout'), 12000);
    assertNotBlocked();

    const collected = new Map();
    for (let page = 0; page < MAX_PAGES && !stopRequested; page++) {
      const remaining = limit ? limit - collected.size : limit;
      await loadSearchResults(remaining);
      for (const seller of currentSellers(remaining)) {
        const key = seller.username.toLowerCase();
        if (!collected.has(key)) collected.set(key, seller);
      }
      if ((limit && collected.size >= limit) || stopRequested) break;
      const advanced = await goToNextPage();
      if (!advanced) break;
      assertNotBlocked();
    }

    const sellers = [...collected.values()];
    if (!sellers.length) {
      throw new Error(
        'No Fiverr gig cards found. The page may still be loading or Fiverr changed its markup.'
      );
    }
    return limit ? sellers.slice(0, limit) : sellers;
  }

  // Chỉ cần location (country) cho input OpenAI — memberSince/responseTime/lastDelivery/languages
  // không có giá trị tìm identity, bỏ khỏi crawl (2026-09-25, xem fiverr-analyzer.js). Đọc trực tiếp
  // <li> label + <strong>value</strong> (sát nhau không dấu phân cách, vd "FromUkraine") thay vì
  // regex trên text đã flatten — tránh nuốt nhầm sang field kế tiếp (bug đã gặp, xem CLAUDE.md).
  function readSellerLocation(statsList) {
    for (const li of statsList?.querySelectorAll(':scope > li') || []) {
      const strong = li.querySelector('strong');
      const label = textOf(li).replace(textOf(strong), '').trim().toLowerCase();
      if (label.startsWith('from')) return textOf(strong) || null;
    }
    return null;
  }

  async function humanReadDetail(targets) {
    for (const target of targets.filter(Boolean)) {
      if (stopRequested) break;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await humanDelay(650, 1350);
    }
  }

  // "Vetted for" — chỉ có ở seller Fiverr Pro (.seller-card.pro), danh sách chuyên môn được Fiverr
  // tự xác thực (khác categories/breadcrumb là của GIG). Không có class/data-testid ổn định riêng
  // cho khối này, chỉ neo được theo TEXT heading "Vetted for" rồi lấy <ul> ngay sau nó — xác nhận
  // thật qua HTML mẫu "Luis"/voiceoverbyluis (2026-09-25): trả về ['Spokespersons Videos', 'UGC
  // Videos', 'Video Consultation']. Trước đó tưởng field này luôn rỗng (2 mẫu live test đầu đều
  // không phải Pro) nên đã bỏ khỏi crawl — mẫu này chứng minh giả định đó sai, thêm lại.
  function readVettedFor(sellerCard) {
    const heading = [...(sellerCard?.querySelectorAll('p') || [])].find((p) => textOf(p) === 'Vetted for');
    const list = heading?.nextElementSibling;
    if (!list || list.tagName !== 'UL') return [];
    return [...list.querySelectorAll(':scope > li')].map(textOf).filter(Boolean);
  }

  // .seller-desc .inner đã chứa ĐỦ chữ trong DOM dù UI có nút "+ See More" (CSS line-clamp, không
  // phải lazy-load thêm) — verify thật bằng HTML mẫu (2026-09-24): kết thúc trọn câu, không bị cắt.
  // Nên KHÔNG cần bấm nút mở rộng trước khi đọc. Bỏ hẳn .gig-description (mô tả gig + metadata
  // Platform/Type/Industry, 2026-09-25) — chỉ là marketing copy của GIG, không phải tín hiệu
  // identity của SELLER, và fiverr-analyzer.js không dùng tới.
  //
  // Fiverr Agency/Business account (2026-09-25, xác nhận thật bằng HTML mẫu seller "reachgiant"):
  // .seller-card render bằng 1 template atomic-CSS hoàn toàn khác (class hash kiểu m2d0eb287, không
  // còn .seller-card-name/.one-liner/.seller-desc/.stats-desc nào cả) — nguyên nhân thật của case
  // snuba1/reachgiant trả về data trắng trước đây. Chỉ có 2 điểm neo ổn định trong template này:
  // link a[href^="/agencies/"] (tên) và attribute data-track-tag (Fiverr tự gắn, không đổi theo
  // build) cho phần mô tả + icon địa điểm. Mới xác nhận qua ĐÚNG 1 mẫu — nếu gặp mẫu thứ 2 lệch cấu
  // trúc, sửa lại selector dưới đây, đừng đoán thêm.
  async function extractDetail() {
    const parsed = extractor.parseGigUrl(window.location.href, window.location.href);
    if (!parsed) throw new Error(`Not a Fiverr gig detail page (URL: ${window.location.href}).`);
    assertNotBlocked();
    await waitFor(
      () => document.querySelector('.seller-card .stats-desc, .seller-card a[href^="/agencies/"]'),
      15000
    );
    await humanDelay(900, 1900);

    const sellerCard = document.querySelector('.seller-card');
    await humanReadDetail([sellerCard]);
    assertNotBlocked();

    const gigTitle = textOf(document.querySelector('h1'));
    const agencyNameLink = sellerCard?.querySelector('a[href^="/agencies/"]');
    const sellerName =
      textOf(sellerCard?.querySelector('.seller-card-name')) || textOf(agencyNameLink) || parsed.username;
    const oneLiner = extractor.cleanText(textOf(sellerCard?.querySelector('.one-liner')), 200);
    // Template agency không có bio cá nhân — tín hiệu gần nhất là khối "Gig Summary" + mô tả agency,
    // neo vào data-track-tag="collapsible" (chứa cả 2 phần cùng 1 parent trong mẫu đã xác nhận).
    const agencyDescription = sellerCard?.querySelector('[data-track-tag="collapsible"]')?.parentElement;
    const sellerBio =
      extractor.cleanText(textOf(sellerCard?.querySelector('.seller-desc .inner')), 1200) ||
      extractor.cleanText(textOf(agencyDescription), 1200);
    const pinIcon = sellerCard?.querySelector('svg[data-track-tag="pin_icon"]');
    const location =
      readSellerLocation(sellerCard?.querySelector('.stats-desc ul.user-stats')) ||
      textOf(pinIcon?.closest('[data-track-tag="stack"]')?.nextElementSibling) ||
      null;
    const categories = [
      ...document.querySelectorAll('nav[aria-label="breadcrumbs"] a[href*="/categories/"]'),
    ]
      .map(textOf)
      .filter(Boolean);
    const vettedFor = readVettedFor(sellerCard);

    if (!sellerName || (!sellerBio && !gigTitle)) {
      throw new Error('Fiverr detail data is incomplete. The page structure may have changed.');
    }

    return {
      username: parsed.username,
      fiverrName: extractor.cleanText(sellerName, 200),
      oneLiner,
      profileUrl: parsed.profileUrl,
      gigUrl: parsed.gigUrl,
      gigTitle,
      sellerBio,
      location,
      categories,
      vettedFor,
    };
  }

  console.log('[Hunt-Ex] Fiverr content script loaded');
})();
