var PLATFORMS = {
  xiaohongshu: '小红书',
  wechat_mp: '公众号',
  douyin: '抖音',
};

var state = {
  items: [],
  selections: {},
  enabledPlatforms: ['xiaohongshu'],
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadEnabledPlatforms();
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

  document.getElementById('scheduleBtn').addEventListener('click', function () {
    var row = document.getElementById('scheduleRow');
    row.style.display = row.style.display === 'none' ? 'flex' : 'none';
    if (row.style.display === 'flex') {
      var now = new Date();
      now.setHours(now.getHours() + 1, 0, 0, 0);
      document.getElementById('scheduleTime').value = now.toISOString().slice(0, 16);
    }
  });

  document.getElementById('confirmScheduleBtn').addEventListener('click', handleSchedule);
  document.getElementById('cancelScheduleBtn').addEventListener('click', function () {
    document.getElementById('scheduleRow').style.display = 'none';
  });

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

  document.getElementById('closePreviewBtn').addEventListener('click', function () {
    document.getElementById('previewPanel').style.display = 'none';
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

      var platformTags = state.enabledPlatforms
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
        '<div class="content-item-title" data-index="' + index + '">' + escapeHtml(item.title || '无标题') + '</div>' +
        '<div class="content-item-meta">' + date + (source ? ' · ' + source : '') +
        ' · ' + (item.images ? item.images.length : 0) + '图' +
        '</div>' +
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

  // 点击标题显示预览
  list.querySelectorAll('.content-item-title').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      var idx = parseInt(e.target.dataset.index);
      showPreview(state.items[idx]);
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

function showPreview(item) {
  var panel = document.getElementById('previewPanel');
  var body = document.getElementById('previewBody');

  var tagsHtml = (item.tags || []).map(function (t) {
    return '<span class="preview-tag">#' + escapeHtml(t) + '</span>';
  }).join(' ');

  var imagesHtml = '';
  if (item.images && item.images.length > 0) {
    imagesHtml = '<div class="preview-images">' + item.images.length + ' 张图片: ' +
      item.images.map(function (img) { return escapeHtml(img); }).join(', ') +
      '</div>';
  }

  var bodyPreview = (item.body || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  if (bodyPreview.length > 300) {
    bodyPreview = bodyPreview.substring(0, 300) + '...';
  }

  body.innerHTML =
    '<div class="preview-title">' + escapeHtml(item.title || '无标题') + '</div>' +
    '<div class="preview-text">' + escapeHtml(bodyPreview) + '</div>' +
    (tagsHtml ? '<div class="preview-tags">' + tagsHtml + '</div>' : '') +
    imagesHtml;

  panel.style.display = 'flex';
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

  document.getElementById('logPanel').style.display = 'flex';

  // 收集所有要同步的内容
  var batchItems = [];
  var selKeys = Object.keys(state.selections);
  for (var si = 0; si < selKeys.length; si++) {
    var indexStr = selKeys[si];
    var sel = state.selections[indexStr];
    if (!sel.checked) continue;

    var index = parseInt(indexStr);
    var item = state.items[index];
    var platforms = Object.keys(sel.platforms).filter(function (k) { return sel.platforms[k]; });
    if (platforms.length === 0) continue;

    sel.status = 'syncing';
    batchItems.push({ item: item, platforms: platforms, selIndex: indexStr });
  }

  if (batchItems.length === 0) {
    btn.disabled = false;
    btn.textContent = '同步选中内容';
    return;
  }

  renderItems();

  var publishMode = document.querySelector('input[name="publishMode"]:checked').value;

  // 发送批量同步请求给 service worker（即使 popup 关了也会继续）
  try {
    var batchResult = await syncTimeout(
      chrome.runtime.sendMessage({
        type: 'sync_batch',
        payload: {
          publishMode: publishMode,
          items: batchItems.map(function (b) { return { item: b.item, platforms: b.platforms }; })
        }
      }),
      300000
    );

    // 同步完成，从 service worker 读取状态更新 UI
    if (batchResult && batchResult.results) {
      for (var ri = 0; ri < batchResult.results.length; ri++) {
        var r = batchResult.results[ri];
        var matchEntry = batchItems.find(function (b) { return b.item.folder === r.folder; });
        if (matchEntry) {
          var sel = state.selections[matchEntry.selIndex];
          if (r.allOk) {
            sel.status = 'success';
            sel.statusText = '已同步并归档';
          } else {
            sel.status = 'error';
            var statusResp = await chrome.runtime.sendMessage({ type: 'get_sync_status' });
            if (statusResp && statusResp.statuses && statusResp.statuses[r.folder]) {
              sel.statusText = statusResp.statuses[r.folder].text;
            } else {
              sel.statusText = '部分平台同步失败';
            }
          }
        }
      }
    }
  } catch (e) {
    // popup 可能中途关了又开了，尝试从 service worker 获取最新状态
    try {
      var statusResp = await chrome.runtime.sendMessage({ type: 'get_sync_status' });
      if (statusResp && statusResp.statuses) {
        for (var si2 = 0; si2 < batchItems.length; si2++) {
          var folder = batchItems[si2].item.folder;
          var status = statusResp.statuses[folder];
          if (status) {
            var sel2 = state.selections[batchItems[si2].selIndex];
            sel2.status = status.status;
            sel2.statusText = status.text;
          }
        }
      }
    } catch (e2) {}
  }

  renderItems();
  btn.disabled = false;
  btn.textContent = '同步选中内容';
  await refreshLogs();

  // 刷新内容列表（已归档的会消失）
  await new Promise(function (r) { setTimeout(r, 1000); });
  await loadPendingItems();
}

async function handleSchedule() {
  var timeInput = document.getElementById('scheduleTime');
  var scheduledTime = timeInput.value;

  if (!scheduledTime) {
    showToast('请选择定时发布时间');
    return;
  }

  var selKeys = Object.keys(state.selections);
  var scheduled = 0;

  for (var si = 0; si < selKeys.length; si++) {
    var indexStr = selKeys[si];
    var sel = state.selections[indexStr];
    if (!sel.checked) continue;

    var index = parseInt(indexStr);
    var item = state.items[index];
    var platforms = Object.keys(sel.platforms).filter(function (k) { return sel.platforms[k]; });
    if (platforms.length === 0) continue;

    try {
      var result = await chrome.runtime.sendMessage({
        type: 'schedule_sync',
        payload: { item: item, platforms: platforms, scheduledTime: scheduledTime }
      });
      if (result.success) scheduled++;
    } catch (e) {
      showToast('定时设置失败: ' + e.message);
    }
  }

  if (scheduled > 0) {
    showToast('已设置 ' + scheduled + ' 篇内容定时发布');
    document.getElementById('scheduleRow').style.display = 'none';
  } else {
    showToast('请先勾选要定时发布的内容');
  }
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

async function loadEnabledPlatforms() {
  try {
    var saved = await chrome.storage.local.get(['enabledPlatforms']);
    if (saved.enabledPlatforms && saved.enabledPlatforms.length > 0) {
      state.enabledPlatforms = saved.enabledPlatforms;
    }
  } catch (e) {}
}
