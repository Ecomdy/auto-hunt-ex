# Hunt-Ex

Chrome extension (Manifest V3) giúp team marketing Ecomdy tìm khách hàng tiềm năng
trên LinkedIn, Upwork, Fiverr. Không có bundler/build step — mọi file JS chạy thẳng
như viết ra (giữ đơn giản, dễ debug qua `chrome://extensions`).

## Kiến trúc

```
manifest.json
src/
  background/           # service worker (ES module, "type": "module")
    background.js        # message router: ANALYZE_INTENT / ANALYZE_PROFILE / ANALYZE_AGENCY /
                           # ANALYZE_FIVERR / SAVE_LEADS / GET_LEADS / CLEAR_LEADS / GET_API_KEY_STATUS /
                           # SAVE_API_KEY / TEST_API_KEY (3 message cuối, 2026-09-25 — xem mục "OpenAI
                           # API key"; cả 3 nhận thêm `provider` từ 2026-09-28, xem "Research provider").
                           # Model OpenAI hardcode thẳng ở đây (const GPT_MODEL), không còn đọc từ file
                           # config nào nữa. ANALYZE_PROFILE/AGENCY/FIVERR (2026-09-28) tự dispatch
                           # OpenAI hay Exa qua requireResearchApiKey() theo research provider đang chọn.
    ai/key-tester.js      # testApiKey() — gọi GET /v1/models để kiểm tra 1 OpenAI key còn dùng được
                           # không, KHÔNG tốn token (khác intent/profile/agency/fiverr-analyzer.js đều
                           # gọi /v1/responses thật). testExaApiKey() (2026-09-28) — cùng việc cho Exa,
                           # gọi GET /agent/runs?limit=1 (Exa không có endpoint account-info/models sạch
                           # tương đương, xem mục "Research provider"). Dùng cho nút "Test key" (side
                           # panel lúc onboarding + Settings lúc đổi key). Tự chứa, không import gì.
    ai/intent-analyzer.js # gọi thẳng OpenAI Responses API (fetch từ browser) — LUÔN OpenAI, không đổi
                           # theo research provider (xem mục "Research provider" — bước này không search
                           # web nên không nằm trong lựa chọn OpenAI/Exa).
    ai/profile-analyzer.js # phân tích 1 profile Upwork (freelancer) đã crawl -> tìm contact info công khai
                           # (tool web_search, tool_choice: 'required') — xem TODO cuối file (tool
                           # web_search_preview cũ đã verify live, bản web_search mới CHƯA re-verify).
                           # Thêm analyzeProfileWithExa() (2026-09-28) — nhánh Exa.ai, gộp pipeline
                           # 2 stage OpenAI (identity rồi contact) thành 1 lần gọi Exa Agent duy nhất,
                           # tái dùng validateIdentity()/validateContact()/buildFinalResult() nguyên vẹn
                           # (provider-agnostic, chỉ đọc JSON đã parse). Xem mục "Research provider".
    ai/agency-analyzer.js # y hệt profile-analyzer.js nhưng cho AGENCY (2026-09-24) — CÙNG 1 output
                           # schema với freelancer (theo yêu cầu user, xem TODO cuối CLAUDE.md), tự chứa
                           # (KHÔNG import chung với profile-analyzer.js — lý do xem comment đầu file:
                           # test load qua data: URL base64, import tương đối từ đó sẽ vỡ). Thêm
                           # analyzeAgencyWithExa() (2026-09-28) — xem mục "Research provider".
    ai/fiverr-analyzer.js  # phân tích 1 Fiverr seller đã crawl (2026-09-25) — mô phỏng agency-analyzer.js
                           # (1 stage, input thưa tương tự: name/bio/location/service), CÙNG output
                           # schema, tự chứa. source: 'fiverr', type: 'freelancer'. Xem TODO cuối CLAUDE.md.
                           # Thêm analyzeFiverrSellerWithExa() (2026-09-28) — xem mục "Research provider".
    leads/               # Repository pattern — swap local <-> backend không sửa code gọi
      lead-repository.js         # factory, đọc setting huntexLeadStorageMode
      local-lead-repository.js   # chrome.storage.session (mặc định, dùng để test — user yêu cầu
                                 # 2026-09-23: KHÔNG lưu đĩa, tự mất khi đóng trình duyệt/tắt-reload
                                 # extension, không cần bấm "Clear all" tay mỗi lần test)
      remote-lead-repository.js  # gọi backend CRM nội bộ — CHƯA CÓ endpoint thật, đang stub
  content-scripts/       # classic script (KHÔNG phải ES module — content script không hỗ trợ import)
    linkedin.js           # ĐÃ implement thật cho trang search post (linkedin.com/search/results/content/)
                           # — viết + kiểm chứng từ HTML mẫu thật (2026-09-22). Xem TODO/giới hạn trong file.
    upwork.js             # ĐÃ implement thật cho trang search TALENT (freelancer), KHÔNG phải search
                           # job nữa (thay thế hoàn toàn 2026-09-23) — upwork.com/nx/search/talent?q=...
                           # — viết + kiểm chứng từ HTML mẫu thật (2026-09-23). Selector card ưu tiên
                           # id="talent-tile-{id}" (không hash theo build) + [data-test] cho field con.
                           # Đã thêm bước click mở modal chi tiết profile -> gửi AI phân tích contact
                           # công khai (2026-09-23) — verify THẬT bằng chạy live, xem TODO cuối file.
                           # Thêm AGENCY FLOW (2026-09-24, pt=agency): DISCOVER_AGENCIES quét link
                           # "Associated with" agency trên trang search (KHÔNG mở modal). EXTRACT_AGENCY_
                           # DETAIL (trang chi tiết agency) CHƯA implement — đang chờ HTML mẫu thật, xem
                           # TODO cuối CLAUDE.md. Vòng lặp điều hướng qua từng agency nằm ở popup.js
                           # (crawlAgencies()), khác freelancer (vòng lặp nằm trong chính content script).
    upwork-agency-links.js # pure, có unit test (tests/upwork-agency-links.test.cjs) — parse/normalize/
                           # dedupe link agency từ href thô, tách khỏi DOM để test không cần jsdom. Cùng
                           # khuôn UMD với upwork-profile-cleaner.js.
    fiverr.js             # ĐÃ implement thật (2026-09-24/25): search-list card + gig detail page,
                           # cả 2 selector xác nhận từ HTML mẫu thật. Message DISCOVER_FIVERR_SELLERS/
                           # EXTRACT_FIVERR_DETAIL/STOP_CRAWL. Xem TODO cuối CLAUDE.md cho chi tiết
                           # field, bug đã gặp lúc chạy live, và pipeline AI (fiverr-analyzer.js).
    fiverr-extractor.js    # pure, UMD giống upwork-agency-links.js — parse gig URL, dedupe seller,
                           # phát hiện block/CAPTCHA. CHƯA có unit test riêng (khác quy ước file UMD
                           # khác), xem TODO cuối CLAUDE.md.
  popup/                 # UI chính, hiển thị dưới dạng SIDE PANEL (không phải popup dropdown — xem bên dưới)
                           # nhập mô tả khách hàng -> AI phân tích -> crawl -> xem/xuất lead. Mở panel lần
                           # đầu (chưa lưu key của research provider đang chọn) -> chặn ở `#apikey-view`
                           # trước cả `#home-view`, xem mục "OpenAI API key" + "Research provider".
  options/                # Settings — chọn Research provider (OpenAI/Exa.ai) + nhập/đổi key tương ứng
                           # (nút "Test key" riêng) VÀ cấu hình nơi lưu lead (mode local/remote). Trước
                           # 2026-09-25 KHÔNG có ô API key nào (key nạp sẵn qua .env lúc build); trước
                           # 2026-09-28 chỉ có đúng 1 provider (OpenAI) — xem mục "OpenAI API key" +
                           # "Research provider" cho lý do đổi.
  shared/
    platforms.js          # registry platform (dùng ở background + popup, KHÔNG dùng trong content script)
                           # mỗi platform có searchUrlTemplate — null nghĩa là CHƯA xác nhận URL search
                           # thật, buildSearchUrl() sẽ throw rõ ràng thay vì đoán URL. supportsLocation:
                           # true (hiện chỉ Upwork) -> buildSearchUrl() nhận thêm param location, tự
                           # kebab-case rồi gắn `&loc=...` (xác nhận thật param `loc` qua URL user gửi
                           # 2026-09-23, chỉ mới verify case "United States"). noKeywordFilter: true
                           # (hiện chỉ Upwork) -> popup ẩn 2 ô "Relevant keywords"/"Exclude keywords"
                           # và không filter lead sau crawl (quyết định 2026-09-23) — LinkedIn vẫn giữ
                           # nguyên filter này. directSearch: true (hiện chỉ Upwork) -> popup ẩn hẳn
                           # bước "Analyze with AI" (mô tả tự nhiên -> AI diễn giải), user gõ thẳng câu
                           # search vào ô search-query rồi bấm Auto-hunt luôn (quyết định 2026-09-23).
    api-key-store.js      # get/setOpenAiApiKey()/get/setExaApiKey() qua chrome.storage.sync — nguồn
                           # sự thật DUY NHẤT cho API key của từng provider (2026-09-25, đổi tên hàm
                           # 2026-09-28 khi thêm Exa — trước đó tên get/setApiKey() vì chỉ có OpenAI).
                           # get/setResearchProvider() (2026-09-28) — provider đang chọn cho phần
                           # research (contact-finding), mặc định 'openai'. Trước `api-key-store.js`
                           # là `shared/config.js` (đã xoá). Xem mục "Research provider".
```

## OpenAI API key

**Lịch sử (đến 2026-09-24):** nguồn sự thật là `.env` ở root (gitignore) -> `node
scripts/gen-config.mjs` sinh `src/shared/config.js` (cũng gitignore) -> `background.js` import
key từ đó. Người build chạy 2 bước này 1 lần trước khi đóng gói extension phân phối cho
marketing team — team không tự nhập key.

**Đổi hẳn sang nhập qua UI (2026-09-25, theo yêu cầu user):** marketing team tự cài extension
(Load unpacked hoặc file .zip nội bộ) và **không tự tạo được file `.env`** — luồng cũ đòi hỏi có
người build làm hộ 2 bước trên mỗi lần key hết hạn/đổi máy, không scale cho việc tự phân phối.
Bỏ hẳn `.env`/`scripts/gen-config.mjs`/`src/shared/config.js` (3 file này đã xoá khỏi repo — xem
git log nếu cần đối chiếu code cũ). Key giờ do chính user (marketing hoặc dev) nhập trực tiếp
trên giao diện, lưu qua `chrome.storage.sync` (`src/shared/api-key-store.js`, key
`huntexOpenAiApiKey` — cùng cơ chế `huntexBackendApiKey` đã có sẵn ở `remote-lead-repository.js`,
KHÔNG dùng `chrome.storage.session` vì đây là config cần giữ lâu dài, khác leads/cache vốn cố ý
tự mất khi đóng trình duyệt).

Model OpenAI (`gpt-5.6-terra`) thì NGƯỢC LẠI — **không** đưa lên UI cho user chọn (quyết định
user 2026-09-25: "thống nhất dùng model này cho tất cả"). Hardcode thẳng thành `const GPT_MODEL`
trong `background.js`, đổi tên từ `UPWORK_GPT_MODEL` (biến `.env` cũ, tên lịch sử từ lúc chỉ
Upwork dùng — hết lý do giữ tên cũ sau khi bỏ `.env`).

2 điểm chạm chính:

1. **Onboarding (side panel, lần đầu chưa có key)** — `popup.js`/`popup.html`: mở panel ->
   `initView()` gọi `GET_API_KEY_STATUS`; chưa có key -> hiện `#apikey-view` (chặn cả `#home-view`
   lẫn `#leads-section`, xem `showApiKeyGate()`) thay vì hiện luôn danh sách platform. Nút "Save &
   test key" gọi `TEST_API_KEY` trước — **CHỈ lưu (`SAVE_API_KEY`) nếu test pass** — tránh lưu
   nhầm key gõ sai rồi phát hiện ra lỗi mơ hồ hơn nhiều lúc bấm Auto-hunt (401 gốc từ OpenAI).
2. **Settings (`options/`, đổi key sau này)** — `options.html`/`options.js`: ô `apikey-input` dùng
   chung vòng load()/save-btn generic đã có sẵn cho `storage-mode`/`backend-url`/`backend-key`
   (thêm 1 dòng vào `FIELDS`, không cần code riêng) — nút "Save" ở đây lưu TRỰC TIẾP, không bắt
   buộc test trước (khác onboarding) vì đây không phải lần đầu, user có thể đang thao tác nhiều
   field cùng lúc. Nút "Test key" riêng, độc lập với Save, test đúng giá trị đang gõ trong ô
   (chưa cần bấm Save trước) — dùng khi nghi ngờ key hết hạn/hết quota mà không muốn gõ lại.

Message contract (`background.js`, xem comment đầu file):
`GET_API_KEY_STATUS` -> `{hasKey}` (không trả key thật ra ngoài background — popup chỉ cần biết
có/không để quyết định hiện view nào); `SAVE_API_KEY {apiKey}` -> `{saved: true}`; `TEST_API_KEY
{apiKey?}` -> `{ok, error?}` (bỏ trống `apiKey` thì test đúng key đang lưu trong storage, dùng
cho nút Test key ở Settings không kèm giá trị mới). Cả `ANALYZE_INTENT`/`ANALYZE_PROFILE`/
`ANALYZE_AGENCY`/`ANALYZE_FIVERR` đều gọi `requireApiKey()` (throw lỗi rõ ràng, trỏ user quay lại
panel nhập key) trước khi gọi OpenAI — không còn import `OPENAI_API_KEY` tĩnh lúc module load.
`src/background/ai/key-tester.js` (`testApiKey()`) gọi `GET /v1/models` (không phải
`/v1/responses`) để xác thực key mà KHÔNG tốn token — dùng chung cho cả 2 điểm chạm trên qua
`TEST_API_KEY`. Test: `tests/key-tester.test.mjs` (401/lỗi khác/network error), `tests/
api-key-store.test.mjs` (round-trip get/set qua chrome.storage.sync mock).

Gọi thẳng `https://api.openai.com/v1/responses` (và `/v1/models` cho key-tester.js) từ background
— không cần header CORS đặc biệt như Anthropic, vì extension đã khai báo `host_permissions` cho
`api.openai.com` trong `manifest.json` (extension có host_permissions thì fetch cross-origin
không bị CORS chặn, khác với 1 trang web thường; host_permissions áp dụng theo origin nên
`/v1/models` dùng chung quyền với `/v1/responses`, không cần khai báo thêm).

Lưu ý bảo mật KHÔNG đổi so với cách cũ: key vẫn nằm plaintext trên máy — trước đây trong
`config.js` sinh sẵn, giờ trong `chrome.storage.sync` (đồng bộ qua tài khoản Google Chrome của
chính user, Google mã hoá lúc truyền/lưu nhưng KHÔNG phải bảo mật cấp server — vẫn là 1 client
tự giữ key, không tương đương biến môi trường phía server, không bao giờ rời máy/tài khoản
Chrome của user). Nếu cần bảo mật hơn: chuyển gọi OpenAI qua backend nội bộ Ecomdy (khi có) thay
vì gọi thẳng từ extension.

## Research provider: OpenAI vs Exa.ai

**Thêm 2026-09-28 (theo yêu cầu user):** trước đây phần "research" (tìm public contact info cho
freelancer/agency/Fiverr seller — 3 message `ANALYZE_PROFILE`/`ANALYZE_AGENCY`/`ANALYZE_FIVERR`)
CHỈ dùng OpenAI. Giờ user chọn được 1 trong 2 provider — OpenAI (GPT) hoặc **Exa.ai** (Agent API,
`POST https://api.exa.ai/agent/runs`) — nhập key tương ứng, extension tự dùng đúng provider đó cho
cả 3 luồng research. Đây là lựa chọn **toàn cục** (1 provider active tại 1 thời điểm cho cả
Upwork freelancer/agency lẫn Fiverr), không phải theo từng platform.

**`ANALYZE_INTENT` (mô tả khách hàng -> search query, dùng cho LinkedIn) KHÔNG nằm trong lựa chọn
này** — bước đó không gọi web search (chỉ diễn giải câu mô tả), nên LUÔN dùng OpenAI bất kể research
provider đang chọn là gì (`requireOpenAiApiKey()` riêng trong `background.js`, tách khỏi
`requireResearchApiKey()`). Hệ quả: user chỉ nhập key Exa (không có key OpenAI) vẫn dùng được Upwork/
Fiverr, nhưng LinkedIn (platform duy nhất còn dùng `ANALYZE_INTENT`) sẽ báo lỗi rõ ràng yêu cầu nhập
thêm key OpenAI — đã ghi rõ trong hint text của `#apikey-view` (popup) và `options.html`.

