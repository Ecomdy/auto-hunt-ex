const $ = (id) => document.getElementById(id);

const FIELDS = {
  'storage-mode': 'huntexLeadStorageMode',
  'backend-url': 'huntexBackendUrl',
  'backend-key': 'huntexBackendApiKey',
};

async function load() {
  const stored = await chrome.storage.sync.get(Object.values(FIELDS));
  for (const [elId, key] of Object.entries(FIELDS)) {
    if (stored[key] !== undefined) $(elId).value = stored[key];
  }
}

$('save-btn').addEventListener('click', async () => {
  const toSave = {};
  for (const [elId, key] of Object.entries(FIELDS)) {
    toSave[key] = $(elId).value;
  }
  await chrome.storage.sync.set(toSave);
  $('status').textContent = 'Saved.';
  setTimeout(() => ($('status').textContent = ''), 2000);
});

load();
