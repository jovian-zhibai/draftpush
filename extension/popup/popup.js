var PLATFORMS = {
  xiaohongshu: '小红书',
  wechat_mp: '公众号',
  douyin: '抖音',
};

var state = {
  items: [],
  selections: {},
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  checkHostConnection();
  await loadPendingItems();

  document.getElementById('refreshBtn').addEventListener('click', async function () {
    var btn = document.getElementById('refreshBtn');
    btn.classList.add('spinning');
    btn.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: 'refresh' });
      await new Promise(function (r) { setTimeout(r, 600); });
      await loadPendingItems();
      showToast('已刷新，' + state.items.length + ' 篇待同步');
    } catch (e) {
      showToast('刷新失败：' + e.message);
    }
    btn.classList.remove('spinning');
    btn.disabled = false;
  });

  document.getElementById('syncBtn').addEventListener('click', handleSync);

  document.getElementById('settingsLink').addEventListener('click', function (e) {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('logLink').addEventListener('click', function (e) {
    e.preventDefault();
    toggleLogPanel();
  });

  document.getElementById('closeLogBtn').addEventListener('click', function () {
    document.getElementById('logPanel').style.display = 'none';
  });
}

async function checkHostConnection() {
  try {
    var resp = await chrome.runtime.sendMessage({ type: 'check_host' });
    var dot = document.getElementById('statusDot');
    var text = document.getElementById('statusText');

    if (resp && resp.connected) {
      dot.className = 'status-dot connected';
      text.textContent = 'Native Host 已连接';
    } else {
      dot.className = 'status-dot disconnected';
      text.textContent = 'Native Host 未连接 — 请检查安装';
    }
  } catch (e) {
    document.getElementById('statusDot').className = 'status-dot disconnected';
    document.getElementById('statusText').textContent = 'Native Host 未连接';
  }
}

async function loadPendingItems() {
  try {
    var resp = await chrome.runtime.sendMessage({ type: 'get_pending' });
    state.items = (resp && resp.items) || [];
  } catch (e) {
    state.items = [];
  }
  renderItems();
}

function renderItems() {
  var list = document.getElementById('contentList');
  var actions = document.getElementById('actions');

  if (state.items.length === 0) {
    list.innerHTML = '<div class="empty-state">' +
      '<p>暂无待同步内容</p>' +
      '<p class="empty-hint">Skill 写完内容后会自动出现在这里</p>' +
      '</div>';
    actions.style.display = 'none';
    return;
  }

  actions.style.display = 'block';

  list.innerHTML = state.items
    .map(function (item, index) {
      if (!state.selections[index]) {
        state.selections[index] = {
          checked: false,
          platforms: (item.platforms || ['xiaohongshu']).reduce(
            function (acc, p) { acc[p] = true; return acc; }, {}
          ),
          status: null,
          statusText: '',
        };
      }

      var sel = state.selections[index];
      var date = item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '';
      var source = item.source_skill || '';

      var platformTags = Object.keys(PLATFORMS)
        .map(function (pid) {
          var selected = sel.platforms[pid] ? 'selected' : '';
          return '<span class="platform-tag ' + selected + '" data-index="' + index + '" data-platform="' + pid + '">' + PLATFORMS[pid] + '</span>';
        })
        .join('');

      var statusHtml = '';
      if (sel.status === 'syncing') {
        statusHtml = '<div class="content-item-status status-syncing">同步中…</div>';
      } else if (sel.status === 'success') {
        statusHtml = '<div class="content-item-status status-success">✓ ' + escapeHtml(sel.statusText) + '</div>';
      } else if (sel.status === 'error') {
        statusHtml = '<div class="content-item-status status-error">✗ ' + escapeHtml(sel.statusText) + '</div>';
      }

      return '<div class="content-item" data-index="' + index + '">' +
        '<div class="content-item-header">' +
        '<input type="checkbox" class="content-item-checkbox" data-index="' + index + '"' + (sel.checked ? ' checked' : '') + '>' +
        '<div class="content-item-info">' +
        '<div class="content-item-title">' + escapeHtml(item.title || '无标题') + '</div>' +
        '<div class="content-item-meta">' + date + (source ? ' · ' + source : '') + '</div>' +
        '</div>' +
        '<button class="btn-dismiss" data-index="' + index + '" title="忽略此内容">✕</button>' +
        '</div>' +
        '<div class="content-item-platforms">' + platformTags + '</div>' +
        statusHtml +
        '</div>';
    })
    .join('');

  list.querySelectorAll('.content-item-checkbox').forEach(function (cb) {
    cb.addEventListener('change', function (e) {
      var idx = parseInt(e.target.dataset.index);
      state.selections[idx].checked = e.target.checked;
      updateSyncButton();
    });
  });

  list.querySelectorAll('.platform-tag').forEach(function (tag) {
    tag.addEventListener('click', function (e) {
      var idx = parseInt(e.target.dataset.index);
      var pid = e.target.dataset.platform;
      var sel = state.selections[idx];
      sel.platforms[pid] = !sel.platforms[pid];
      e.target.classList.toggle('selected', sel.platforms[pid]);
    });
  });

  list.querySelectorAll('.btn-dismiss').forEach(function (btn) {
    btn.addEventListener('click', async function (e) {
      e.stopPropagation();
      var idx = parseInt(e.target.dataset.index);
      var item = state.items[idx];
      if (!item) return;
      await chrome.runtime.sendMessage({ type: 'archive', folder: item.folder });
      state.items.splice(idx, 1);
      state.selections = {};
      renderItems();
      showToast('已忽略「' + (item.title || '无标题') + '」');
    });
  });

  updateSyncButton();
}

function updateSyncButton() {
  var btn = document.getElementById('syncBtn');
  var hasSelection = Object.values(state.selections).some(function (s) { return s.checked; });
  btn.disabled = !hasSelection;
}

function syncTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('同步超时（' + (ms / 1000) + '秒无响应）')); }, ms);
    })
  ]);
}