### Lưu trữ + message contract

`src/shared/api-key-store.js`: 2 storage key riêng biệt (`huntexOpenAiApiKey`/`huntexExaApiKey`,
đều qua `chrome.storage.sync`, đổi provider qua lại không mất key kia) + 1 storage key chọn provider
đang active (`huntexResearchProvider`, giá trị `'openai'`/`'exa'`, mặc định `'openai'` nếu chưa từng
chọn — giữ nguyên hành vi cho user đã có sẵn key OpenAI từ trước bản Exa này).

`background.js` message contract đổi (xem comment đầu file):
- `GET_API_KEY_STATUS` -> `{provider, hasKey}` (trước đây chỉ `{hasKey}`) — `hasKey` là của ĐÚNG
  provider đang chọn. Panel dùng để quyết định hiện `#apikey-view` hay `#home-view`, VÀ chọn sẵn
  đúng radio provider trong gate (`setApiKeyProviderView()`).
- `SAVE_API_KEY {provider, apiKey}` -> lưu key cho `provider` VÀ đặt luôn `provider` đó làm research
  provider đang dùng — chọn provider nào lúc lưu key nghĩa là dùng luôn provider đó (đúng flow user
  mô tả: "chọn cái nào thì cho nhập token tương ứng rồi triển khai theo flow thôi").
- `TEST_API_KEY {provider?, apiKey?}` -> `provider` bỏ trống thì dùng provider đang lưu; `apiKey` bỏ
  trống thì test đúng key đang lưu của provider đó.

`requireResearchApiKey()` (background.js) đọc provider đang chọn + key tương ứng, throw lỗi rõ ràng
nếu thiếu key (tên provider trong message lỗi). 3 handler `ANALYZE_PROFILE`/`ANALYZE_AGENCY`/
`ANALYZE_FIVERR` gọi hàm này rồi dispatch `analyze*()` (OpenAI) hoặc `analyze*WithExa()` (Exa) theo
`provider` trả về. Cache freelancer (`profile-research-cache.js`) dùng `EXA_MODEL_ID = 'exa-agent'`
thay `GPT_MODEL` làm 1 phần cache key khi provider là Exa — đổi qua lại 2 provider không lẫn cache.

### UI

- **Onboarding** (`popup.html`/`popup.js`, `#apikey-view`): thêm radio "OpenAI (GPT)"/"Exa.ai" phía
  trên 2 ô input (`#openai-key-fields`/`#exa-key-fields`, ẩn/hiện theo radio qua
  `setApiKeyProviderView()`) — chỉ CẦN NHẬP ĐÚNG 1 KEY của provider đã chọn, không bắt buộc cả 2. Nút
  "Save & test key" giữ nguyên hành vi cũ (test trước, chỉ lưu nếu pass) nhưng giờ gửi kèm `provider`.
- **Settings** (`options.html`/`options.js`): thêm `<select id="research-provider">` (tái dùng đúng
  vòng `load()`/generic `FIELDS` đã có, thêm 3 dòng: `research-provider`/`apikey-input`/
  `exa-apikey-input` — không cần code riêng, đúng quy ước cũ). Đổi `<select>` -> ẩn/hiện đúng khối
  key tương ứng qua `updateProviderFieldsVisibility()`. Nút "Test key" đọc `provider` từ `<select>`
  hiện tại (không phải provider đã lưu) + giá trị đang gõ trong ô tương ứng — cho phép test 1 provider
  trước khi quyết định chuyển hẳn sang nó.

### Exa Agent API — cơ chế + quyết định thiết kế

Research kỹ trước khi code (đọc `exa-spec.yaml`, `quickstart`/`best-practices` chính thức Exa +
live-test vài request thật với key sai, 2026-09-28) vì user yêu cầu không đoán:

- **Bất đồng bộ, KHÔNG dùng SSE**: `POST /agent/runs` (header `x-api-key`, body `{query,
  outputSchema, effort}`, KHÔNG gửi `Accept: text/event-stream`) trả về NGAY `{id, status: 'queued'|
  'running'}` — chưa phải kết quả cuối. Phải `GET /agent/runs/{id}` lặp lại (poll mỗi 4s, timeout
  tổng 120s) tới khi `status` là `completed`/`failed`/`cancelled`. Chọn nhánh non-streaming vì service
  worker MV3 tự parse SSE thủ công phức tạp hơn hẳn poll JSON thường, và poll GET không tính vào giới
  hạn QPS (5 QPS/50 concurrent run cho riêng `/agent/runs`, theo doc billing).
- **`outputSchema` là JSON Schema chuẩn** — tái dùng NGUYÊN các schema nội bộ đã có sẵn cho OpenAI
  Structured Outputs (`OUTPUT_SCHEMA` ở agency/fiverr-analyzer.js) mà không cần định nghĩa lại.
  Lưu ý: Exa có thể trả `null` cho field dù đánh dấu `required` trong schema (không "strict" như
  OpenAI) — vô hại vì `normalizeResearchResult()`/`validateIdentity()`/`validateContact()` vốn đã
  null-safe cho mọi field.
- **`effort: 'medium'`** — theo khuyến nghị chính thức Exa cho "standard single-entity research"
  (đúng loại việc đang làm: xác minh + tìm contact 1 freelancer/agency/seller), áp dụng thống nhất
  cho cả 3 luồng, KHÔNG lên UI cho user chọn (cùng tinh thần `GPT_MODEL` không lên UI).
- **KHÔNG có domain/location filter cứng cho Agent API** (khác hẳn OpenAI web_search's
  `filters.allowed_domains`/`blocked_domains`/`user_location` — xác nhận qua đọc hết
  `exa-spec.yaml`/docs, không có param nào tương đương). Bù lại bằng 2 lớp:
  1. Soft instruction trong `query` ("Do not search or cite upwork.com"/"...fiverr.com").
  2. Lớp phòng thủ cứng `stripUpworkUrl()`/`stripFiverrUrl()` (agency/fiverr-analyzer.js) — tự strip
     bất kỳ URL nào trỏ về chính platform nguồn khỏi kết quả, bất kể model có tuân theo soft
     instruction hay không. `profile-analyzer.js` không cần thêm hàm riêng vì `normalizeUrl()` (dùng
     chung cho cả 2 provider) đã strip `upwork.com` từ trước.
- **Test key** (`testExaApiKey()`, `key-tester.js`): Exa KHÔNG có endpoint account-info/models sạch
  tương đương OpenAI's `GET /v1/models` (đã thử `/v0/teams/me` theo doc — path thật lệch khỏi doc,
  không dùng được; Team Management API cần loại key riêng khác hẳn, không hợp cho user thường). Dùng
  `GET /agent/runs?limit=1` (list run) thay thế — cùng auth, KHÔNG tạo run mới nên không tốn phí, 200
  nghĩa là key hợp lệ. Phân biệt rõ 3 mã lỗi: 401 (key sai), 402 (key đúng nhưng hết credit/budget),
  429 (rate limit, key có thể vẫn đúng).
- **Freelancer: gộp pipeline 2 stage (OpenAI) thành 1 run duy nhất cho Exa.** OpenAI's `web_search`
  tool bị giới hạn cứng bởi `max_tool_calls`, nên phải tách identity/contact thành 2 request riêng,
  mỗi request ép đúng 1 query code tự dựng. Exa Agent KHÔNG có giới hạn kiểu đó — 1 run tự lên kế
  hoạch và chạy nhiều bước search bên trong (đúng bản chất "agent"), nên `analyzeProfileWithExa()`
  gộp identity + contact vào ĐÚNG 1 `query` (`EXA_INSTRUCTIONS`, 2 bước diễn giải bằng lời: "Step 1
  identity... Step 2 contact (chỉ chạy nếu Step 1 verified)...") + 1 `outputSchema` gộp (`EXA_SCHEMA`
  = union field của `IDENTITY_SCHEMA`+`CONTACT_SCHEMA`) — rẻ hơn (1 run thay vì tối đa 4 request
  OpenAI) và tự nhiên hơn với cách Exa Agent hoạt động. `validateIdentity()`/`validateContact()`/
  `buildFinalResult()` HOÀN TOÀN không đổi (provider-agnostic, chỉ đọc JSON đã parse theo field name)
  — cùng ngưỡng verify chặt y hệt OpenAI (2+ signal hiếm hoặc direct external-link match, contact
  source phải khớp identity đã verify). `search_queries` (field OpenAI-only, ép `web_search` tool
  chạy đúng 1 câu) bị loại khỏi candidate JSON gửi Exa — Exa tự lên chiến lược search, không nên nhận
  field này (tránh model hiểu lầm phải chạy đúng các query đó thay vì tự tìm cách tốt nhất).
- **Retry-khi-rỗng/chưa-verify đúng 1 lần** — agency/fiverr retry khi `isEmptyResult()`; freelancer
  retry khi identity chưa `verified` — CÙNG tinh thần cơ chế đã có cho OpenAI (sampling variance),
  áp dụng phòng ngừa trước cho Exa dù CHƯA verify live để biết Exa có cùng vấn đề variance hay không.
- **Chi phí**: `result.token_usage = null` cho nhánh Exa (Exa không có khái niệm token — billing
  theo Agent Compute Unit/search-call/effort cố định, xem `exa.ai/docs/admin/pricing`) — thay vào đó
  `result.exa_usage`/`result.exa_cost` giữ NGUYÊN object `usage`/`costDollars` Exa trả về, log kèm
  console vì CHƯA verify live nên chưa biết chắc shape chính xác từng field con.

### CHƯA verify live

Toàn bộ nhánh Exa (`analyzeProfileWithExa`/`analyzeAgencyWithExa`/`analyzeFiverrSellerWithExa`,
`testExaApiKey`, UI onboarding/Settings) mới chỉ chạy qua `node --test` với `fetch` mock — CHƯA gọi
Exa API thật bằng key thật. Cần user tự nhập 1 Exa API key thật rồi chạy Auto-hunt Upwork/Fiverr với
Exa được chọn để xác nhận: request/response thật đúng như research (đặc biệt shape `usage`/
`costDollars`, số vòng poll thực tế mất bao lâu cho 1 run effort medium), soft no-domain-instruction
có đủ hiệu quả không (hay phải dựa hoàn toàn vào lớp `stripUpworkUrl`/`stripFiverrUrl`), và hit-rate/
chi phí thực tế so với OpenAI (`gpt-5.6-terra`) trên cùng 1 batch lead để so sánh — xem TODO cuối file.

## UI: Side Panel, không phải popup

`src/popup/popup.html` được khai báo trong manifest là `side_panel.default_path`, KHÔNG phải
`action.default_popup`. Lý do: popup (`default_popup`) tự đóng ngay khi mất focus (chuyển tab,
click ra ngoài...) — phá luồng "phân tích -> chuyển sang tab LinkedIn -> crawl" vì phải chuyển
tab giữa chừng. Side panel ở lại nguyên trạng khi chuyển tab trong cùng cửa sổ, nên dùng side
panel cho đúng luồng. `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})` trong
`background.js` làm cho click icon extension mở side panel thay vì dropdown. Thư mục vẫn tên
`popup/` (không đổi tên để giảm diff) nhưng về hành vi runtime nó là 1 side panel.

## UI: chọn platform trước (home view)

Mở panel -> thấy 3 nút LinkedIn/Upwork/Fiverr (`#home-view` trong `popup.html`) -> bấm 1 nút ->
`enterPlatformView(key)` chuyển sang `#platform-view` (form mô tả + phân tích + crawl), lưu
`currentPlatform` (object từ `PLATFORMS`) làm state cho toàn bộ thao tác sau đó. Nút "← Chọn nền
tảng khác" quay lại home, reset `currentPlatform = null`. Danh sách lead ở dưới cùng là GLOBAL
(hiện tất cả lead mọi platform, không lọc theo `currentPlatform`).

## Luồng dữ liệu (trong 1 platform view)

Bước 1 (analyze) chỉ áp dụng cho platform KHÔNG có `directSearch: true`. Upwork có `directSearch:
true` (quyết định 2026-09-23) -> bỏ hẳn bước phân tích AI, `#analyze-section` ẩn, `#keywords-section`
hiện ngay khi vào view — user gõ thẳng câu search vào `search-query`, điền `location` nếu muốn, rồi
bấm Auto-hunt/crawl thẳng (nhảy xuống bước 2).

1. Panel: user nhập mô tả khách hàng (tiếng Việt hoặc Anh đều được) -> `ANALYZE_INTENT` (kèm
   `platformLabel: currentPlatform.label` để prompt AI đúng ngữ cảnh platform) -> background gọi
   OpenAI API -> trả về `{searchQuery, keywords, excludeKeywords, notes}`. Prompt trong
   `intent-analyzer.js` (`buildInstructions()`) yêu cầu AI trả lời 100% bằng tiếng Anh cho cả 4
   field, bất kể input là ngôn ngữ gì — vì nội dung trên LinkedIn/Upwork/Fiverr đều bằng tiếng Anh,
   search/filter bằng tiếng Anh mới match được kết quả thật (đã verify bằng request thật, 2026-09-22).
   `searchQuery` = câu ngắn để gõ vào ô search; `keywords`/`excludeKeywords` chỉ dùng để LỌC kết quả
   sau khi crawl, không dùng để search.
2a. **Auto-hunt** (nút chính, `autoHunt()` trong `popup.js`): `buildSearchUrl(currentPlatform, searchQuery, location)`
    (từ `shared/platforms.js`, throw rõ ràng nếu platform chưa có `searchUrlTemplate` xác nhận — hiện
    LinkedIn và Upwork đã có, Fiverr chưa; `location` chỉ áp dụng nếu `platform.supportsLocation`)
    -> `chrome.tabs.create()` mở tab mới với URL đó -> chờ tab load xong
    (`chrome.tabs.onUpdated`, timeout 20s) -> gửi `START_CRAWL` cho content script của tab đó (retry
    tối đa 4 lần cách nhau 1.5s nếu chưa có lead — bù thời gian SPA render) -> lọc theo
    `keywords`/`excludeKeywords` (`filterLeads()`).
2b. **Crawl thủ công** (nút phụ, chỉ bật khi tab đang active TRÙNG `currentPlatform` và đã implement):
    gửi `START_CRAWL` thẳng tới content script của tab đang active (không qua background), cũng áp
    `filterLeads()` trước khi lưu — dùng khi user tự mở sẵn 1 trang search cụ thể muốn crawl nguyên trạng.
3. Panel gửi `SAVE_LEADS` cho background -> lưu qua `lead-repository` (local mặc định).
4. Panel đọc `GET_LEADS` để hiển thị + xuất CSV.

Lead shape dùng xuyên suốt: `{ platform, title, url, snippet, postedAt, extractedAt }`.

## Thêm platform mới (hoặc hoàn thiện Upwork/Fiverr)

1. Xác nhận URL search thật: tự search trên platform đó, copy URL kết quả -> điền vào
   `searchUrlTemplate` trong `src/shared/platforms.js` (đặt `{q}` ở chỗ query — xem cách LinkedIn làm).
   KHÔNG đoán URL, kể cả pattern "ai cũng biết" — luôn xin URL thật từ user trước.
2. Xác nhận selector DOM thật: xin 2-3 mẫu HTML của TỪNG CARD kết quả (không phải nguyên trang, không
   phải thanh filter/search) -> viết `scrapeCurrentPage()` trong content script tương ứng, ưu tiên
   `data-testid`/`role`/attribute ngữ nghĩa hơn class (nhất là platform dùng CSS-in-JS/atomic class
   dễ đổi theo build).
3. Set `implemented: true` trong `platforms.js` khi cả 2 bước trên xong.
4. Thêm `content_scripts` entry tương ứng trong `manifest.json` (`matches` đúng domain) — nếu chưa có.
5. Nếu crawl qua API thay vì DOM: thêm host vào `host_permissions`, viết logic fetch trong background
   (chưa có pattern sẵn cho case này — hỏi trước khi tự chế endpoint).

## Ràng buộc quan trọng — ĐỪNG tự chế

- **Selector DOM**: LinkedIn search post (`linkedin.js`, dựa trên `data-testid`/`role`/`componentkey`
  — KHÔNG dùng class hash vì LinkedIn đổi theo build) và Upwork search talent (`upwork.js`, dựa trên
  `id="talent-tile-{id}"` + `[data-test]` cho field con — design system "air3" của Upwork ổn định hơn,
  không hash theo build) đã có. Fiverr và các loại trang LinkedIn khác (Jobs search, Sales Navigator...)
  chưa có — luôn hỏi người dùng cung cấp HTML mẫu thật của TỪNG CARD kết quả (không phải trang
  filter/search bar) trước khi viết selector, không đoán class/cấu trúc.
