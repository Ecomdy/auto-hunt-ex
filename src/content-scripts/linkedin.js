// Content script cho LinkedIn (trang search post — linkedin.com/search/results/content/?keywords=...).
// Nhận lệnh crawl từ popup, scrape DOM, trả về danh sách lead.
//
// Selector viết từ 2 mẫu HTML thật (Vu Nguyen (Victor), Bradley Walker — 2026-09-22).
// LinkedIn dùng class bị hash theo build (vd "_882cf519", "d356fa4d") nên KHÔNG dựa vào
// class — chỉ bám các điểm ổn định hơn: data-testid, role, componentkey (hậu tố
// "FeedType_FLAGSHIP_SEARCH"), và pattern href ("/in/..."). Nếu LinkedIn đổi build và
// các điểm này cũng đổi, cần gửi lại mẫu HTML mới để cập nhật.
//
// Giới hạn đã biết (chưa xử lý ở v1):
// - Không lấy được permalink riêng của từng post (HTML mẫu không có link đó, các thẻ
//   ảnh/reaction đều trỏ về URL search hiện tại) — dùng url profile tác giả làm "url" lead.
// - Chưa lọc bài "Promoted" (quảng cáo) — chưa có mẫu HTML của loại này.
// - Chỉ scrape những gì đang render sẵn trên trang (không tự cuộn để load thêm).
(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'START_CRAWL') return false;

    try {
      const leads = scrapeCurrentPage(message.keywords || []);
      sendResponse({ ok: true, leads });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
    return true;
  });

  function textOf(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function isDegreeOnlyText(text) {
    return /^[•\s]*\d(st|nd|rd|th)\+?$/i.test(text);
  }

  function getPostCards() {
    let cards = [...document.querySelectorAll('div[role="listitem"][componentkey*="FeedType_FLAGSHIP_SEARCH"]')];
    if (cards.length === 0) {
      cards = [...document.querySelectorAll('[data-testid="lazy-column"] [role="listitem"]')];
    }
    return cards;
  }

  function extractHeadline(card, authorName, postTextEl) {
    for (const p of card.querySelectorAll('p')) {
      if (postTextEl && p.contains(postTextEl)) break; // đã chạm phần nội dung post, dừng
      if (p.querySelector('svg')) continue; // dòng badge/timestamp có icon
      const text = textOf(p);
      if (!text || text === authorName || isDegreeOnlyText(text)) continue;
      return text;
    }
    return '';
  }

  function extractCard(card) {
    const profileLink = card.querySelector('a[href*="linkedin.com/in/"]');
    if (!profileLink) return null; // không xác định được tác giả -> bỏ qua, không actionable

    const authorUrl = profileLink.href;
    const authorName = textOf(card.querySelector('a[href*="linkedin.com/in/"] p > span'));

    const postTextEl = card.querySelector('[data-testid="expandable-text-box"]');
    const postText = textOf(postTextEl);

    const globeSvg = card.querySelector('svg[id="globe-americas-small"]');
    const timeP = globeSvg ? globeSvg.closest('p') : null;
    const postedAt = timeP ? textOf(timeP).split('•')[0].trim() || null : null;

    const headline = extractHeadline(card, authorName, postTextEl);

    return {
      platform: 'linkedin',
      title: authorName || '(unknown name)',
      url: authorUrl,
      snippet: [headline, postText].filter(Boolean).join(' — '),
      postedAt,
      extractedAt: new Date().toISOString(),
    };
  }

  function scrapeCurrentPage(_keywords) {
    return getPostCards()
      .map(extractCard)
      .filter(Boolean);
  }
})();