async function handleSync() {
  var btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.textContent = '同步中…';

  // 自动打开日志面板
  document.getElementById('logPanel').style.display = 'flex';

  for (var indexStr in state.selections) {
    var sel = state.selections[indexStr];
    if (!sel.checked) continue;

    var index = parseInt(indexStr);
    var item = state.items[index];
    var platforms = [];
    for (var k in sel.platforms) {
      if (sel.platforms[k]) platforms.push(k);
    }

    if (platforms.length === 0) continue;

    sel.status = 'syncing';
    renderItems();

    var results = [];
    for (var i = 0; i < platforms.length; i++) {
      var platform = platforms[i];
      try {
        var result = await syncTimeout(
          chrome.runtime.sendMessage({ type: 'sync_to_platform', payload: { item: item, platform: platform } }),
          60000
        );
        results.push({ platform: platform, success: result.success, error: result.error, message: result.message });
      } catch (e) {
        results.push({ platform: platform, success: false, error: e.message });
      }
    }

    var allOk = results.every(function (r) { return r.success; });
    if (allOk) {
      sel.status = 'success';
      sel.statusText = '已同步到 ' + platforms.map(function (p) { return PLATFORMS[p]; }).join('、');
      try {
        await chrome.runtime.sendMessage({ type: 'archive', folder: item.folder });
      } catch (e) {}
    } else {
      sel.status = 'error';
      sel.statusText = results
        .filter(function (r) { return !r.success; })
        .map(function (r) { return PLATFORMS[r.platform] + ': ' + (r.error || '未知错误'); })
        .join('; ');
    }

    renderItems();
  }

  btn.disabled = false;
  btn.textContent = '同步选中内容';
  await refreshLogs();
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function toggleLogPanel() {
  var panel = document.getElementById('logPanel');
  if (panel.style.display === 'none') {
    panel.style.display = 'flex';
    await refreshLogs();
  } else {
    panel.style.display = 'none';
  }
}

async function refreshLogs() {
  try {
    var resp = await chrome.runtime.sendMessage({ type: 'get_logs' });
    var logs = (resp && resp.logs) || [];
    var list = document.getElementById('logList');

    if (logs.length === 0) {
      list.innerHTML = '<div class="log-entry"><span class="log-msg" style="color:#999;">暂无日志</span></div>';
      return;
    }

    list.innerHTML = logs.map(function (entry) {
      return '<div class="log-entry ' + entry.level + '">' +
        '<span class="log-time">' + escapeHtml(entry.time) + '</span>' +
        '<span class="log-msg">' + escapeHtml(entry.message) + '</span>' +
        '</div>';
    }).join('');

    list.scrollTop = list.scrollHeight;
  } catch (e) {
    document.getElementById('logList').innerHTML =
      '<div class="log-entry error"><span class="log-msg">无法获取日志</span></div>';
  }
}

function showToast(msg) {
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.querySelector('.app').appendChild(toast);

  setTimeout(function () { toast.classList.add('show'); }, 10);
  setTimeout(function () {
    toast.classList.remove('show');
    setTimeout(function () { toast.remove(); }, 300);
  }, 2000);
}