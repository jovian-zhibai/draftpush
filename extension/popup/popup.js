const PLATFORMS = {
  xiaohongshu: '小红书',
  wechat_mp: '公众号',
  douyin: '抖音',
};

const state = {
  items: [],
  selections: {},
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  checkHostConnection();
  await loadPendingItems();

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'refresh' });
    setTimeout(loadPendingItems, 500);
  });

  document.getElementById('syncBtn').addEventListener('click', handleSync);

  document.getElementById('settingsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

async function checkHostConnection() {
  const resp = await chrome.runtime.sendMessage({ type: 'check_host' });
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');

  if (resp.connected) {
    dot.className = 'status-dot connected';
    text.textContent = 'Native Host 已连接';
  } else {
    dot.className = 'status-dot disconnected';
    text.textContent = 'Native Host 未连接 — 请检查安装';
  }
}

async function loadPendingItems() {
  const resp = await chrome.runtime.sendMessage({ type: 'get_pending' });
  state.items = resp.items || [];
  renderItems();
}

function renderItems() {
  const list = document.getElementById('contentList');
  const empty = document.getElementById('emptyState');
  const actions = document.getElementById('actions');

  if (state.items.length === 0) {
    list.innerHTML = '';
    list.appendChild(empty);
    empty.style.display = 'block';
    actions.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  actions.style.display = 'block';

  list.innerHTML = state.items
    .map((item, index) => {
      if (!state.selections[index]) {
        state.selections[index] = {
          checked: false,
          platforms: (item.platforms || ['xiaohongshu']).reduce(
            (acc, p) => ({ ...acc, [p]: true }),
            {}
          ),
          status: null,
          statusText: '',
        };
      }

      const sel = state.selections[index];
      const date = item.created_at
        ? new Date(item.created_at).toLocaleDateString('zh-CN')
        : '';
      const source = item.source_skill || '';

      const platformTags = Object.keys(PLATFORMS)
        .map((pid) => {
          const selected = sel.platforms[pid] ? 'selected' : '';
          return `<span class="platform-tag ${selected}" data-index="${index}" data-platform="${pid}">${PLATFORMS[pid]}</span>`;
        })
        .join('');

      let statusHtml = '';
      if (sel.status === 'syncing') {
        statusHtml = '<div class="content-item-status status-syncing">同步中…</div>';
      } else if (sel.status === 'success') {
        statusHtml = `<div class="content-item-status status-success">✓ ${sel.statusText}</div>`;
      } else if (sel.status === 'error') {
        statusHtml = `<div class="content-item-status status-error">✗ ${sel.statusText}</div>`;
      }

      return `
        <div class="content-item" data-index="${index}">
          <div class="content-item-header">
            <input type="checkbox" class="content-item-checkbox" data-index="${index}" ${sel.checked ? 'checked' : ''}>
            <div class="content-item-info">
              <div class="content-item-title">${escapeHtml(item.title || '无标题')}</div>
              <div class="content-item-meta">${date}${source ? ' · ' + source : ''}</div>
            </div>
          </div>
          <div class="content-item-platforms">${platformTags}</div>
          ${statusHtml}
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('.content-item-checkbox').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      state.selections[idx].checked = e.target.checked;
      updateSyncButton();
    });
  });

  list.querySelectorAll('.platform-tag').forEach((tag) => {
    tag.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index);
      const pid = e.target.dataset.platform;
      const sel = state.selections[idx];
      sel.platforms[pid] = !sel.platforms[pid];
      e.target.classList.toggle('selected', sel.platforms[pid]);
    });
  });

  updateSyncButton();
}

function updateSyncButton() {
  const btn = document.getElementById('syncBtn');
  const hasSelection = Object.values(state.selections).some((s) => s.checked);
  btn.disabled = !hasSelection;
}

async function handleSync() {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.textContent = '同步中…';

  for (const [indexStr, sel] of Object.entries(state.selections)) {
    if (!sel.checked) continue;

    const index = parseInt(indexStr);
    const item = state.items[index];
    const platforms = Object.entries(sel.platforms)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (platforms.length === 0) continue;

    sel.status = 'syncing';
    renderItems();

    const results = [];
    for (const platform of platforms) {
      const result = await chrome.runtime.sendMessage({
        type: 'sync_to_platform',
        payload: { item, platform },
      });
      results.push({ platform, ...result });
    }

    const allOk = results.every((r) => r.success);
    if (allOk) {
      sel.status = 'success';
      sel.statusText = `已同步到 ${platforms.map((p) => PLATFORMS[p]).join('、')}`;
      await chrome.runtime.sendMessage({ type: 'archive', folder: item.folder });
    } else {
      sel.status = 'error';
      const failed = results
        .filter((r) => !r.success)
        .map((r) => `${PLATFORMS[r.platform]}: ${r.error}`)
        .join('; ');
      sel.statusText = failed;
    }

    renderItems();
  }

  btn.disabled = false;
  btn.textContent = '同步选中内容';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}