const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/content-scripts/upwork.js'), 'utf8');

function makeHarness({ backButton, escapeCloses = false, historyCloses = false } = {}) {
  const calls = [];
  const location = {
    pathname: '/nx/search/talent/details/~01e480d361d97d5ab3/profile',
    get href() { return `https://www.upwork.com${this.pathname}`; },
  };
  const close = () => { location.pathname = '/nx/search/talent'; };
  const button = backButton === undefined ? null : {
    click() { calls.push('back-button'); if (backButton) close(); },
  };
  const modal = {
    closest() { return null; }, // The BackButton lives in the slider header, outside profile details.
  };
  const document = {
    querySelector(selector) {
      if (selector === '[data-test-route="modal-profile-details"]') return modal;
      if (selector === '[data-test="BackButton"]') return button;
      return null;
    },
    dispatchEvent() { calls.push('escape'); if (escapeCloses) close(); },
  };
  const window = {
    location,
    history: { back() { calls.push('history'); if (historyCloses) close(); } },
  };
  const context = {
    window,
    document,
    KeyboardEvent: class {},
    MouseEvent: class {},
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
  };
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    waitFor = async (check) => check() || null;
    globalThis.modalTest = { closeProfileModal, openProfileModal };
  })();`);
  vm.runInNewContext(instrumented, context);
  return { ...context.modalTest, location, calls, close };
}

test('closes with BackButton in the slider header outside profile details', async () => {
  const harness = makeHarness({ backButton: true });
  await harness.closeProfileModal();
  assert.equal(harness.location.pathname, '/nx/search/talent');
  assert.deepEqual(harness.calls, ['back-button']);
});

test('uses Escape, then browser Back only if earlier close attempts fail', async () => {
  const escape = makeHarness({ backButton: false, escapeCloses: true });
  await escape.closeProfileModal();
  assert.deepEqual(escape.calls, ['back-button', 'escape']);

  const history = makeHarness({ backButton: false, historyCloses: true });
  await history.closeProfileModal();
  assert.deepEqual(history.calls, ['back-button', 'escape', 'history']);
});

test('reports a failed close instead of allowing the next profile to open', async () => {
  const harness = makeHarness({ backButton: false });
  await assert.rejects(harness.closeProfileModal(), /Could not close the Upwork profile modal/);
  await assert.rejects(
    harness.openProfileModal({ id: 'talent-tile-next' }, 'https://www.upwork.com/freelancers/~014fdf7aff9688b947'),
    /Cannot open another profile/
  );
  assert.equal(harness.location.pathname, '/nx/search/talent/details/~01e480d361d97d5ab3/profile');
});

test('rejects a clicked card when Upwork opens a different contractor route', async () => {
  const harness = makeHarness();
  harness.close();
  const card = {
    id: 'talent-tile-next',
    dispatchEvent() {
      harness.location.pathname = '/nx/search/talent/details/~01e480d361d97d5ab3/profile';
    },
  };
  await assert.rejects(
    harness.openProfileModal(card, 'https://www.upwork.com/freelancers/~014fdf7aff9688b947'),
    /Opened the wrong profile/
  );
});
