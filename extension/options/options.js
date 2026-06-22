document.addEventListener('DOMContentLoaded', async () => {
  // 检查 host 连接
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'check_host' });
    const dot = document.getElementById('hostDot');
    const text = document.getElementById('hostStatus');
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
  const saved = await chrome.storage.local.get(['dirType', 'obsidianDir', 'customDir']);
  const dirType = saved.dirType || 'default';
  const radio = document.querySelector('input[value="' + dirType + '"]');
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
    showStatus('success', '设置已保存，重启插件后生效');
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