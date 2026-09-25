// Pure logic tách riêng khỏi DOM (không nhận Element, chỉ nhận {src, alt}) để unit-test được mà
// không cần jsdom — cùng khuôn UMD với upwork-profile-cleaner.js (content script load qua
// globalThis, test load qua CommonJS require).
//
// SỬA 2026-09-24 (bản đầu SAI): tưởng khối "Associated with {agency}" trên freelancer card là 1
// thẻ <a href="/agencies/{id}">, KHÔNG PHẢI — user gửi HTML thật cho thấy toàn bộ khối chỉ là
// <div> thường, không có href nào. Manh mối thật duy nhất là <img class="air3-avatar-company"
// src=".../org-logo/{id}" alt="{agency name}">. User xác nhận thật (mở thẳng URL) — số trong
// "org-logo/{id}" CHÍNH LÀ agencyId dùng trong URL `/agencies/{id}/`.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.HuntExUpworkAgencyLinks = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Chuẩn hoá 1 src ảnh org-logo thành {agencyId, upworkUrl} — null nếu không khớp pattern thật
  // `/org-logo/{numericId}`. `baseHref` dùng để lấy ĐÚNG origin trang Upwork (www.upwork.com) —
  // KHÔNG lấy origin của chính src ảnh (ảnh nằm ở CDN assets.static-upwork.com, khác domain).
  function parseAgencyLogoSrc(src, baseHref) {
    if (!src) return null;
    let imageUrl;
    let pageUrl;
    try {
      imageUrl = new URL(src, baseHref);
      pageUrl = new URL(baseHref);
    } catch {
      return null;
    }
    const match = imageUrl.pathname.match(/\/org-logo\/(\d+)/);
    if (!match) return null;
    const agencyId = match[1];
    return { agencyId, upworkUrl: `${pageUrl.origin}/agencies/${agencyId}/` };
  }

  // Dedupe theo agencyId (1 agency có thể lặp lại ở nhiều freelancer card trên cùng trang search
  // pt=agency) — giữ agencyName (từ `alt`) gặp đầu tiên. Map giữ thứ tự chèn, đủ dùng làm thứ tự crawl.
  function collectAgencies(images, baseHref) {
    const agencies = new Map();
    for (const { src, alt } of images) {
      const parsed = parseAgencyLogoSrc(src, baseHref);
      if (!parsed) continue;
      if (!agencies.has(parsed.agencyId)) {
        agencies.set(parsed.agencyId, {
          agencyId: parsed.agencyId,
          agencyName: alt || null,
          upworkUrl: parsed.upworkUrl,
        });
      }
    }
    return agencies;
  }

  return { parseAgencyLogoSrc, collectAgencies };
});
