document.addEventListener('DOMContentLoaded', async function () {
  // 检查 host 连接
  try {
    var resp = await chrome.runtime.sendMessage({ type: 'check_host' });
    var dot = document.getElementById('hostDot');
    var text = document.getElementById('hostStatus');
    if (resp.connected) {
      dot.className = 'host-dot ok';
      text.textContent = 'Native Host 已连接';
    } else {
      dot.className = 'host-dot fail';
      text.textContent = 'Native Host 未连接 — 请运行安装脚本';
    }
  } catch {
    document.getElementById('hostDot').className = 'host-dot fail';
    document.getElementById('hostStatus').textContent = 'Native Host 未连接';
  }

  // 加载已保存的设置
  var saved = await chrome.storage.local.get(['dirType', 'obsidianDir', 'customDir']);
  var dirType = saved.dirType || 'default';
  var radio = document.querySelector('input[value="' + dirType + '"]');
  if (radio) radio.checked = true;
  if (saved.obsidianDir) document.getElementById('obsidianDir').value = saved.obsidianDir;
  if (saved.customDir) document.getElementById('customDir').value = saved.customDir;

  updatePathVisibility(dirType);

  // 切换时显示/隐藏路径输入框
  document.querySelectorAll('input[name="dirType"]').forEach(function (r) {
    r.addEventListener('change', function (e) {
      updatePathVisibility(e.target.value);
    });
  });

  // 保存
  document.getElementById('saveBtn').addEventListener('click', async function () {
    var type = document.querySelector('input[name="dirType"]:checked').value;
    var obsidianDir = document.getElementById('obsidianDir').value.trim();
    var customDir = document.getElementById('customDir').value.trim();

    if (type === 'obsidian' && !obsidianDir) {
      showStatus('error', '请填写 Obsidian Vault 目录路径');
      return;
    }
    if (type === 'custom' && !customDir) {
      showStatus('error', '请填写自定义目录路径');
      return;
    }

    await chrome.storage.local.set({ dirType: type, obsidianDir: obsidianDir, customDir: customDir });

    // 同步目录配置到 Native Host
    var watchDir = '';
    if (type === 'obsidian') watchDir = obsidianDir;
    if (type === 'custom') watchDir = customDir;

    if (watchDir) {
      await chrome.runtime.sendMessage({ type: 'update_host_config', payload: { watch_dir: watchDir } });
    }

    showStatus('success', '设置已保存');
  });
});

function updatePathVisibility(type) {
  document.getElementById('obsidianDirField').style.display = (type === 'obsidian') ? 'block' : 'none';
  document.getElementById('customDirField').style.display = (type === 'custom') ? 'block' : 'none';
}

function showStatus(type, msg) {
  var el = document.getElementById('saveStatus');
  el.className = 'status-msg ' + type;
  el.textContent = msg;
  if (type === 'success') {
    setTimeout(function () { el.style.display = 'none'; el.className = 'status-msg'; }, 3000);
  }
}

// ===== 公众号配置 =====

async function loadWechatConfig() {
  var saved = await chrome.storage.local.get(['wechatMpAppId', 'wechatMpAppSecret']);
  if (saved.wechatMpAppId) {
    document.getElementById('wechatMpAppId').value = saved.wechatMpAppId;
    document.getElementById('wechatMpAppSecret').value = saved.wechatMpAppSecret ? '••••••••' : '';
    document.getElementById('wechatMpStatus').textContent = '已配置';
    document.getElementById('wechatMpStatus').style.color = '#34c759';
  }
}

loadWechatConfig();

document.getElementById('saveWechatBtn').addEventListener('click', async function () {
  var appId = document.getElementById('wechatMpAppId').value.trim();
  var appSecret = document.getElementById('wechatMpAppSecret').value.trim();

  if (!appId) {
    showWechatStatus('error', '请填写 AppID');
    return;
  }

  var saveData = { wechatMpAppId: appId };
  if (appSecret && appSecret !== '••••••••') {
    saveData.wechatMpAppSecret = appSecret;
  }

  await chrome.storage.local.set(saveData);
  document.getElementById('wechatMpStatus').textContent = '已配置';
  document.getElementById('wechatMpStatus').style.color = '#34c759';
  showWechatStatus('success', '公众号配置已保存');
});

function showWechatStatus(type, msg) {
  var el = document.getElementById('wechatSaveStatus');
  el.className = 'status-msg ' + type;
  el.textContent = msg;
  if (type === 'success') {
    setTimeout(function () { el.style.display = 'none'; el.className = 'status-msg'; }, 3000);
  }
}