- **UI 100% tiếng Anh**: mọi text hiển thị cho user (label, button, placeholder, status/error message
  trong popup/options) phải bằng tiếng Anh (quyết định 2026-09-23) — kể cả string fallback dùng làm
  lead title (vd `'(unknown name)'`). Comment code + CLAUDE.md vẫn tiếng Việt như trước (tài liệu dev,
  không phải UI). AI prompt (`intent-analyzer.js`) đã yêu cầu output tiếng Anh từ trước, không đổi gì thêm.
- **URL search**: LinkedIn và Upwork có `searchUrlTemplate` xác nhận thật trong `platforms.js`. Fiverr
  đang `null` — `buildSearchUrl()` sẽ throw lỗi rõ ràng thay vì tự đoán URL (kể cả pattern quen thuộc).
- **Backend/CRM nội bộ Ecomdy**: chưa có endpoint/schema thật. `remote-lead-repository.js` đang stub.
  Không tự bịa URL hay payload schema.
- Model OpenAI: CHỈ 1 hằng số duy nhất `GPT_MODEL` trong `background.js` cho TOÀN BỘ extension —
  hardcode trong code, KHÔNG lên UI cho user chọn (quyết định user 2026-09-25: "thống nhất dùng
  model này cho tất cả", cùng lúc bỏ `.env`/`config.js`, xem mục "OpenAI API key" + TODO cuối file).
  Trước 2026-09-25 là biến `.env` tên `UPWORK_GPT_MODEL` (tên lịch sử từ lúc chỉ Upwork dùng, rồi
  gộp chung cho cả extension 2026-09-24) — đã đổi tên thành `GPT_MODEL` nhân tiện lúc bỏ `.env`,
  không còn ràng buộc phải giữ tên cũ. Hiện dùng `gpt-5.6-terra` (model reasoning, PHẢI hỗ trợ
  `web_search` + `reasoning.effort` + Structured Outputs — không phải model non-reasoning như
  `gpt-4.1` cũ). Vì `intent-analyzer.js` không cần reasoning (không tool call, không judgement phức
  tạp) nên set cứng `reasoning: { effort: 'none' }` cho riêng request đó để không tốn thêm
  token/latency so với lúc còn dùng `gpt-4.1` riêng — 3 file kia (profile/agency/fiverr) vẫn tự
  chọn effort theo nhu cầu từng stage (`medium` cho identity, `low` cho contact/agency/fiverr).
  Agency flow whitelist input OpenAI còn đúng `name`, `description`, `location`, `service`, dùng
  Structured Outputs và tối đa 1 lượt web search để kiểm soát token; freelancer flow vẫn tối đa 2
  lượt. Đổi model: sửa thẳng `const GPT_MODEL` trong `background.js`, reload extension.

## Quy ước code

- Background/panel (popup)/options: ES module (`import`/`export`), vì các context này hỗ trợ `type="module"`.
- Content script: IIFE thường (`(function(){...})()`), KHÔNG import — content script MV3 không load được ES module qua khai báo tĩnh trong `content_scripts`.
- Không dùng framework/bundler. Thêm dependency mới phải có lý do rõ ràng.

## Dev hook

`.claude/hooks/check-js.mjs` chạy `node --check` sau mỗi lần Edit/Write file `.js`
(xem `.claude/settings.json`), bắt lỗi cú pháp ngay thay vì phải reload extension mới thấy.

## TODO đang chờ input từ user

- [x] Selector LinkedIn search post — xong (2026-09-22).
- [x] Auto-hunt (tự mở tab LinkedIn + search + crawl + lọc excludeKeywords) — xong (2026-09-22).
- [x] Lọc theo `keywords` (relevance) — xong (2026-09-22): lead phải chứa ít nhất 1 keyword, không thì
      bị bỏ (`filterLeads()` trong popup.js). Rủi ro đã biết: 1 từ vừa nằm trong `keywords` vừa vô tình
      trùng nghĩa với `excludeKeywords` (vd "freelance") có thể loại nhầm lead tốt — user tự sửa 2 ô
      này trước khi bấm auto-hunt nếu thấy AI sinh exclude quá tay.
- [ ] Auto-scroll để crawl nhiều hơn số lead đang hiển thị sẵn trên màn hình (hiện chỉ lấy những gì
      đã render, không tự cuộn load thêm).
- [ ] Permalink riêng của từng LinkedIn post (hiện dùng link profile tác giả thay thế) — cần mẫu HTML
      có link đó nếu muốn bổ sung.
- [ ] Nhận diện + loại bỏ bài "Promoted" trên LinkedIn — cần 1 mẫu HTML của loại này.
- [ ] Selector cho các loại trang LinkedIn khác (Jobs search / Sales Navigator) nếu team cần dùng thêm.
- [x] UI chọn platform trước (3 nút LinkedIn/Upwork/Fiverr ở home view) — xong (2026-09-22).
- [x] ~~Upwork: selector job card + searchUrlTemplate job search~~ — THAY THẾ hoàn toàn 2026-09-23,
      xem mục ngay dưới. Không còn crawl job trên Upwork nữa.
- [x] Upwork: chuyển từ search JOB sang search TALENT (freelancer) — xong phần crawl list (2026-09-23).
      URL xác nhận thật: `upwork.com/nx/search/talent?q=...&rising_talent=yes&top_rated_plus=yes&top_rated_status=top_rated&page=1`,
      badge filter cố định trong URL (không cho tắt). Location filter: param `loc` xác nhận thật qua
      `?loc=united-states`, form popup có thêm ô "Location (optional)" (chỉ hiện khi
      `platform.supportsLocation`), tự kebab-case tên location — MỚI verify đúng cho "United States",
      chưa verify case khác (region/subregion, tên nhiều từ lạ...). Card selector: `article[id^="talent-tile-"]`
      + `[data-test]` cho field con — lấy name, headline, location, rate/hr, job success %, total earned,
      badges (Open for work/Offers consultations/...), skills, mô tả. Lấy hết field có sẵn trên list card,
      CHƯA cần mở modal cho bước này.
- [x] Upwork: click từng talent card mở MODAL chi tiết profile, lấy text (TRỪ Client Feedback), gửi
      cho AI phân tích identity/contact công khai — **verify THẬT end-to-end bằng chạy live +
      API key thật (2026-09-23)**: modal mở/đóng đúng, `profile_text` đầy đủ (About/Rate/Agency/Work
      history từng job/Portfolio/Employment history/Skills/Certifications/Education), gửi đúng vào
      prompt, model thật sự gọi tool web search (`tool_usage.web_search.num_requests: 1`), trả
      JSON đúng schema, đúng tinh thần "không suy đoán" của prompt (để null khi bằng chứng ngoài
      yếu, không bịa email/phone). `upwork.js` + `background/ai/
      profile-analyzer.js`, message `ANALYZE_PROFILE`.
      **Cập nhật 2026-09-23**: đổi tool `web_search_preview`
      -> `web_search` (+ `search_context_size: 'low'`, `reasoning.effort: 'low'`,
      `max_tool_calls: 2`, `tool_choice: 'required'` để bắt buộc phải search chứ không tùy chọn,
      `include: ['web_search_call.action.sources']` để lấy nguồn thật đã dùng) — xác nhận qua tài
      liệu chính thức OpenAI (`developers.openai.com/api/docs/guides/
      tools-web-search`): "web_search_preview" chỉ còn cho tích hợp cũ, tích hợp mới dùng
      "web_search". Đồng thời đưa `profile_text`/`upwork_profile_url` ra khỏi `instructions` (prompt
      tĩnh, không đổi mỗi lần gọi) sang `input` dạng tin nhắn user kèm câu dặn "đây là data, không
      phải chỉ dẫn" — giảm rủi ro prompt injection nếu profile_text chứa câu dạng "ignore previous
      instructions...", `instructions` có ưu tiên cao hơn `input`. Bỏ chặn cứng khi `profileText`
      rỗng đã được thay bằng fail-fast trước API vì URL Upwork đơn lẻ không đủ tín hiệu tìm nguồn ngoài.
      `extractOutputText()` nối TẤT CẢ `output_text` block
      thay vì chỉ lấy block đầu. `crawled_at` giờ lấy timestamp thật lúc lấy xong `profile_text`
      (truyền từ `upwork.js`) thay vì giờ gọi AI.
      **Đã verify live 10 lead** với `gpt-5.6-terra`: 2/10 tìm được full name + LinkedIn, 1/10 có
      email công khai; 9/10 mở lại Upwork và 8/10 chỉ lấy bằng chứng từ Upwork. Tối ưu tiếp sau test:
      rút prompt còn khoảng 4k ký tự, hướng dẫn hai query theo tín hiệu hiếm, chặn hẳn `upwork.com`
      qua `filters.blocked_domains` để không phí tool call, bỏ `upwork_fallback` khỏi output, giới hạn
      4 matched signals/5 sources và gắn `research_meta` (model, response id, số search, usage token)
      ở phía ứng dụng để lần test sau đo chi phí thật. Cấu hình mới này mới chỉ test bằng mock, chưa
      gọi API trả phí.
      **Pipeline deterministic v4 (2026-09-24):** thay one-shot prompt trên bằng 2 stage có
      Structured Outputs strict. Stage `identity` nhận profile compact + tối đa 2 query do code dựng:
      một query kết hợp name/headline/location hoặc external URL, và một query LinkedIn có rare
      employment/portfolio/education signal. Profile chỉ có name/headline/location chạy thẳng một
      LinkedIn query rộng, bỏ exact phrase và không retry; chỉ profile có external URL hoặc tín hiệu
      employment/portfolio/education mới chạy broad query rồi LinkedIn fallback nếu chưa verify.
      Mỗi query chạy trong một request riêng với tool bắt buộc vì `max_tool_calls` là giới hạn trên chứ
      không bảo đảm model tự chạy cả hai query. Identity search dùng context `low` để giới hạn token.
      Code chỉ chấp nhận identity khi có personal
      LinkedIn `/in/` hoặc website, evidence URL, và direct external-link match hoặc >=2 signal hiếm.
      Stage `contact` chỉ chạy sau khi identity verify, search website/name/LinkedIn đã xác nhận;
      email/phone/contact URL phải có source URL thuộc website/LinkedIn/evidence đã verify;
      nếu có website thì contact web search bị khóa vào official domain bằng `allowed_domains`.
      LinkedIn URL không được lặp vào `other_contacts`; contact form đơn lẻ vẫn kích hoạt đúng một
      website retry để ưu tiên email/phone. Actual search query và source domain được ghi gọn trong
      `research_meta.search_diagnostics` để phân biệt search miss với validator reject.
      Contact-broker bị chặn. Với các host chứa nhiều profile như GitHub/Behance, direct match yêu cầu
      trùng cả profile path chứ không chỉ domain.
      **Cập nhật 2026-09-24: bỏ hẳn `research_meta` khỏi output** (freelancer lẫn agency, theo yêu cầu
      user — không cần trả về trong lead.analysis/CSV/UI). Đã xoá field cùng toàn bộ code chỉ tồn tại
      để build nó: `sumUsage`/`countSearchActions`/`responseSearchDiagnostics`/`buildSearchDiagnostics`/
      `orderedResponses` và biến `stageResponses` trong `profile-analyzer.js`, khối gán `result.research_meta`
      trong `agency-analyzer.js`, và cờ `cache_hit` trong `analyzeProfileCached()` (background.js) vì nó
      chỉ tồn tại để đánh dấu lên `research_meta`. Hệ quả: không còn cách nào đo lại chi phí/hit-rate
      thật từ dữ liệu đã lưu (như đã làm 1 lần trên batch 15 lead 2026-09-24, xem memory) — muốn đo lại
      phải tạm thêm `console.log` ở `callResearchStage()`/`analyzeAgency()` cho lần chạy đó rồi bỏ đi,
      không lưu vào output nữa.
      **Cập nhật 2026-09-25: thêm lại ĐÚNG PHẦN token cost** (theo yêu cầu user, KHÁC với
      `research_meta` đầy đủ đã bỏ ở trên — không có model/response id/search diagnostics, chỉ số
      token). Cả 3 file (`profile-analyzer.js`/`agency-analyzer.js`/`fiverr-analyzer.js`) đều gắn
      `result.token_usage = { input_tokens, output_tokens, total_tokens }` vào output cuối cùng —
      cộng dồn `usage` từ MỌI request thật sự đã chạy cho lead đó (freelancer 1-4 call tuỳ nhánh
      identity/identity_retry/contact/contact_retry; agency/fiverr 1-2 call tuỳ có retry-khi-rỗng hay
      không), không phải chỉ request cuối. Helper `sumTokenUsage()`/`EMPTY_TOKEN_USAGE` lặp lại y hệt
      ở cả 3 file (tự chứa, đúng quy ước). Đổi contract nội bộ: `callResearchStage()` (freelancer) và
      `callOpenAiOnce()` (agency/fiverr) giờ trả `{ raw/result, usage }` thay vì trả thẳng object đã
      parse — mọi call site cập nhật theo. Test mới: assertion `token_usage` trong 2 test freelancer
      đã có (`tests/profile-analyzer.test.mjs`, xác nhận cả nhánh có contact-stage lẫn nhánh early-
      return chỉ có identity) + 2 test mới cho agency và 2 test mới cho fiverr
      (`tests/agency-analyzer.test.mjs`/`tests/fiverr-analyzer.test.mjs` — sum qua 2 lần gọi khi
      retry-khi-rỗng, và không nhân đôi khi chỉ 1 lần gọi thành công). Vẫn CHƯA có cách đo lại
      cached_tokens/reasoning_tokens riêng (chỉ 3 field top-level `usage` chuẩn, không đào sâu
      `input_tokens_details`/`output_tokens_details`) — thêm sau nếu user cần.
      Background chỉ cache kết quả có LinkedIn/website theo SHA-256 của
      model + Upwork URL + profile_data trong `chrome.storage.session`; negative result không cache để
      tránh giữ false negative, cache mọi version được xoá cùng nút Clear all.
      Đóng modal (2026-09-23, sửa lại sau khi user báo Escape đôi khi KHÔNG đóng được modal lúc chạy
      hàng loạt — lý do chưa rõ): đổi cơ chế đóng chính từ dispatch phím Escape sang bấm thẳng nút
      back của air3-slider (`modal.querySelector('[data-test="BackButton"]')`, mũi tên trái góc trên
      modal — user xác nhận qua HTML thật là bấm nút này đóng HẲN modal về search list, dù data-test
      tên "Back" chứ không phải "Close": vì modal này là air3-slider trượt từ cạnh, "back" từ slide
      gốc = thoát slider, không phải điều hướng lùi trong nhiều bước). Escape vẫn giữ làm fallback
      nếu không tìm thấy nút back trong DOM.
      Bug đã gặp + sửa dọc đường (tham khảo nếu tái phát): (1) sleep cố định 500ms sau khi mở modal
      không đủ — phần thân modal load bằng fetch nội bộ Upwork SAU KHI mount, phải chờ; (2) cách chờ
      "content ngừng phình to" ban đầu thiếu chờ tối thiểu -> chốt nhầm lúc content còn rỗng nếu mạng
      chậm. Fix cuối cùng (`waitForModalContentStable()`): bắt buộc chờ tối thiểu 2.5s, sau đó mới
      đếm ổn định (2 lần đo liên tiếp bằng nhau), timeout tổng 10s, MỖI lần đo đều chủ động
      `scrollModalToBottom()` trước (phòng nội dung lazy-mount theo scroll — thử cả modal,
      `.air3-slider-body`, window vì chưa xác nhận chắc phần tử nào scroll thật, set scrollTop lên
      phần tử sai là no-op vô hại). Các con số 2.5s/10s vẫn là ước lượng, không có cách biết chắc
      100% Upwork mất bao lâu — nếu sau này lại thấy `profile_text` ngắn/thiếu, tăng số lên tiếp chứ
      không đổi cách tiếp cận.
      **Bug thật gặp lúc chạy live (batch Exa, sau khi thêm research provider Exa.ai) — nghiêm
      trọng, đã sửa**: nhiều freelancer LIÊN TIẾP có `about`/`portfolio`/`education` Y HỆT NHAU
      (của người mở modal TRƯỚC), phát hiện qua log input gửi Exa (`profile-analyzer.js`) —
      `name`/`headline`/`location` (đọc từ card ngoài list, KHÔNG phải modal) vẫn đúng riêng từng
      người, chỉ phần đọc từ MODAL bị lẫn. Nguyên nhân: `waitForModalContentStable()` cũ chỉ coi
      "ổn định" là "length không đổi giữa 2 lần đo" — nếu Upwork TÁI DÙNG cùng 1 DOM node của
      air3-slider giữa các lần mở (thay vì tạo node mới mỗi lần, hợp lý vì đây là panel trượt cạnh),
      thì ngay sau khi click card kế tiếp, `querySelector(...)` trong `openProfileModal()` trả về
      NGAY node CŨ (còn nguyên nội dung người trước) trước khi Upwork kịp fetch xong dữ liệu người
      mới — content "không đổi" bị coi nhầm là "đã load xong", nhưng thực ra là data CŨ, SAI người.
      Hệ quả nặng: gửi nhầm data người A đi tìm contact cho người B, vừa tốn tiền Exa/OpenAI vô ích
      vừa cho kết quả sai mà UI không có cách nào biết để nghi ngờ.
      Fix: `waitForModalContentStable()` nhận thêm `priorContent` (nội dung modal chụp lúc TRƯỚC
      khi click, ở `openProfileModal()`) — bắt buộc phải thấy content THẬT SỰ khác `priorContent`
      mới bắt đầu đếm "ổn định" (không có `priorContent` — modal thật sự mới/trống — thì bỏ qua yêu
      cầu này, giữ nguyên hành vi cũ, không ảnh hưởng case bình thường). Hết timeout 10s mà content
      CHƯA TỪNG đổi khỏi `priorContent` -> throw thẳng (rơi vào `analysisError`, bỏ qua đúng 1
      freelancer đó) thay vì âm thầm trả data cũ đi phân tích — thà mất 1 lead còn hơn có 1 lead với
      thông tin liên hệ gán nhầm người. Nếu content ĐÃ đổi nhưng chưa kịp ổn định trong 10s (case
      "load chậm" đã biết từ trước) vẫn giữ hành vi cũ (best-effort, không throw). Nhân tiện thêm
      `console.warn()` trong `closeProfileModal()` khi modal không biến mất khỏi DOM sau 4s chờ —
      xác nhận/phủ định trực tiếp giả thuyết "Upwork tái dùng node" ở lần chạy live tiếp theo, không
      cần đoán thêm.
      **CHƯA verify live** (không có trình duyệt thật để tự chạy) — cần user tự chạy lại 1 batch
      Upwork freelancer thật với fix này, xem: (1) `about`/`portfolio`/`education` có còn lặp giữa
      2 freelancer liên tiếp không; (2) console có xuất hiện warning "Modal element is still in the
      DOM 4s after closing" không (xác nhận giả thuyết tái dùng node); (3) có freelancer nào bị
      throw "Modal content never changed..." không — nếu throw quá thường xuyên (không phải hiếm),
      nghĩa là 10s timeout chưa đủ cho tốc độ fetch thật của Upwork, cần tăng thêm chứ không đổi
      cách tiếp cận (cùng tinh thần ghi chú 2.5s/10s ở trên).
      **Bug thứ 2 (NẶNG HƠN, cùng ngày) — click nhầm hẳn sang freelancer khác, không chỉ modal chưa
      kịp load**: user gửi screenshot + console cho thấy panel báo "Opening profile 2/5: Arthur T."
      nhưng trang trình duyệt THẬT SỰ mở ra là Sagar P. (khớp đúng URL
      `.../talent/details/~01074f8dd366f73626/profile`) — tức là `card.dispatchEvent(click)` trong
      `openProfileModal()` không mở đúng freelancer mà `extractCard(cards[i])` vừa đọc được từ
      CHÍNH node đó. Fix bug thứ nhất (so content cũ/mới) KHÔNG bắt được case này vì nó chỉ kiểm tra
      "content có đổi không", không kiểm tra "có đúng người không" — 2 loại lỗi khác nhau, cần 2 lớp
      chặn riêng. Nghi vấn nguyên nhân: Upwork tự re-render/re-rank danh sách search results giữa
      lúc crawl (cùng hiện tượng đã ghi nhận ở `goToNextPage()`: "cùng 1 freelancer bị lặp lại ở
      ranh giới 2 trang pagination"), tái dùng cùng 1 DOM node ở 1 vị trí cho freelancer KHÁC —
      `cards` (mảng `getTalentCards()` chụp 1 LẦN lúc vào trang, dùng xuyên suốt cả trang trong
      `scrapeCurrentPage()`) có thể trỏ tới 1 node đã bị Upwork gán lại cho người khác giữa lúc ta
      đọc card (`extractCard()`) và lúc thật sự click nó (có nhiều `await`/delay xen giữa: chờ AI
      phân tích freelancer trước, `humanDelay`, đóng modal trước...). KHÔNG kiểm soát được lúc nào
      Upwork tự re-render nên không sửa được tận gốc — chặn bằng xác nhận ĐỘC LẬP sau khi click.
      Fix (`openProfileModal(card, expectedProfileUrl)`, `extractContractorId()`): trích contractor
      id từ URL freelancer ta ĐỊNH mở (format `~xxxxx`, xác nhận thật từ chính URL profile — xem
      `getProfileUrl()`), sau khi click xong bắt buộc chờ `window.location.href` chứa ĐÚNG id đó
      (`waitFor`, timeout 5s) — không khớp thì throw ngay (rơi vào `analysisError`, bỏ qua đúng 1
      freelancer đó) thay vì tiếp tục lấy nhầm data người khác đi phân tích. Đây là nguồn xác thực
      ĐÁNG TIN hơn hẳn so sánh text content, vì URL là "ground truth" của chính trình duyệt — Upwork
      dùng client-side routing (URL đổi thật khi mở profile, xác nhận qua chính screenshot user gửi:
      address bar đổi thành `/nx/search/talent/details/{id}/profile`), khác DOM text vốn có thể bị
      Upwork tái dùng/re-render bất cứ lúc nào.
      Nhân tiện đổi thứ tự: `humanDelay(600, 1500)` giờ chạy TRƯỚC `extractCard()` thay vì sau (thu
      hẹp khoảng thời gian giữa lúc đọc card và lúc click nó — không loại bỏ được rủi ro vì không
      kiểm soát được Upwork, chỉ giảm cửa sổ thời gian có thể xảy ra staleness).
      **Đã soát toàn bộ các luồng khác** (theo yêu cầu user, tránh bug tương tự ẩn ở chỗ khác) —
      XÁC NHẬN không có luồng nào khác dính CÙNG loại bug này (giữ 1 mảng DOM element chụp 1 lần rồi
      click vào từng phần tử sau nhiều `await`):
      - Agency (`crawlAgencies()` trong popup.js) và Fiverr (`crawlFiverrSellers()`): điều hướng qua
        `chrome.tabs.update({url: ...})` bằng URL đã capture SẴN (browser-level navigation), KHÔNG
        click DOM element nào — không có class bug này.
      - LinkedIn (`scrapeCurrentPage()` trong linkedin.js): đọc hết card đang hiển thị trong 1 lượt
        quét đồng bộ, KHÔNG click/điều hướng từng item — không có class bug này.
      - Pagination (`goToNextPage()` cả upwork.js lẫn `nextLink.click()` trong fiverr.js): nút Next
        được query TRỰC TIẾP ngay trước khi click (`getPaginationInfo()` gọi đồng bộ, không có await
        xen giữa) — không giữ reference qua await nào, an toàn.
      - `discoverAgencies()`/`collectAgencyLinks()`: query lại `document.querySelectorAll` MỚI mỗi
        lần gọi (không giữ mảng cố định), và không click bất kỳ element nào (chỉ đọc `img.src`/`alt`)
        — không có class bug này.
      Kết luận: cả 2 bug (content cũ + click nhầm người) CHỈ xảy ra ở đúng 1 chỗ —
      `scrapeCurrentPage()`/`openProfileModal()` cho freelancer Upwork — vì đây là luồng DUY NHẤT
      vừa giữ 1 mảng DOM element cố định cho CẢ TRANG, vừa click + chờ AI (delay dài) cho TỪNG phần
      tử trong mảng đó.
      **CHƯA verify live** — cần user chạy lại 1 batch thật, xem: (1) còn thấy panel báo sai tên so
      với trang thật mở ra không; (2) tần suất throw "Opened the wrong profile..." — nếu xảy ra
      thường xuyên (không phải hiếm), nghĩa là Upwork re-render danh sách rất hay xảy ra, lúc đó nên
      cân nhắc phương án nặng hơn: bỏ hẳn việc giữ mảng `cards` cố định cho cả trang, thay bằng
      re-query `getTalentCards()` MỖI freelancer (chọn phần tử đầu tiên có URL chưa có trong
      `seenUrls`) — chưa làm ngay vì đây là thay đổi lớn hơn, rủi ro tự tạo bug mới cao hơn khi
      không có trình duyệt thật để kiểm chứng ngay.
      **Cập nhật sau batch 5 lead Exa tiếp theo:** 4 lead lỗi liên tiếp đều thấy URL chi tiết Arthur
      `~01e480d361d97d5ab3`, dù ID kỳ vọng mỗi lead khác nhau. Điều này chỉ ra modal/route của
      Arthur chưa đóng sau lượt đầu; giả thuyết danh sách re-render không giải thích tốt việc URL
      cứ đứng yên ở cùng 1 người. `closeProfileModal()` trước đây tìm BackButton chỉ bên trong
      `modal-profile-details`, rồi chỉ warning sau 4 giây mà vẫn đi tiếp. Sửa: tìm BackButton ở
      slider/header hoặc toàn document, `.click()` và xác nhận route đã rời profile; nếu chưa thì
      thử Escape và `history.back()`. Nếu vẫn ở route chi tiết, dừng crawl, giữ các lead đã xử lý,
      báo lỗi trong panel. `openProfileModal()` cũng từ chối mở lead mới nếu route cũ còn hiện.
      Có unit test cho các nhánh đóng modal; chưa verify trực tiếp trên Upwork live.
      Client Feedback: đã xác nhận qua HTML thật — modal preview này (kiểu "proposal preview", KHÔNG
      phải trang profile đầy đủ) không hề hiện review text nguyên văn, chỉ có rating số (⭐) + tag do
      Upwork tự rút ra ("Reliable", "Committed to Quality"...); chữ "Client feedback" duy nhất xuất
      hiện là tên 1 tab trong nav bar. Nên heuristic loại theo heading "feedback"/"review" hiện
      KHÔNG có gì để xoá trong view này — không phải lỗi, chỉ là loại review text không áp dụng ở
      modal này.
      Có delay kiểu người dùng thật (`humanDelay()`): 0.6-1.5s trước khi click card, 0.8-2s sau khi
      đóng modal trước khi sang card kế — theo yêu cầu user, tránh crawl kiểu bot click-đọc-đóng liên
      tục. Có progress live trong panel (`CRAWL_PROGRESS`) + console.log thẳng `profile_text` ngay
      trong content script lúc lấy xong (console trang Upwork, không cần đào response OpenAI ở
      console service worker).
      Kết quả lưu vào `lead.analysis` (object JSON đã chuẩn hoá). Hiển thị trong leads list
      **(ĐÃ ĐỔI so với mô tả cũ ở đây — trang này từng nói "chỉ in `<pre>` JSON thô", giờ không còn
      đúng, sửa lại theo code thật đọc lúc 2026-09-25)**: `buildAnalysisCard()` trong `popup.js` render
      1 `<details class="analysis-card">` gọn (native, không cần JS toggle riêng) — `<summary>` tóm
      tắt tên/badge `source · type`/số contact tìm được, mở ra mới thấy `<dl class="analysis-fields">`
      chi tiết từng field (Location/Website/LinkedIn/Email/Phone/Other/Profile) qua `appendTextField()`/
      `appendLinkField()`/`appendContactFields()`. Lead KHÔNG có `analysis` (LinkedIn/Fiverr chưa
      phân tích, hoặc bị `analysisError`) -> vẫn hiện link `[platform] title` để tự mở xem profile,
      kèm dòng lỗi đỏ nếu có `analysisError`.
      Nút "View raw JSON" (2026-09-25, yêu cầu user) — góc dưới bên phải mỗi card, ẩn/hiện
      `<pre class="analysis-output">` chứa `JSON.stringify(analysis, null, 2)` để đối chiếu nhanh
      field nào model thật sự trả về so với card đã format gọn, không cần mở DevTools.
      **Bug thật gặp lúc chạy live (2026-09-25), đã sửa**: `analysis.location` là object
      `{city, state_region, country}` (xem `normalizeResearchResult()`/`parseLocation()`) nhưng
      `appendTextField(dl, 'Location', analysis.location)` gán thẳng object vào `.textContent` — JS
      tự convert thành chuỗi `"[object Object]"` thay vì hiển thị giá trị thật. Sửa bằng cách join
      phần nào có giá trị (`[city, state_region, country].filter(Boolean).join(', ')`) trước khi gọi
      `appendTextField()` — áp dụng chung cho MỌI platform vì cùng 1 hàm `buildAnalysisCard()`, không
      chỉ riêng Fiverr (nơi phát hiện ra bug).
      CSV export CHƯA có cột `analysis` riêng — hỏi user nếu cần thêm.
      Nút debug "Test 1 profile" (chỉ hiện khi `platform.deepAnalyze`, hiện chỉ Upwork) — chạy giới
      hạn đúng 1 freelancer rồi in JSON output ra 1 `<pre>` trong panel để xem nhanh không cần mở
      DevTools.
      **Cập nhật làm sạch input (2026-09-23):** trước khi gửi OpenAI, modal được chuẩn hoá bởi
      `upwork-profile-cleaner.js` thành `profile_data` có cấu trúc: identity, About, portfolio,
      employment, tối đa 12 job title, education, skills và external link. Bỏ toàn bộ feedback,
      tooltip, CTA, pagination/onboarding UI, job description dài và nội dung lặp. Cleaner vẫn có
      fallback parse section từ raw modal text khi DOM section thay đổi, nhưng background không còn
      nhận payload chỉ có `profileText` từ content script cũ: phải reload tab để có structured data.
      Mẫu crawl Muhammad Ahmad
      giảm từ 10.325 xuống 1.831 ký tự (82%) nhưng vẫn giữ các project/brand và UVAS Business School.
- [x] Nút Stop giữa chừng khi đang crawl Upwork (vòng lặp modal+AI chạy lâu) — thêm 2026-09-23.
      `STOP_CRAWL` message tới content script, kiểm tra cờ `stopRequested` trước mỗi freelancer
      (không ngắt giữa lúc đang mở/đóng modal) — trả về lead đã xử lý xong tính tới lúc dừng.
- [x] Upwork: filter freelancer/agency (`pt` param) — thêm 2026-09-24. URL xác nhận thật từ user:
      `pt=independent` (freelancer) vs `pt=agency`, cùng các param khác giữ nguyên. UI: radio
      "Freelancer"/"Agency" trong `keywords-section` (`account-type-section`), mặc định freelancer,
      chỉ hiện khi `platform.supportsAccountType` (mới có Upwork). `buildSearchUrl()` nhận thêm
      tham số `accountType`, thay `{pt}` trong `searchUrlTemplate`. Flow freelancer (crawl list ->
      mở modal -> AI phân tích) giữ nguyên y hệt cũ.
- [ ] Upwork: pipeline crawl + enrich AGENCY (bắt đầu 2026-09-24, theo prompt chi tiết user gửi).
      Kiến trúc ĐÃ ĐƠN GIẢN HOÁ so với bản spec gốc — 2 quyết định tự đưa ra (không hỏi lại, thấy rõ
      lý do kỹ thuật):
      1. KHÔNG dựng state machine persist qua `chrome.storage.local` + đánh thức background service
         worker như spec đề xuất — toàn bộ codebase hiện KHÔNG có tiền lệ nào orchestrate crawl từ
         background cả (freelancer cũng vậy: vòng lặp nằm trong content script hoặc panel). Vòng lặp
         điều hướng qua từng agency (`crawlAgencies()` trong popup.js) nằm ở SIDE PANEL — panel không
         tự đóng khi chuyển tab (khác popup thường) nên sống đủ lâu cho cả vòng lặp, không cần lo
         service worker bị suspend. Đánh đổi: đóng side panel giữa chừng sẽ mất phần lead chưa lưu —
         y hệt rủi ro đã có sẵn ở flow freelancer hiện tại (chưa từng thấy là vấn đề thực tế).
      2. KHÔNG tự dựng crawler website (fetch domain doanh nghiệp ngoài, parse JSON-LD, regex email/
         phone, scoring +45/+25/...) như spec đề xuất — dùng LẠI đúng pattern freelancer đã có sẵn và
         verify live rồi: 1 lệnh gọi OpenAI Responses API + tool `web_search` (`analyzeAgency()`,
         `src/background/ai/agency-analyzer.js`), model tự tìm website/LinkedIn/contact công khai.
         Đánh đổi: không tối ưu chi phí bằng cách tự chấm điểm candidate trước khi gọi AI (spec gốc
         muốn), nhưng KHÔNG cần mở rộng `host_permissions` (hiện chỉ `api.openai.com` — fetch domain
         bất kỳ cần quyền host rộng, quyết định bảo mật đáng cân nhắc riêng) và KHÔNG cần tự chế 1
         search engine (fetch thẳng Google/Bing không có API trả phí gần như chắc chắn bị chặn/
         CAPTCHA — sẽ không hoạt động thật, khác hẳn rủi ro "chỉ là chưa tối ưu").
      Output schema: DÙNG CHUNG 100% với freelancer (cùng field name/shape trong PROMPT_TEMPLATE của
      agency-analyzer.js, theo yêu cầu user 2026-09-24 — "cùng chung output") để popup.js/CSV không
      cần biết lead nào là freelancer hay agency. Diễn giải field cho agency: `name` = tên công ty đã
      verify (fallback tên Upwork nếu chưa verify), `linkedin` = trang LinkedIn COMPANY (không phải cá nhân),
      `emails`/`phones`/`other_contacts` dùng lại đúng enum type `direct|agency|representative` đã
      có sẵn (rất khớp nghĩa cho agency: direct = liên hệ cá nhân người có tên, agency = contact
      chung công ty, representative = nhân sự khác). Các field `sources`, `identity_confidence` và
      `matched_signals` và `job` đã BỎ khỏi output ở CẢ freelancer và agency vì không có downstream
      sử dụng. Code gắn deterministic `source: "upwork"` cùng `type: "freelancer"|"agency"` để DB
      có thể filter mà không phụ thuộc model.
      Message contracts mới: `DISCOVER_AGENCIES` (content script, chạy trên trang search), dedupe
      theo agencyId qua nhiều trang pagination, tái dùng `getPaginationInfo()/goToNextPage()` đã có
      — KHÔNG dùng MutationObserver riêng như spec gốc đề xuất vì cơ chế chờ-card-đổi sẵn có đã đủ
      tín hiệu; `EXTRACT_AGENCY_DETAIL` (content script, chạy trên trang chi tiết 1 agency);
      `ANALYZE_AGENCY` (background, gọi `analyzeAgency()`). Logic parse/dedupe agency tách riêng
      thành `src/content-scripts/upwork-agency-links.js` (pure, UMD giống upwork-profile-cleaner.js)
      để unit-test được (`tests/upwork-agency-links.test.cjs`) mà không cần DOM thật.
      **SỬA 2026-09-24 sau khi có HTML thật (bản đầu đoán SAI)**: khối "Associated with {agency}"
      trên freelancer card KHÔNG có thẻ `<a href>` nào — chỉ có
      `<img class="air3-avatar-company" src=".../org-logo/{id}" alt="{agency name}">`. User xác
      nhận thật (tự mở URL) — số trong `org-logo/{id}` CHÍNH LÀ agencyId dùng trong `/agencies/{id}/`.
      `collectAgencyLinks()` giờ quét `img[src*="/org-logo/"]`, lấy tên từ `alt` (trùng khớp
      `.name` div kế bên, không cần dò DOM cha/anh em). Vì không có link để "click", việc sang
      agency kế trong `crawlAgencies()` (popup.js) là điều hướng thẳng URL đã build sẵn
      (`chrome.tabs.update`) — thêm `humanDelay(700, 1600)` TRƯỚC mỗi lần điều hướng (không chỉ sau)
      để tránh pattern request đều đặn/tức thời trông như bot (yêu cầu user — Upwork có cơ chế phát
      hiện automation, giống lý do `humanDelay()` đã có ở freelancer flow). Nhân tiện fix 1 bug: bản
      trước thiếu `waitForTabLoad()` sau khi tạo `crawlerTab` cho agency ĐẦU TIÊN (chỉ có cho các
      lần `tabs.update` sau đó) — agency #1 có thể bị extract trước khi trang load xong.
      **`extractAgencyDetail()` (upwork.js) ĐÃ VIẾT từ HTML mẫu thật user gửi (2026-09-24, 2 tin
      nhắn — tin đầu bị cắt ở giới hạn 50k ký tự trước khi tới phần stats/location, tin sau bổ
      sung đúng phần thiếu)** — CHƯA verify live (chưa chạy thật trên trình duyệt, giống quy ước mọi
      phần khác của dự án — cần user tự chạy Auto-hunt agency thật để xác nhận). Theo đúng yêu cầu
      user "chỉ cần thông tin chính" (tên, dịch vụ, ngành, địa chỉ, người đứng đầu), field trả về:
      - `upworkName` (`h1.agency-title`), `tagline` (`[data-test="agency-title"]`)
      - `location` = văn phòng được đánh dấu "Primary location" (hoặc văn phòng đầu tiên) trong
        section "Office locations" — `officeLocations` giữ nguyên mảng đầy đủ nếu agency có >1 văn
        phòng. KHÔNG có field "industry" riêng trên Upwork — dùng `services`/`overview` làm tín hiệu
        ngành cho AI, không tự bịa field không tồn tại.
      - `services` (tối đa 15, chỉ tên — service #2 trở đi Vue chưa mount mô tả nên không lấy
        được), `skills`, `overview` (cap 1500 ký tự), `portfolio`/`featuredClients` (chỉ phần đã
        render sẵn, chưa bấm "See more"), `workHistoryTitles` (tối đa 12, CỐ Ý bỏ review text
        khách hàng — cùng tinh thần loại "Client Feedback" ở freelancer)
      - `members` (tối đa 10, từ section "Business managers" — chính là nguồn "người đứng đầu"):
        name + role lấy nguyên văn từ `aria-label="Invite {name} ({role}) to Job"` (vd "Agency
        business manager") + profileUrl — không hardcode chuỗi role cụ thể nên agency khác có
        "Agency owner"/"Founder" vẫn lấy đúng.
      - `hourlyRate`/`totalEarned`/`totalJobs`/`memberSince` (section "Upwork activity"),
        `agencySize`/`yearFounded`/`clientFocus` (section "Company information") — 2 section này
        không có `data-test`/`data-ev-sublocation` ổn định trên heading (chỉ có Vue hash đổi theo
        build), nên `findSectionByHeadingText()` match theo TEXT heading (`<h3>`) rồi mới query bên
        trong — `extractLabeledStats()` ghép cặp `<small>{label}</small>` + 1-N `<h4>{value}</h4>`
        theo thứ tự DOM (không theo quan hệ cha/con trực tiếp, vì Upwork lồng khác nhau tuỳ field —
        vd "Client focus" có 2 `<h4>`, gộp bằng ", ").
      Các hàm DOM-facing này (giống `extractCard()`/`extractBadges()`... cùng file) KHÔNG có unit
      test riêng — theo đúng quy ước đã có của file này (DOM-heavy, verify qua chạy live thật, chỉ
      logic pure/text-parsing phức tạp mới tách module để test, xem `upwork-agency-links.js`).
      **Tối ưu OpenAI agency flow (2026-09-24):** `agency-analyzer.js` whitelist payload trước API
      còn đúng 4 khóa `name`, `description`, `location`, `service`; mọi field detail khác chỉ giữ ở
      local và không thể vô tình làm prompt phình lên. Request dùng reasoning/search context thấp,
      tối đa 1 search, `max_output_tokens: 1000`, và Structured Outputs strict. Model chỉ sinh schema
      nội bộ gọn cho website/email/LinkedIn/contact + source; code map deterministic về output Agency
      và không trả `identity_confidence`/`matched_signals`. Đã verify bằng API thật: Structured Outputs dùng cùng
      `web_search` thành công và tìm đúng website/email/LinkedIn/contact trên mẫu Appsysco. Usage
      vẫn khoảng 13.7k token/request vì phần lớn là context/overhead của hosted web search, không
      phải payload Upwork; `research_meta.usage` được giữ để tiếp tục đo trên batch thật.
      **Input quality gate trước OpenAI:** background không chỉ kiểm tra object có tồn tại. Agency
      phải có `name` + ít nhất một trong `description/location/service`; freelancer phải có
      `identity.display_name` + ít nhất một tín hiệu profile hỗ trợ (headline/location/about/
      portfolio/employment/work history/education/certification/skills/external link). Legacy
      `raw_text` bị từ chối và yêu cầu reload tab. Không đạt gate thì throw `Skipped OpenAI research`
      trước `fetch()`, lead giữ `analysisError` và crawl tiếp lead kế — tránh đốt token khi selector
      Upwork thay đổi hoặc modal chưa render dữ liệu.
      **Bug thật gặp lúc chạy live (2026-09-24), đã sửa**: `extractAgencyDetail()` throw
      "Not an agency detail page" cho 2/N agency dù `crawlAgencies()` điều hướng đúng URL
      (`.../agencies/{numericId}/` build từ `org-logo/{id}` — xem mục ngay trên). Nguyên nhân:
      `extractAgencyIdFromUrl()` cũ chỉ nhận ID SỐ (`/\/agencies\/(\d+)/`), nhưng Upwork redirect
      URL số đó sang URL slug tên công ty cho 1 số agency (`.../agencies/digiestate/`,
      `.../agencies/uprango/`) — `window.location.pathname` lúc content script chạy đã là slug,
      không còn digit, nên hàm trả `null` và bị coi nhầm là "chưa tới trang chi tiết". Đã nới regex
      thành `/\/agencies\/([^/?#]+)/` (nhận cả số lẫn slug) — giá trị này chỉ dùng để null-check +
      build lại `detail.upworkUrl`, không có chỗ nào khác trong codebase giả định nó phải là số
      (đã kiểm tra: `agency-analyzer.js` không đọc field `agencyId`, `ANALYZE_AGENCY` không cache
      theo id, lead storage không dedupe theo id — chỉ `org-logo/(\d+)` ở bước discovery
      (`upwork-agency-links.js`) là thật sự luôn số, KHÔNG đụng tới vì đó là ID nội bộ trong CDN
      image path, khác nguồn với URL trang).
      Nút "Crawl thủ công" (manual, tab đang mở) tạm KHÔNG hỗ trợ agency (chỉ Auto-hunt) — cơ chế
      "1 tab tái sử dụng điều hướng tuần tự" không khớp mô hình "dùng tab đang active".
      **Audit cấu hình OpenAI cả 3 luồng (2026-09-24)** — user yêu cầu soát lại `intent-analyzer.js`/
      `profile-analyzer.js` (freelancer)/`agency-analyzer.js`/`fiverr-analyzer.js` đối chiếu docs chính
      thức OpenAI (Responses API, `web_search`, `reasoning`, `prompt-caching`, `structured-outputs`,
      trang model `gpt-5.6-terra`/`gpt-4.1`). Xác nhận lại: model đang dùng đều đúng chuẩn, không lỗi
      thời (`gpt-4.1` vẫn là "smartest non-reasoning model", `gpt-5.6-terra` hỗ trợ đúng
      `none/low/medium/high/xhigh/max`, không có `minimal` — khớp bug đã ghi ở mục Fiverr bên dưới).
      3 phát hiện đã áp dụng ngay (rủi ro thấp, gần như không đánh đổi):
      1. `store: false` thêm vào `intent-analyzer.js` — trước đó là file DUY NHẤT trong 4 file gọi
         OpenAI không tắt lưu trữ phía server (mặc định Responses API là `store: true`), không nhất
         quán với chủ trương privacy đã áp dụng cho 3 file kia.
      2. `max_output_tokens` của agency + fiverr nâng từ 1000 lên 1600 — theo docs
         (`developers.openai.com/api/docs/guides/reasoning`), reasoning token tính vào trần này; 1000
         khá sát với JSON output 11-12 field cộng reasoning effort `low`, rủi ro response bị cắt giữa
         chừng (`incomplete`) rồi `JSON.parse()` lỗi mất cả lead. Đây chỉ là trần an toàn, không phải
         target token bắt buộc dùng hết nên không tốn thêm tiền nếu model không cần dùng tới.
      3. **`agency-analyzer.js` được thêm cơ chế chống sampling variance** giống hệt fiverr
         (`isEmptyResult()` + gọi lại đúng 1 lần khi rỗng hoàn toàn, tách API call ra `callOpenAiOnce()`)
         — agency trước đó là luồng DUY NHẤT không có cơ chế này dù cùng rủi ro đã xác nhận thật ở
         fiverr (cùng input, 2 lần gọi ra 2 kết quả khác nhau), và agency lại là luồng CHƯA từng
         verify live (đang debug xong bug URL slug ở mục ngay trên) nên vá trước khi chạy thật lần
         đầu, không đợi tự gặp bug giống fiverr rồi mới sửa. Test mới:
         `tests/agency-analyzer.test.mjs` — 3 case giống hệt khuôn 3 case đã có ở
         `tests/fiverr-analyzer.test.mjs` (retry phục hồi được lead, không retry khi đã có contact,
         giữ kết quả rỗng nếu chính lần retry cũng lỗi).
      Phát hiện KHÁC đã nêu nhưng CHƯA áp dụng (cần thêm dữ liệu thật hoặc quyết định đánh đổi
      cost/quality của user trước khi đổi) — hỏi lại nếu muốn làm tiếp:
      - `max_tool_calls: 1` của agency/fiverr chỉ cho model `search`, không cho `open_page` để tự mở
        trang xác minh (freelancer contact-stage đã chủ động cho `2` đúng vì lý do này). User yêu cầu
        giữ nguyên UPWORK_GPT_MODEL (đã đúng `gpt-5.6-terra`, áp dụng cả 3 luồng — không phải câu hỏi
        về việc đổi model) — riêng câu hỏi có nâng `max_tool_calls` lên 2 hay không CHƯA được trả lời
        rõ, cần hỏi lại riêng nếu muốn agency/fiverr có thể tự mở trang xác nhận trước khi trả kết quả.
      - `search_context_size` của identity-stage (freelancer) đang `'low'` trong khi contact-stage lại
        rơi vào mặc định `'medium'` của chữ ký hàm (không override) — ngược trực giác so với logic
        agency/fiverr đã tự rút ra 2026-09-25 ("input thưa cần `medium`, không phải `low`"). User đã
        từ chối đổi mục này (chỉ chọn 2 fix kia) — giữ nguyên `'low'` cho identity.
      - `prompt_cache_key` (fiverr) dựa trên hiểu chưa đúng về docs: với model họ GPT-5.6+, caching là
        TỰ ĐỘNG, key chỉ dùng để tách cost accounting chứ không quyết định có cache-hit hay không.
        Ngưỡng tối thiểu để kích hoạt cache là 1024 token input — ước tính prefix tĩnh (instructions +
        schema) của agency/fiverr có thể DƯỚI ngưỡng này, nghĩa là caching nhiều khả năng chưa từng
        chạy bất kể có set `prompt_cache_key` hay không. Cần tự kiểm tra
        `usage.input_tokens_details.cached_tokens` trong log thật (đã có sẵn ở fiverr) để xác nhận,
        chưa sửa gì vì chỉ là quan sát, không phải bug.
      - `include: ['web_search_call.action.sources']` ở freelancer profile-analyzer.js đang không được
        đọc ở đâu cả (`extractOutputText()` chỉ lọc `item.type === 'message'`) — param có xin về
        nhưng chưa có logic đối chiếu URL model tự nhận "đã search" với `evidence_urls`/`source_url`
        nó tự khai. Chưa sửa vì không rõ đây là tính năng dở dang hay dead code nên bỏ.
      - `user_location` (bias địa lý cho `web_search`, xác nhận qua docs) chỉ có ở fiverr qua
        `countryCodeFromName()`, chưa port sang freelancer/agency dù cả 2 đều có sẵn field location.
- [x] Fiverr: bắt đầu implement (2026-09-24), xong phần crawl + AI phân tích contact (2026-09-25).
      URL builder + UI filter + selector search-list + selector gig detail + orchestration (popup.js)
      + `ai/fiverr-analyzer.js`/`ANALYZE_FIVERR` đều đã xong, `implemented: true`, Auto-hunt chạy
      end-to-end thật (đã verify live 2 seller: Oleg Chuprina đầy đủ data, snuba1 lộ ra 1 bug crawl —
      xem mục "bug + gate" bên dưới). Chi tiết URL search xem đoạn cũ ngay dưới; phần crawl fields +
      AI xem 2 mục riêng cuối cùng của TODO này.
      URL search (`platforms.js`, `buildFiverrSearchUrl()`) xác nhận thật từ 3 curl user gửi:
      `search_in=everywhere` khi All Categories, `search_in=category&sub_category={id}` khi chọn
      category cụ thể (`&nested_sub_category={id}` thêm nếu category con). `ref` luôn có
      `seller_level:top_rated_seller` (mặc định bắt buộc theo yêu cầu user, không cho tắt) +
      `leaf_category:{sub_category}` nếu có category + `seller_location:{CC}` nếu có chọn country,
      nối bằng `|` rồi encode nguyên cụm — khớp đúng 3 curl mẫu (test trong `tests/platforms.test.mjs`).
      Sort mặc định là Best Selling, theo URL user xác nhận (2026-09-24) bằng
      `source=sorting_by&filter=rating`; không có UI tắt/đổi sort này. Các param autocomplete-tracking
      còn lại (`acmpl`, `search-autocomplete-*`, `ref_ctx_id`) vẫn bị loại vì chỉ là state của
      UI gợi ý tìm kiếm lúc user gõ/click.
      `FIVERR_CATEGORIES`/`FIVERR_COUNTRIES` (`platforms.js`) lấy nguyên từ 2 HTML dropdown user gửi
      (ngữ cảnh gõ "media ads") — value category là `sub_category` hoặc `sub_category:
      nested_sub_category`. Lưu ý: đây là snapshot gợi ý theo đúng câu query đó, Fiverr có thể gợi ý
      khác cho câu search khác — nhưng id/code trong đó là id/code thật cố định nên vẫn hoạt động
      đúng dù user đổi câu search. Danh sách country cũng vậy, không chắc là toàn bộ quốc gia Fiverr
      hỗ trợ lọc — mở rộng sau nếu user cần thêm nước không có trong danh sách.
      UI (`popup.html`/`popup.js`): dropdown category + dropdown location riêng cho Fiverr
      (`fiverr-filters-section`, gate qua `platform.supportsCategory`) — KHÔNG dùng chung
      `location-section` kiểu input tự do của Upwork vì Fiverr cần đúng country code cố định.
      "Số freelancer muốn cào" tái dùng UI "Max leads to crawl" có sẵn qua flag mới
      `supportsResultLimit` (tách khỏi `deepAnalyze` — Fiverr chưa có bước AI phân tích profile như
      Upwork) — field này crawl logic CHƯA đọc (content script còn stub), mới wiring UI.
      **Giả định CHƯA hỏi lại user**: bật `directSearch: true` + `noKeywordFilter: true` cho Fiverr
      giống quyết định 2026-09-23 của Upwork (gõ thẳng câu search, bỏ bước "mô tả khách hàng -> AI
      phân tích" và bỏ luôn 2 ô relevant/exclude keywords) — vì flow user mô tả nhảy thẳng từ "mở UI"
      sang chọn category/location/số lượng, không nhắc gì tới bước AI intent. Sửa lại nếu user muốn
      Fiverr vẫn có bước phân tích AI như LinkedIn.
      **Selector search-list card VÀ gig detail page xác nhận thật (2026-09-24)**, từ HTML thật user
      gửi (search-list: nhiều `.gig-card-layout` liên tiếp; detail: nguyên trang gig của seller
      "olegchuprina", ngữ cảnh category "Social Media Design"). 2 file: `src/content-scripts/
      fiverr-extractor.js` (pure, UMD giống `upwork-agency-links.js`: parse gig URL, dedupe seller
      theo username, phát hiện trang bị chặn/CAPTCHA — CHƯA có unit test riêng, khác quy ước các file
      UMD khác trong dự án) và `src/content-scripts/fiverr.js` (DOM thật, đã khai trong
      `manifest.json`):
      - **Search-list card**: `.gig-card-layout` -> `[data-gig-id]` (id thật là phần trước dấu `_`,
        vd `182160625_0` -> `182160625`), link gig qua `a[aria-label="Go to gig"][href]` (nhiều link
        trùng href trong 1 card, lấy link đầu), title qua `.gig-header[title]`, rating qua
        `.rating-score` + `.rating-count-number`, giá qua `a[aria-label="Go to gig"].m-t-8` (text
        "From US$..."). sellerName qua link profile (query `source=gig_cards` + pathname chỉ 1
        segment) -> đọc `[title]` bên trong link đó. Badge ("Vetted Pro"/"Top Rated"/"Fiverr's
        Choice"/"Offers video consultations") đọc qua `[data-track-tag$="_badge"]` +
        `[data-track-tag="stack"]` (attribute thật, không phải class hash) — join riêng từng `<p>`
        con bằng space thay vì lấy thẳng `textContent` (2 `<p>` "Fiverr's"+"Choice" dính liền thành
        "Fiverr'sChoice" nếu không tách). Verify khớp cả 7 card trong HTML mẫu, không lệch trường
        hợp nào.
      - `discoverSellers()` scroll dần (tối đa 24 bước, dừng khi đủ `limit` hoặc 3 nhịp liền không
        tăng thêm card) để trigger lazy-load TRONG 1 trang — CHƯA verify bằng chạy live, chỉ suy luận
        hành vi scroll thông thường của Fiverr, KHÔNG dựa trên xác nhận thật như phần selector ở trên.
      - **Phân trang (2026-09-26, sửa sau khi user xác nhận Fiverr search KHÔNG phải infinite-scroll
        thuần)**: user gửi URL thật lúc bấm sang trang 2 (`&page=2&offset=-21&limit=48&source=
        pagination...`) rồi HTML thật khối pagination ở cuối trang (chụp lúc đang ở trang 2) — xác
        nhận có phân trang qua URL `&page=N` thật, không đoán tiếp offset (không theo công thức rõ
        ràng, bội số lạ so với `limit=48`, đoán sai dễ trùng/sót). `discoverSellers()` giờ lặp qua
        nhiều trang (mốc an toàn `MAX_PAGES = 20`, chưa xác nhận Fiverr cho tối đa bao nhiêu trang/
        câu search — chỉ để tránh loop vô hạn nếu không set limit), gom seller vào 1 `Map` dedupe theo
        username xuyên suốt các trang (khác với `collectSellerCandidates()` chỉ dedupe trong 1 lần gọi/
        1 trang). `getPaginationInfo()`/`goToNextPage()` (fiverr.js) mô phỏng đúng
        `goToNextPage()` đã verify của `upwork.js`: click thật `a[aria-label="Next"][role="link"]`
        (đọc href thật, không tự dựng URL) rồi chờ gig-card đầu tiên đổi href, KHÔNG reload trang thủ
        công. Phát hiện "hết trang" bằng quy ước thấy trong chính mẫu HTML: link số trang HIỆN TẠI
        (trang "2" trong mẫu) không có `href` — suy ra Next cũng mất `href` ở trang cuối theo cùng
        quy ước, **chưa có mẫu HTML trang cuối để xác nhận 100%**. Giả định click chỉ pushState +
        re-render (không hard reload) dựa trên tiền lệ ĐÃ xác nhận của `goToNextPage()` Upwork (cùng
        kiểu SPA hiện đại) — nếu sai, script context bị huỷ giữa chừng sẽ lộ ra qua lỗi message
        channel rõ ràng từ popup.js, không phải sai âm thầm. CHƯA verify live cả 2 giả định này.
      - **Gig detail page** (`extractDetail()`) — bản đầu đoán sai heading "Get to know {name}" (heading
        này KHÔNG tồn tại thật) và dùng JSON-LD `Product`/`Service` (không cần, đã bỏ). Viết lại đúng
        theo HTML thật: gig title vẫn `h1`; category breadcrumb qua
        `nav[aria-label="breadcrumbs"] a[href*="/categories/"]`. Info seller nằm trong `.seller-card`
        (KHÔNG phải section `.seller-overview` ở đầu trang — section đó chỉ có info riêng cho gig này
        như "1 order in queue", rating/review của GIG chứ không phải seller): tên qua
        `.seller-card-name`, tagline qua `.one-liner`, bio qua `.seller-desc .inner`, location qua
        `<li>From<strong>Country</strong></li>` trong `.stats-desc ul.user-stats`
        (`readSellerLocation()`, đọc trực tiếp `<li><strong>` — **thay hẳn cách cũ dùng regex trên
        text đã flatten**: bản đầu `parseSellerFacts()`/`FACT_LABELS` trong fiverr-extractor.js có
        bug thật, lookahead ranh giới label yêu cầu dấu `:` sau label kế tiếp để dừng capture, nhưng
        HTML thật KHÔNG có dấu `:` nào giữa label/value — field trước sẽ nuốt luôn toàn bộ text phía
        sau vào 1 field. Chưa từng lộ vì chưa có test/chưa chạy live, phát hiện nhờ so với HTML thật,
        đã xoá hẳn 2 hàm đó, dead code).
        **Cắt gọn crawl field (2026-09-25)**, sau khi có kết quả crawl live thật để soi field nào có
        giá trị cho bước tìm identity qua OpenAI (không phải chỉ "có sẵn thì lấy" như trước):
        bỏ hẳn `.gig-description` (mô tả gig — chỉ là marketing copy của GIG, không phải tín hiệu
        SELLER), `metadata` (Platform/Type/Industry — mục tiêu khách hàng của gig, không phải seller,
        và thường rỗng), ~~`vettedFor` (chỉ Fiverr Pro, luôn rỗng ở 2 mẫu live đã test)~~ — **SAI, đã
        thêm lại 2026-09-25**: mẫu HTML thật thứ 3 (seller Pro "Luis"/voiceoverbyluis) cho thấy field
        này CÓ dữ liệu thật khi seller đúng là Fiverr Pro (2 mẫu test đầu không phải Pro nên luôn
        rỗng, không phải field luôn rỗng) — xem `readVettedFor()` trong `fiverr.js` (neo theo TEXT
        heading "Vetted for" vì không có class/data-testid ổn định riêng) và cách gộp vào `service`
        cùng `categories` (dedupe qua Set) trong `buildResearchInput()` của `fiverr-analyzer.js`.
        `memberSince`/
        `responseTime`/`lastDelivery`/`languages` (chỉ số vận hành, không giúp tìm identity ngoài),
        và ở list-stage: `gigId`/`gigSlug` (trùng lặp URL), `rating`/`reviewCount`/`startingPrice`/
        `badges` (không có giá trị research, không còn ai đọc field này khi `lead.analysis` chuyển
        sang lưu kết quả AI thay vì data thô — xem mục orchestration/AI bên dưới). Field còn giữ:
        `username`/`profileUrl`/`gigUrl` (bắt buộc cho orchestration), `fiverrName`/`oneLiner`/
        `sellerBio`/`location`/`categories` (input cho AI), `gigTitle` (lead title/snippet + fallback
        headline).
        **Giả định CHƯA verify bằng chạy live**: `.seller-desc .inner` đã đủ chữ trong DOM dù UI có
        nút "+ See More" (suy luận từ việc đoạn mẫu kết thúc trọn câu, không bị cắt — cho rằng đây là
        CSS line-clamp chứ không phải lazy-load thêm khi bấm nút) — nên code KHÔNG bấm nút mở rộng
        trước khi đọc; nếu sau này thấy `sellerBio` bị cụt so với gig thật, đây là chỗ đầu tiên cần
        xem lại.
      **Bug crawl thật gặp khi chạy live + ROOT CAUSE ĐÃ XÁC NHẬN (2026-09-25)**: crawl thật nhiều
      seller — Oleg Chuprina (đầy đủ oneLiner/bio/location/categories) vs snuba1/"Brandon Ewing" và
      reachgiant/"ReachGiant" (`.seller-card`-derived field TRẮNG HẾT dù list-card cho thấy đây là
      seller thật). Ban đầu chỉ nghi ngờ (chưa xác nhận) đây là seller loại Fiverr Agency/Business
      dùng template khác — **user gửi HTML thật của `.seller-card` cho "reachgiant", xác nhận đúng**:
      link `href="/agencies/ReachGiant"` tồn tại trong card → đây chính là loại Agency/Business,
      trang render bằng atomic-CSS template khác hẳn (class hash kiểu `m2d0eb287`, KHÔNG còn
      `.seller-card-name`/`.one-liner`/`.seller-desc`/`.stats-desc`/`.user-stats` nào cả — mọi selector
      cũ trả rỗng, kể cả `waitFor(() => '.seller-card .stats-desc')` cũ sẽ timeout đủ 15s vô ích).
      Đã thêm nhánh extract riêng cho template này trong `extractDetail()` (`fiverr.js`), CHỈ xác nhận
      qua ĐÚNG 1 mẫu HTML thật (reachgiant) — sửa lại nếu mẫu thứ 2 lệch cấu trúc, đừng đoán thêm:
      - Tên: `a[href^="/agencies/"]` trong `.seller-card` (chỉ điểm neo ổn định duy nhất tìm được).
      - Bio: không có bio cá nhân ở template này — dùng tạm khối "Gig Summary" + đoạn mô tả agency,
        neo qua `[data-track-tag="collapsible"]` rồi lấy `.parentElement` (chứa cả 2 phần cùng 1 khối
        cha trong mẫu đã xác nhận) — nội dung này là marketing copy của AGENCY (không phải GIG), khác
        về bản chất với `.gig-description` đã bỏ trước đó nhưng vẫn coi được là tín hiệu cho AI vì
        không có gì tốt hơn.
      - Location: đọc qua icon `svg[data-track-tag="pin_icon"]` rồi lấy text ở `<p>` sibling kế bên
        (không còn `.stats-desc ul.user-stats` để dùng `readSellerLocation()` cũ).
      - `waitFor()` sửa để chờ 1 trong 2 marker (`stats-desc` HOẶC `a[href^="/agencies/"]`) — tránh
        luôn tốn 15s timeout vô ích mỗi khi gặp agency-type seller.
      **Bug liên quan phát hiện thêm khi test fix trên** — `pickSellerName()`/`isUsernameFallback()`
      (`fiverr-analyzer.js`) so khớp CASE-INSENSITIVE giữa tên đọc được và username, nên dù DOM đã đọc
      đúng "ReachGiant" (tên hiển thị thật), gate vẫn coi đây là fallback rỗng vì `.toLowerCase()` làm
      nó trùng username "reachgiant" — phủ nhận luôn phần fix DOM. Đã đổi sang so khớp CASE-SENSITIVE
      (cả 2 nơi gán fallback thật sự — `fiverr.js`/`fiverr-extractor.js` — đều gán nguyên
      `parsed.username`, chữ thường, lấy từ URL; so khớp đúng y hệt case mới phân biệt đúng "thật sự
      fallback" với "tên thật tình cờ khác hoa/thường với username"). Test mới:
      `tests/fiverr-analyzer.test.mjs` — "accepts an agency display name that only differs from the
      username by letter casing".
      **Orchestration (2026-09-24) + AI phân tích contact (2026-09-25) đã xong** — Auto-hunt Fiverr
      chạy end-to-end thật:
      - `crawlFiverrSellers()` trong `popup.js`, cùng khuôn `crawlAgencies()` — mở tab search, gửi
        `DISCOVER_FIVERR_SELLERS`, mở 1 crawler tab ~~(inactive)~~ **foreground** (sửa 2026-09-25,
        xem bug ngay dưới) tái sử dụng điều hướng tuần tự qua
        từng `gigUrl` (`humanDelay` trước mỗi lần điều hướng), mỗi gig gửi `EXTRACT_FIVERR_DETAIL`
        RỒI gửi thẳng background `ANALYZE_FIVERR` (trong cùng try/catch, giống agency) ->
        `lead.analysis` = JSON output đã chuẩn hoá (không còn là raw crawl dump). Dùng chung cờ dừng
        `agencyCrawlStopRequested` với agency flow (chỉ 1 loop kiểu này chạy tại 1 thời điểm).
        `implemented: true` — nút Auto-hunt hết bị disable. Vẫn giữ `console.log('[Hunt-Ex] Fiverr
        ...')` ở input lúc bấm Auto-hunt, danh sách seller sau discover, và detail/lỗi từng gig — để
        debug qua console panel.
        **Bug thật gặp lúc chạy live (2026-09-25), đã sửa**: `crawlerTab` tạo với `active: false`
        (không lấy focus, tránh làm phiền user đang thao tác chỗ khác) — nhưng Chrome throttle mạnh
        tab nền (JS/network priority thấp hơn hẳn tab foreground), trang không kịp bắn `status:
        'complete'` trong 20s của `waitForTabLoad()`, ném lỗi "Page took too long to load" và DỪNG
        HẲN toàn bộ tiến trình crawl (không chỉ 1 lead, cả batch). User xác nhận trực tiếp: tự click
        chuột vào tab đó (đưa nó thành active) thì crawl chạy bình thường — bằng chứng rõ ràng cho
        nguyên nhân throttle tab nền, không phải mạng chậm hay bug DOM. Đã bỏ hẳn `active: false`
        (crawlerTab giữ nguyên foreground suốt vòng lặp, giống searchTab). Đánh đổi: tab này chiếm
        focus trình duyệt trong lúc crawl cả batch — chấp nhận được vì searchTab (tab đầu tiên) vốn
        đã làm vậy từ trước, không phải hành vi mới. **`crawlAgencies()` (Upwork agency) có Y HỆT
        pattern `active: false` này (dòng riêng, xem mục Upwork phía trên) — đã sửa PHÒNG NGỪA cùng
        lúc dù agency flow tại thời điểm này vẫn CHƯA verify live**, vì cùng root cause chắc chắn sẽ
        tái diễn khi user chạy thật.
      - `src/background/ai/fiverr-analyzer.js` (message `ANALYZE_FIVERR` trong `background.js`) —
        tự chứa như agency/profile-analyzer.js, KHÔNG import chung (test load qua data: URL base64).
        **Bug thật gặp lúc chạy live (2026-09-25), đã sửa**: request body copy nguyên cấu hình
        `agency-analyzer.js` gồm `reasoning: { effort: 'low' }`, nhưng lúc đầu gọi bằng `GPT_MODEL`
        (mặc định `gpt-4.1`) — model này KHÔNG hỗ trợ `reasoning.effort`, OpenAI trả lỗi 400
        `unsupported_parameter`. Model reasoning (`gpt-5.6-terra` qua `UPWORK_GPT_MODEL`) mới nhận
        tham số này. Đã đổi `background.js` gọi `analyzeFiverrSeller` bằng `UPWORK_GPT_MODEL` — biến
        vẫn tên "UPWORK" dù giờ dùng chung cho cả Fiverr (không đổi tên biến/env var, chỉ để tránh
        động vào `scripts/gen-config.mjs`/`.env.example`/`config.js` (gitignore, tự sinh) cho 1 việc
        đổi tên thuần cosmetic — đổi lại nếu user muốn tên rõ nghĩa hơn, vd `RESEARCH_GPT_MODEL`).
        **Mô phỏng theo `agency-analyzer.js` (1 stage), KHÔNG theo pipeline 2 stage identity->contact
        của `profile-analyzer.js`** — vì input crawl Fiverr cũng thưa tương tự agency (chỉ
        name/bio/location/category, không có employment/portfolio/education/external_links như
        Upwork freelancer để tạo tín hiệu hiếm/query LinkedIn riêng), nên 1 search/1 stage là đủ và
        tối ưu token hơn. Input whitelist duy nhất gửi OpenAI: `{name, bio, location, service}` —
        `name` qua `pickSellerName()` (ưu tiên `detail.fiverrName`, fallback `list.sellerName`, coi
        CẢ HAI đều fallback về đúng username là "không có tên thật" chứ không gửi username cho
        OpenAI — chính là fix cho case snuba1 phát hiện ở trên: `assertResearchableSeller()` sẽ
        chặn trước khi gọi API nếu không có tên thật, dù `extractDetail()` phía crawl vẫn cho case
        này qua (gate lỏng, chỉ để tránh lưu trang hoàn toàn trống — 2 lớp gate giống hệt quy ước
        Upwork agency/freelancer). `bio` = `sellerBio` fallback `oneLiner`. `service` = `categories`
        (breadcrumb, dedupe, cap 10). Prompt điều chỉnh cho 1 NGƯỜI (không phải business): LinkedIn
        phải là profile cá nhân `/in/`, không phải company page; chặn tìm ngược `fiverr.com`
        (`blocked_domains`). Cấu hình request giữ y hệt agency (đã verify bằng API thật):
        ~~`reasoning.effort: low`, `search_context_size: low`~~, `max_tool_calls: 1`,
        `tool_choice: required`, Structured Outputs strict, `max_output_tokens: 1000`, `store: false`
        — CHƯA tự chạy lại bằng API thật cho riêng Fiverr (chỉ mock trong test), vì cơ chế y hệt
        agency đã verify nên rủi ro thấp, nhưng vẫn là điều nên biết trước khi coi đã "verify" 100%.
        **Cập nhật 2026-09-25 sau khi đọc doc chính thức OpenAI** (`developers.openai.com/api/docs/
        guides/tools-web-search`, `.../guides/reasoning`) để tìm hướng cải thiện hit-rate thấp thấy
        được lúc test live (nhiều seller trả về `null` hết ngoài `name`/`location`, xem log batch
        5 lead 2026-09-25): đổi `search_context_size: 'low'` -> `'medium'` (doc: `'low'` chỉ hợp
        "simple lookups", tìm 1 người thật từ input thưa name/bio/location/service cần nhiều ngữ
        cảnh kết quả search hơn — đổi này chỉ tăng token input mỗi request, KHÔNG tăng số lần gọi
        API). `reasoning.effort: 'minimal'` từng thử rồi CHỐT LẠI `'low'` — **xác nhận thật bằng lỗi
        400 khi chạy live** (2026-09-25): tra đúng trang model chính thức
        `developers.openai.com/api/docs/models/gpt-5.6-terra` xác nhận model này chỉ hỗ trợ
        `none, low, medium (default), high, xhigh, max` — KHÔNG có `minimal` (giá trị đó tồn tại ở
        doc guide chung/model khác, không phải model đang dùng — bài học: phải tra đúng trang model
        cụ thể, không suy rộng từ guide chung). `none` có được model hỗ trợ thật nhưng doc guide mô
        tả use-case của nó là "latency-critical tasks that do not benefit from any reasoning or
        multi-chained tool calls" — không khớp task này (có đúng 1 tool call `web_search` + cần model
        tự đánh giá kết quả), nên KHÔNG áp dụng dù hợp lệ về mặt cú pháp — chỉ ghi lại đây phòng cần
        tối ưu thêm sau, có xác nhận user trước khi thử.
        **2 lever mới (2026-09-25), có căn cứ tài liệu, đã áp dụng**:
        1. `tools[0].user_location: {type:'approximate', country}` — bias địa lý cho `web_search`
           theo location seller đã crawl, xác nhận qua `tools-web-search` guide. `countryCodeFromName()`
           map tên quốc gia thô (vd "Ukraine") sang ISO alpha-2 bằng `Intl.DisplayNames` built-in
           (build bảng tên→code THẬT từ locale data lúc module load, không tự chế bảng tay) — không
           map được thì bỏ hẳn field, không đoán/không gửi giá trị rỗng.
           **Bug thật gặp lúc chạy live (2026-09-25), đã sửa**: seller "Paul Casselle" (location
           "United Kingdom") làm OpenAI trả lỗi 400 `"Invalid input UK: 'country' must be an ISO
           3166-1 code"`. Root cause xác nhận bằng `node -e` trực tiếp: vòng lặp build bảng AA->ZZ có
           8 cặp mã 2 ký tự là ALIAS lịch sử của mã ISO hiện hành nhưng `Intl.DisplayNames` trả về
           CÙNG tên hiển thị cho cả 2 (vd "GB" và "UK" đều hiển thị "United Kingdom"; còn lại: HV/BF,
           DY/BJ, ZR/CD, YU/RS, FX/FR, SU/RU, TP/TL) — lặp alphabet nên mã alias xử lý SAU ghi đè mã
           ISO đúng trong map (`"united kingdom"` bị ghi đè thành `"UK"` thay vì `"GB"`, vì U > G).
           Sửa bằng cách chuẩn hoá qua `new Intl.Locale('und', {region: code}).region` (built-in
           BCP47 canonicalization, biết sẵn bảng alias) trước khi `map.set()` — vẫn dùng platform
           feature có sẵn, không tự chế danh sách alias tay. Test:
           `tests/fiverr-analyzer.test.mjs` — "United Kingdom" phải map ra `GB`.
        2. `prompt_cache_key: 'hunt-ex-fiverr-seller-contact-research'` — mọi seller Fiverr dùng
           chung 1 `instructions` + `text.format.schema` (chỉ `input` đổi mỗi seller), đúng kịch bản
           prompt caching muốn tối ưu (giảm tới 90% giá token phần prefix trùng lặp). Xác nhận qua
           3 nguồn độc lập (guide `prompt-caching`, community thread "prompt_cache_key", search riêng
           cho tên field) sau khi 1 lần fetch đầu tiên tóm tắt SAI (đề xuất cấu trúc lại
           `instructions` → `input` với `prompt_cache_breakpoint`, hoá ra không cần thiết — chỉ cần
           đúng field top-level này). **CHƯA verify `usage.input_tokens_details.cached_tokens > 0`
           thật bằng chạy live** — xem trong log "Token usage" mới thêm (console service worker,
           2026-09-25) sau khi test batch tiếp theo. Không rõ tương tác với `store: false` đang dùng
           có ảnh hưởng cache hay không, doc không đề cập — cần quan sát log thật để biết.
           **Sửa 1 lỗi tên field trong chính đoạn note này**: ghi nhầm `prompt_tokens_details` (tên
           Chat Completions API cũ) — Responses API dùng đúng `input_tokens_details`/
           `output_tokens_details`. Log "Raw OpenAI API response" đã có sẵn từ trước cũng CHỨA
           `data.usage` rồi (không phải thiếu, chỉ là nằm lẫn trong object lớn) — dòng log "Token
           usage" mới thêm chỉ tách riêng ra cho dễ đọc, không phải field mới xuất hiện.
        Test mới: `tests/fiverr-analyzer.test.mjs` — verify `user_location` đúng khi map được quốc
        gia, và bị bỏ qua đúng khi không map được (không đoán mã quốc gia bừa).
        **Bỏ field `name` khỏi `OUTPUT_SCHEMA` (2026-09-25, theo yêu cầu user)**: model đã thấy tên
        trong chính `researchInput.name` gửi lên rồi, bắt nó output lại y hệt chỉ tốn output token mà
        code không dùng để verify/đối chiếu gì (trước đây chỉ `cleanText(raw?.name,200) ||
        researchInput.name` — hoàn toàn có thể fallback thẳng `researchInput.name`, không cần model
        tham gia). `location` KHÔNG cần sửa gì thêm — field này CHƯA BAO GIỜ có trong `OUTPUT_SCHEMA`
        gửi cho model (chỉ build deterministic từ `researchInput.location` trong
        `normalizeResearchResult()`), user tưởng model trả cả 2 field nhưng thực ra chỉ `name` là dư.
        **Retry khi kết quả rỗng do sampling variance (2026-09-25, bug thật user báo cáo)**: cùng 1
        seller chạy Auto-hunt 2 lần, lần 1 tìm được contact, lần 2 (input y hệt) trả null hết — bản
        chất ngẫu nhiên của model/search, KHÁC với lỗi mạng (`fetchWithRetry()` đã retry riêng
        429/5xx, không liên quan case này). Đã tách logic gọi API ra `callOpenAiOnce()` +
        `isEmptyResult()` (không email/phone/linkedin/website/other_contacts nào) trong
        `analyzeFiverrSeller()`: nếu lần gọi đầu rỗng hoàn toàn, tự động gọi lại ĐÚNG 1 LẦN NỮA
        (input y hệt, không đổi gì) — chỉ tốn thêm 1 lệnh gọi cho đúng case bị miss, KHÔNG ảnh hưởng
        seller đã tìm được ngay từ lần đầu. Lỗi ở lần retry (network/parse) thì giữ nguyên kết quả
        rỗng của lần 1, không làm hỏng cả lead. **Khác với ý "max_tool_calls: 2 + retry query thứ 2"
        liệt kê ngay dưới đây** — đó là để model tự thử NỘI DUNG QUERY khác trong CÙNG 1 lần gọi khi
        chưa đủ tin cậy (như profile-analyzer.js), còn cái vừa thêm là gọi lại NGUYÊN VẸN cả request
        (input giống hệt) như 1 lần "thử vận may" độc lập khi model đã trả về hoàn toàn trống — 2 cơ
        chế bổ sung nhau, không thay thế nhau. Test: `tests/fiverr-analyzer.test.mjs` — retry khi rỗng
        và giữ kết quả mới nếu tìm được, không retry khi đã có contact ngay từ đầu, giữ kết quả rỗng
        của lần 1 nếu chính lần retry cũng lỗi.
        Các hướng khác đã cân nhắc nhưng CHƯA áp dụng (user chưa chọn, để đây phòng cần quay lại):
        cho phép `max_tool_calls: 2` + sửa prompt cho retry query thứ 2 khi lần đầu không đủ tin cậy
        (profile-analyzer.js làm việc này bằng 2 stage code-constructed query, agency/fiverr để model
        tự quyết định toàn bộ query trong 1 lượt); thêm `include: ['web_search_call.action.sources']`
        + đối chiếu `source_url` model trả về với danh sách URL model THẬT SỰ đã search qua (giống
        `isTrustedContactSource()` của profile-analyzer.js) thay vì tin thẳng field model tự điền —
        hiện agency/fiverr không có bước validate chéo này, rủi ro model "bịa" `source_url` dù không
        bịa `email`/`url` (thấp nhưng không phải zero).
        Output CÙNG SHAPE với agency/freelancer (`name/location/website/emails/phones/linkedin/
        other_contacts`) theo yêu cầu user để lưu chung 1 database — chỉ khác 2 field deterministic
        cuối: `source: 'fiverr'`, `type: 'freelancer'` (Fiverr không có phân biệt independent/agency
        qua URL search như Upwork `pt`, nên luôn gắn `'freelancer'`) và `fiverr_profile_url` (thay
        `upwork_profile_url`, trỏ về trang `/username` của seller — không phải `gigUrl` cụ thể).
        KHÔNG cache (khác freelancer Upwork có `profile-research-cache.js`) — agency cũng không
        cache, input thưa tương tự nên theo cùng quyết định, đơn giản hơn.
        Test: `tests/fiverr-analyzer.test.mjs` (6 case, cùng khuôn `agency-analyzer.test.mjs`) —
        kèm riêng 2 test cho đúng bug snuba1: fallback tên qua list-card khi detail chỉ có username,
        và gate chặn hẳn API call khi CẢ HAI đều fallback username.
      Nút "Crawl thủ công" chưa tính tới case Fiverr (message contract khác `START_CRAWL` mà
      LinkedIn/Upwork freelancer dùng) nhưng không cần sửa gì — content script Fiverr tự trả lỗi rõ
      ràng ("Fiverr detail analysis requires Auto-hunt mode.") nếu nhận nhầm `START_CRAWL`.
- [x] Chạy song song nhiều Auto-hunt cùng lúc (2026-09-25) — user xác nhận sẽ chủ động chạy 2-3 case
      song song để tiết kiệm thời gian vận hành (vd Upwork freelancer + Upwork agency + Fiverr cùng
      lúc). Đã audit: side panel gắn theo CỬA SỔ Chrome (không phải theo tab — chuyển tab trong cùng
      cửa sổ vẫn dùng chung 1 instance `popup.js`, xem comment đầu file về `currentPlatform`/
      `activeCrawlTabId`/`agencyCrawlStopRequested`), nên PHẢI chạy mỗi case ở 1 CỬA SỔ Chrome riêng
      (không phải chỉ tab khác) để 3 biến này không bị giẫm lên nhau (Stop nhầm crawl, lẫn
      `activeCrawlTabId`). Giữa các cửa sổ, background service worker + OpenAI call không có shared
      state nên chạy song song không có vấn đề gì thêm — CHỈ trừ `SAVE_LEADS`
      (`local-lead-repository.js` `addLeads()`) đang read-modify-write không atomic, lý thuyết có thể
      mất lead nếu 2 cửa sổ cùng gọi `SAVE_LEADS` trong cùng 1 khoảnh khắc (xác suất thấp vì mỗi
      batch chỉ gọi 1 lần lúc kết thúc, sau vài phút crawl) — CHƯA sửa (user chưa yêu cầu, chỉ mới
      biết rủi ro), để đây nếu sau này cần làm atomic.
      **Tách list leads hiển thị thành 4 nhóm có label riêng** (`popup.html`/`popup.css`/`popup.js`)
      để demo dễ theo dõi kết quả từng case đang chạy song song, thay vì 1 list chung 20 lead gần
      nhất lẫn lộn cả platform (trước đây `refreshLeads()` không phân nhóm). 4 nhóm cố định: LinkedIn
      / Upwork · Freelancer / Upwork · Agency / Fiverr, mỗi nhóm có `<ul>`/counter riêng, vẫn giới
      hạn hiển thị 20 lead gần nhất MỖI NHÓM (không phải 20 tổng cộng như trước). Discriminator
      `leadCategoryKey()`: `lead.platform` KHÔNG đủ để tách Freelancer/Agency (cả 2 đều ghi
      `platform: 'upwork'` — chỉ `lead.analysis.type` mới phân biệt được, field này chỉ tồn tại sau
      khi phân tích AI thành công). Lead Upwork bị lỗi phân tích (`analysisError`, không có
      `lead.analysis`) mặc định rơi vào nhóm Freelancer (quyết định user 2026-09-25 — chấp nhận có
      thể sai nhãn nếu lead lỗi thực ra từ crawl Agency, đơn giản hơn là thêm 1 nhóm "chưa xác định"
      riêng). Tổng số lead (`#leads-count` ở đầu section) vẫn đếm TẤT CẢ lead bất kể nhóm, không đổi.
      Nhân tiện sửa 1 chuỗi tiếng Việt sót lại trái quy ước "UI 100% tiếng Anh" (2026-09-23):
      `.leads-list:empty::before` cũ là `"Chưa có lead nào."`, đổi thành `"No leads yet."` — phát
      hiện vì đúng CSS rule này giờ áp dụng cho cả 4 `<ul>` rỗng thay vì chỉ 1 cái.
      **2 bug thật user báo cáo lúc chạy live 2 cửa sổ song song (Upwork freelancer + Fiverr,
      2026-09-25), đã sửa cả 2 (`popup.js`):**
      1. Status "chồng lẫn lộn" giữa 2 cửa sổ — `chrome.runtime.sendMessage({type:
         'CRAWL_PROGRESS'})` (`upwork.js:445`, content script freelancer báo tiến độ modal) broadcast
         TOÀN EXTENSION, không giới hạn tab/cửa sổ nào cả. Listener cũ ở popup.js không lọc `sender`,
         nên panel cửa sổ B cũng nhận và hiện luôn progress của crawl đang chạy ở cửa sổ A. Sửa: lọc
         `sender.tab.id === activeCrawlTabId` (biến module-level đã có sẵn, chính là tab mà CỬA SỔ
         NÀY đang tự theo dõi) — mỗi panel giờ chỉ hiện progress của crawl do chính nó khởi động.
      2. List nhóm platform hiện sai/cũ giữa các cửa sổ — `refreshLeads()` trước đây chỉ chạy theo
         sự kiện của CHÍNH cửa sổ đó (tự crawl xong/dừng/xoá/mở panel), không tự biết khi cửa sổ
         khác vừa `SAVE_LEADS`. Thêm listener `chrome.storage.onChanged` (bắn ở MỌI context kể cả
         side panel cửa sổ khác khi `storage.session` đổi) lọc đúng key `huntex_leads` rồi gọi lại
         `refreshLeads()` — mọi cửa sổ đang mở tự đồng bộ list gần như real-time, không cần tự bấm
         gì. Lọc đúng key để không refetch vô ích mỗi khi `profile-research-cache.js` ghi cache
         (cùng dùng `storage.session`, khác key).
      Cả 2 fix chỉ ảnh hưởng khi CHẠY SONG SONG NHIỀU CỬA SỔ — dùng 1 cửa sổ như trước giờ vẫn y hệt
      hành vi cũ (mỗi cửa sổ chỉ có đúng 1 `activeCrawlTabId`/không có ghi storage nào khác để so
      sánh).
- [x] Thêm field `headline` (title nghề, vd "Google Ads Partner Agency Owner") vào output cả 3 flow
      (2026-09-25, theo yêu cầu user). Trước đây field này CÓ được cào (freelancer:
      `identity.headline` từ `h4.title` trên search-list card; agency: `tagline` từ
      `[data-test="agency-title"]`; Fiverr: `oneLiner` từ `.one-liner` trên gig detail) nhưng CHỈ
      dùng làm tín hiệu input cho AI (freelancer: build query tìm LinkedIn; agency/fiverr: gộp vào
      `description`/`bio` fallback) — không có trong output cuối, vì đây chính là field `job` đã bị
      BỎ khỏi output freelancer+agency ở đợt dọn 2026-09-24 ("không có downstream sử dụng" — giờ có
      rồi, user muốn hiển thị trong UI card).
      Quyết định: lấy NGUYÊN VĂN từ dữ liệu đã cào, KHÔNG qua AI (deterministic) — không tốn thêm
      token/lần gọi API, luôn khớp đúng y hệt text gốc trên Upwork/Fiverr, không có rủi ro model diễn
      giải sai. Cách lấy KHÁC NHAU theo từng file vì lý do kỹ thuật:
      - `profile-analyzer.js` (`buildFinalResult()`): dùng thẳng `identityInput.headline` — field
        này ĐÃ được `cleanText()` sẵn trong `buildIdentityInput()` (dùng để build search query),
        không cần đọc lại `profileData` gốc.
      - `agency-analyzer.js`/`fiverr-analyzer.js`: đọc thẳng từ raw crawl (`agencyData?.tagline` /
        `sellerData?.detail?.oneLiner`) trong `analyzeAgency()`/`analyzeFiverrSeller()`, KHÔNG qua
        `buildResearchInput()`/`researchInput` — object đó chỉ là whitelist input gửi OpenAI
        (`description`/`bio` đã dùng tagline/oneLiner làm FALLBACK khi overview/sellerBio rỗng,
        không giữ lại bản riêng) nên không có sẵn field tách biệt để lấy lại; đọc thẳng raw data an
        toàn hơn là sửa whitelist (giữ payload gửi AI không đổi, tránh phình token ngoài ý muốn).
      Seller Fiverr loại Agency template (xem `extractDetail()` nhánh agency trong `fiverr.js`,
      2026-09-25) không có `.one-liner` -> `oneLiner` là `undefined` -> `headline: null`, không phải
      bug.
      UI (`popup.js` `buildAnalysisCard()`): thêm dòng "Headline" trong `<dl>` fields, đặt TRƯỚC
      Location — chỉ hiện khi có giá trị (`if (analysis.headline) appendTextField(...)`).
      Không cần sửa `OUTPUT_SCHEMA`/test whitelist AI (`Object.keys(input)` trong
      `agency-analyzer.test.mjs`/`fiverr-analyzer.test.mjs` vẫn đúng `['name','description',
      'location','service']`/`['name','bio','location','service']` — field mới không đi qua đường
      whitelist đó) — đã chạy lại toàn bộ `node --test tests/**/*.test.*` (46 test) xác nhận không
      test nào vỡ, không cần thêm test mới (không có assertion `deepEqual` nào so khớp NGUYÊN object
      kết quả, chỉ so từng field con nên field mới không phá test cũ).
- [ ] Endpoint + schema backend CRM nội bộ Ecomdy (khi có, điền vào Options, đổi `huntexLeadStorageMode` sang `remote`).
- [x] Bỏ hẳn `.env`/`scripts/gen-config.mjs`/`src/shared/config.js`, chuyển OpenAI API key sang
      nhập trực tiếp trên UI (2026-09-25, theo yêu cầu user — marketing team tự cài extension,
      KHÔNG tự tạo được file `.env`, luồng cũ bắt buộc phải có người build/dev làm hộ 2 bước mỗi
      lần key hết hạn hoặc cài máy mới). Chi tiết đầy đủ ở mục "OpenAI API key" phía trên — mục
      này chỉ ghi lại NHỮNG GÌ ĐÃ XOÁ/ĐỔI để đối chiếu nếu cần tìm lại code cũ qua git log:
      - Đã xoá: `.env.example` (template, tracked), `scripts/gen-config.mjs` (generator, tracked),
        `src/shared/config.js` (file sinh ra chứa key thật, gitignore — KHÔNG xoá `.env` thật của
        user vì đó là bản backup duy nhất còn giữ key để copy dán vào UI mới, tự hỏi user trước
        khi xoá nốt).
      - File mới: `src/shared/api-key-store.js` (get/setApiKey qua `chrome.storage.sync`, key
        `huntexOpenAiApiKey`), `src/background/ai/key-tester.js` (`testApiKey()`, gọi
        `GET /v1/models` — không tốn token, khác `/v1/responses` các file analyzer khác dùng).
      - `background.js`: bỏ `import { OPENAI_API_KEY, UPWORK_GPT_MODEL } from '../shared/config.js'`,
        thêm `const GPT_MODEL = 'gpt-5.6-terra'` hardcode (đổi tên từ `UPWORK_GPT_MODEL` — hết lý do
        giữ tên lịch sử sau khi bỏ biến `.env`, xem TODO cũ ở mục Upwork nói về việc này — TODO đó
        coi như đã xong luôn). Model KHÔNG lên UI cho user chọn (quyết định user: "thống nhất dùng
        model này cho tất cả") — khác hẳn cách xử lý API key. Thêm `requireApiKey()` (throw lỗi rõ
        ràng trỏ user quay lại panel) gọi trước MỌI handler cần OpenAI (`ANALYZE_INTENT`/
        `ANALYZE_AGENCY`/`ANALYZE_FIVERR`, và trong `analyzeProfileCached()` sau bước check cache
        — cache hit thì không cần key). Thêm 3 message mới: `GET_API_KEY_STATUS` -> `{hasKey}`,
        `SAVE_API_KEY {apiKey}` -> `{saved: true}`, `TEST_API_KEY {apiKey?}` -> `{ok, error?}`.
      - 4 file `ai/*.js` (`intent-analyzer.js`/`agency-analyzer.js`/`fiverr-analyzer.js`/
        `profile-analyzer.js`): sửa JSDoc + đổi câu error "OpenAI API key is not configured" (bỏ
        nhắc `.env`/`gen-config.mjs`, giờ nói "open the Hunt-Ex panel and enter your API key
        first") — check `if (!apiKey)` bên trong các hàm này giờ hầu như không bao giờ chạm tới
        (background đã chặn từ `requireApiKey()` trước khi gọi), giữ lại làm lớp phòng thủ nếu sau
        này có chỗ khác gọi thẳng các hàm này mà quên check.
      - UI onboarding (side panel, `popup.html`/`popup.js`): thêm `#apikey-view` — panel mở lần đầu
        (chưa có key trong storage) hiện màn nhập key + nút "Save & test key" THAY VÌ `#home-view`.
        `initView()` (thay `showHome()` gọi thẳng lúc cuối file cũ) gọi `GET_API_KEY_STATUS` để
        quyết định hiện view nào. Nút Save & test: gọi `TEST_API_KEY` trước, CHỈ `SAVE_API_KEY` nếu
        test pass — tránh lưu nhầm key gõ sai (test fail thì báo lỗi tại chỗ, không lưu, user sửa
        lại gõ tiếp). `showApiKeyGate()`/`showHome()` cũng ẩn/hiện `#leads-section` (id mới thêm
        cho card leads) theo view — lúc chưa có key thì ẩn luôn danh sách lead cho đỡ rối, dù leads
        cũ (nếu có) không thật sự phụ thuộc key.
      - UI Settings (`options/`): thay hẳn khối `<p class="hint">` cũ ("key đã cấu hình qua .env")
        bằng ô `apikey-input` + nút "Test key" riêng. `apikey-input` dùng CHUNG vòng lặp
        load()/save-btn generic đã có sẵn (thêm 1 dòng vào `FIELDS`, tái dùng logic cũ thay vì viết
        code riêng) — nút "Save" chung ở cuối trang lưu TRỰC TIẾP không bắt buộc test trước (khác
        hẳn onboarding — đây không phải lần đầu, và user có thể đang sửa nhiều field khác cùng lúc
        như storage-mode/backend-url). Nút "Test key" độc lập, test đúng giá trị đang gõ trong ô
        (không cần bấm Save trước) — dùng khi nghi ngờ key hết hạn/hết quota.
      - `options.css`: thêm biến `--danger` (+ dark mode), đổi `.status` sang mặc định màu lỗi kèm
        `.status-success` override — trước đó `.status` của trang Settings LUÔN xanh (chỉ dùng cho
        thông báo "Saved.", chưa từng cần hiện lỗi) nên phải thêm state lỗi cho kết quả "Test key"
        thất bại; thêm `.btn-ghost` (mượn nguyên style từ `popup.css`, trang Settings trước đó
        chưa có biến thể nút này).
      - `.gitignore` giữ nguyên (`'.env`, `src/shared/config.js` vẫn nằm trong danh sách ignore dù
        2 file/luồng đó không còn ai tạo ra nữa) — CỐ Ý không xoá 2 dòng này: nếu sau này ai đó lỡ
        tạo lại `.env` (quen tay từ luồng cũ) hoặc chạy nhầm script cũ từ 1 branch cũ, vẫn không bị
        lỡ tay `git add -A` commit nhầm key thật.
      - Test mới: `tests/key-tester.test.mjs` (200 -> `{ok:true}`, 401 -> lỗi rõ "invalid API
        key", lỗi khác giữ nguyên message từ OpenAI, network error không throw ra ngoài mà trả
        `{ok:false, error}`), `tests/api-key-store.test.mjs` (round-trip get/set qua
        `chrome.storage.sync` mock, cùng khuôn mock với `tests/profile-research-cache.test.mjs`
        nhưng cho `storage.sync` thay vì `storage.session`). Đã chạy lại toàn bộ
        `node --test tests/**/*.test.*` (53 test, tăng từ 47 — không có test nào của luồng cũ bị
        xoá vì `config.js`/`gen-config.mjs` chưa từng có test riêng).
      **CHƯA verify live** (chưa tự chạy thử end-to-end trên Chrome thật trong session này — mới
      `node --check` cú pháp + chạy test suite): luồng onboarding thật (mở panel lần đầu -> thấy
      đúng `#apikey-view` -> nhập key thật -> Test key thật gọi được OpenAI -> Save -> chuyển sang
      home-view -> Auto-hunt dùng đúng key vừa lưu), và nút "Test key"/"Save" ở Settings. Cần user
      tự mở lại extension (reload ở `chrome://extensions` vì `background.js`/`manifest.json` liên
      quan đã đổi) rồi thử tay trước khi coi đây là xong hẳn.
- [ ] Research provider Exa.ai làm lựa chọn khác cạnh OpenAI cho ANALYZE_PROFILE/AGENCY/FIVERR
      (2026-09-28, theo yêu cầu user — xem mục "Research provider" ở trên cho toàn bộ chi tiết thiết
      kế/quyết định). Đã xong về code + test (`analyzeProfileWithExa`/`analyzeAgencyWithExa`/
      `analyzeFiverrSellerWithExa`, `testExaApiKey`, UI onboarding + Settings, `manifest.json` thêm
      `host_permissions` cho `api.exa.ai`) — 28 test mới, toàn bộ `node --test tests/**/*.test.*`
      (81 test, tăng từ 53) pass bằng `fetch` mock. **CHƯA verify live bằng key Exa thật** — đây là
      việc còn lại DUY NHẤT trước khi coi tính năng này là hoàn chỉnh, cần user tự làm vì Claude
      không có key Exa thật để tự test. Checklist khi verify:
      1. Onboarding: chọn radio "Exa.ai" -> nhập key thật -> "Save & test key" phải gọi được
         `GET /agent/runs?limit=1` thật (không set-up gì thêm phía Exa dashboard trước đó ngoài tạo
         key) -> chuyển sang home-view.
      2. Chạy Auto-hunt Upwork freelancer/agency và Fiverr với Exa đang chọn — xác nhận: request
         POST/GET thật đúng như research (status chuyển queued -> running -> completed, không kẹt ở
         running quá lâu so với timeout 120s), `output.structured` parse đúng, kết quả tìm được
         website/LinkedIn/email/phone có hợp lý so với thử cùng lead bằng OpenAI không.
      3. Log `console.log('[Hunt-Ex][background] Exa usage/cost for'...)` trong console service
         worker — đối chiếu shape thật của `usage`/`costDollars` (hiện code chỉ pass-through nguyên
         object vì CHƯA biết chắc field con, xem mục "Research provider") — nếu shape khác dự đoán,
         cập nhật lại comment ở 3 file `ai/*-analyzer.js` cho khớp thực tế, không cần đổi code (đã
         pass-through nguyên vẹn).
      4. Quan sát domain-avoidance: xem model có lỡ trả về link `upwork.com`/`fiverr.com` không dù
         đã có soft instruction — nếu có, xác nhận `stripUpworkUrl()`/`stripFiverrUrl()` đã tự lọc
         đúng (nhìn `result.website.url`/`result.linkedin.url` phải là `null` hoặc domain khác).
      5. So sánh hit-rate/chi phí thực tế 1 batch nhỏ (~10-15 lead) giữa Exa (`effort: 'medium'`,
         ~$0.10/run theo pricing cố định, x1-2 nếu có retry-khi-rỗng) và OpenAI hiện tại (đã có
         benchmark cũ trong memory: ~$0.085/lead, 53% LinkedIn hit-rate trên Upwork) — quyết định
         provider nào là mặc định thật sự nên dùng cho team marketing.
      Các câu hỏi/đánh đổi CHƯA hỏi lại user (để đây, chỉ hỏi nếu bước verify live cho thấy cần
      thiết — đừng tự đổi trước khi có dữ liệu thật):
      - `effort: 'medium'` cố định cho cả 3 luồng — có thể cần khác nhau theo độ thưa dữ liệu
        (giống nhận xét cũ `search_context_size` OpenAI: input thưa cần context cao hơn) một khi có
        số liệu hit-rate thật để so sánh `low` vs `medium` vs `high`.
      - Freelancer Exa gộp 1 run (identity+contact) thay vì 2 stage như OpenAI — nếu hit-rate thấp
        hơn hẳn OpenAI, có thể cần tách lại thành 2 run Exa riêng (dùng `previousRunId` — có trong
        request schema Exa nhưng CHƯA dùng, xem research — để run 2 kế thừa context run 1) thay vì
        gộp, đánh đổi cost/latency ngược lại.
      - Chưa dùng `budget.maxCostDollars`/`systemPrompt`/`input.exclusion` (đều có trong request
        schema Exa nhưng không cần cho use-case hiện tại) — thêm sau nếu cần kiểm soát chi phí per-run
        chặt hơn effort cố định, hoặc cần loại trừ domain cụ thể qua field chuyên dụng nếu Exa bổ
        sung sau này.
