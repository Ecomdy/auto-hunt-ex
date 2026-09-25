# Hunt-Ex

Chrome extension (Manifest V3) that helps the Ecomdy marketing team find leads on
**LinkedIn**, **Upwork**, and **Fiverr**.

Flow: open the panel → pick one of the 3 platforms → describe the target customer → AI (OpenAI)
turns it into a search query + filter keywords → click one button, the tool **opens a tab,
searches, crawls, and filters automatically** → view/save/export leads to CSV.

See [CLAUDE.md](CLAUDE.md) for architecture details and code conventions.

## Marketing team guide

Slide deck walkthrough for marketing (install & login, flow, filters, contact hit-rate, data
fields): https://claude.ai/artifact/T5V8QW9a5UbyTtZ87rDKKf?sk=CIJYVS_l-VTHEG6qfrmDpQ

## Setup

No build step, no Node.js required to run this — just load the folder and paste in an API key:

1. Open Chrome → `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select this project folder
3. Click the extension icon in the toolbar → the **side panel** opens on the right (not a
   popup — it stays open when you switch tabs, so you can analyze then switch over to crawl)
4. First time only: paste your OpenAI API key into the screen that appears, click **Save & test
   key**. The extension checks the key works before saving it (stored in `chrome.storage.sync`,
   nothing to configure on disk).

Changing the key later: open **Settings** (link at the bottom of the panel) → update the OpenAI
API key field → **Test key** to verify → **Save**.

## Running tests

No `npm install` needed (no `package.json` / external dependency):

```
node --test tests/**/*.test.*
```

## Current status

- ✅ LinkedIn — **search post** page (`linkedin.com/search/results/content/?keywords=...`):
  crawling implemented (author name, headline, post content, posted time, profile link),
  written and verified against real sample HTML.
- ✅ **Full automation** ("Auto-hunt" button): opens a new LinkedIn tab with the AI-suggested
  query, waits for the page to load, crawls, and filters out leads matching exclude keywords —
  no manual tab switching or typing a search query. Known limits: only crawls what's already
  rendered (no auto-scroll yet), no per-post permalink (uses the author's profile link instead),
  no "Promoted" post detection yet.
- ✅ **Platform selection screen**: opening the panel shows 3 buttons (LinkedIn/Upwork/Fiverr);
  each opens the matching lead-hunting UI for that platform.
- ✅ Upwork — **search talent** page (`upwork.com/nx/search/talent?q=...`): crawling
  implemented (name, headline, location, rate, job success %, badges, skills, etc.), plus a
  profile-detail AI research stage (identity + public contact info) and an agency flow.
- ✅ Fiverr — search-list + gig-detail crawling implemented, plus AI contact research.
- ⏳ Lead storage: local (`chrome.storage.session`) by default for testing; the internal Ecomdy
  CRM backend has no endpoint yet.

See the TODO section at the end of [CLAUDE.md](CLAUDE.md) for the full, up-to-date list of what's
done vs. pending per platform.
