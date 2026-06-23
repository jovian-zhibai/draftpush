var HOST_NAME = 'com.draftpush.host';
var nativePort = null;
var pendingItems = [];
var fileCallbacks = {};

// ===== Native Host 通信 =====

function connectNativeHost() {
  if (nativePort) return;

  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);

    nativePort.onMessage.addListener(function (msg) {
      if (msg.type === 'new_content') {
        pendingItems.push(msg.payload);
        updateBadge();
      }

      if (msg.type === 'content_list') {
        pendingItems = msg.payload;
        updateBadge();
      }

      if (msg.type === 'archive_done') {
        pendingItems = pendingItems.filter(function (item) { return item.folder !== msg.payload.folder; });
        updateBadge();
      }

      if (msg.type === 'file_data' || msg.type === 'file_error') {
        var key = msg.payload.path;
        if (fileCallbacks[key]) {
          fileCallbacks[key](msg);
          delete fileCallbacks[key];
        }
      }
    });

    nativePort.onDisconnect.addListener(function () {
      nativePort = null;
    });

    nativePort.postMessage({ type: 'list_pending' });
  } catch (e) {
    nativePort = null;
  }
}

function updateBadge() {
  var count = pendingItems.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
}

function sendToHost(message) {
  if (!nativePort) connectNativeHost();
  if (nativePort) {
    nativePort.postMessage(message);
  }
}

function readFileFromHost(filePath, folderPath) {
  return new Promise(function (resolve, reject) {
    var absPath = filePath;
    if (folderPath && !filePath.startsWith('/')) {
      absPath = folderPath + '/' + filePath;
    }
    fileCallbacks[absPath] = function (msg) {
      if (msg.type === 'file_data') resolve(msg.payload);
      else reject(new Error(msg.payload.error));
    };
    sendToHost({ type: 'read_file', payload: { path: filePath, folder_path: folderPath } });
    setTimeout(function () {
      if (fileCallbacks[absPath]) {
        delete fileCallbacks[absPath];
        reject(new Error('读取文件超时'));
      }
    }, 10000);
  });
}

// ===== 消息处理 =====

chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
  if (request.type === 'get_pending') {
    if (!nativePort) connectNativeHost();
    sendResponse({ items: pendingItems });
    return true;
  }

  if (request.type === 'refresh') {
    if (!nativePort) connectNativeHost();
    if (nativePort) {
      nativePort.postMessage({ type: 'list_pending' });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'sync_to_platform') {
    handleSync(request.payload).then(sendResponse);
    return true;
  }

  if (request.type === 'archive') {
    sendToHost({ type: 'archive', payload: { folder: request.folder } });
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'check_host') {
    sendResponse({ connected: nativePort !== null });
    return true;
  }

  if (request.type === 'update_host_config') {
    sendToHost({ type: 'set_config', payload: request.payload });
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'get_logs') {
    sendResponse({ logs: syncLogs });
    return true;
  }

  if (request.type === 'schedule_sync') {
    scheduleSync(request.payload).then(sendResponse);
    return true;
  }

  if (request.type === 'get_scheduled') {
    getScheduledItems().then(sendResponse);
    return true;
  }

  if (request.type === 'cancel_scheduled') {
    cancelScheduled(request.payload.id).then(sendResponse);
    return true;
  }
});

// ===== 日志 =====

var syncLogs = [];

function addLog(level, message) {
  var entry = { time: new Date().toLocaleTimeString('zh-CN'), level: level, message: message };
  syncLogs.push(entry);
  if (syncLogs.length > 50) syncLogs.shift();
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('操作超时（' + (ms / 1000) + '秒）')); }, ms);
    })
  ]);
}

// ===== 同步主流程 =====

var PLATFORM_ADAPTERS = {
  xiaohongshu: { name: '小红书', sync: syncToXiaohongshu },
  wechat_mp: { name: '公众号', sync: syncToWechatMp },
  douyin: { name: '抖音', sync: syncToDouyin },
};

async function handleSync(payload) {
  var item = payload.item;
  var platform = payload.platform;
  var adapter = PLATFORM_ADAPTERS[platform];

  if (!adapter) {
    addLog('error', '平台 ' + platform + ' 暂未支持');
    return { success: false, error: '平台 ' + platform + ' 暂未支持' };
  }

  addLog('info', '开始同步「' + (item.title || '无标题') + '」到 ' + adapter.name);

  try {
    return await syncWithRetry(adapter.sync, item, adapter.name);
  } catch (e) {
    addLog('error', '同步异常: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===== 重试机制 =====

async function syncWithRetry(syncFn, item, platformName, maxRetries) {
  if (maxRetries === undefined) maxRetries = 2;
  var lastError;

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      var waitSec = attempt * 3;
      addLog('info', platformName + ' 第 ' + attempt + ' 次重试（等待 ' + waitSec + ' 秒）...');
      await new Promise(function (r) { setTimeout(r, waitSec * 1000); });
    }

    try {
      var result = await syncFn(item);
      if (result.success) return result;
      lastError = result.error;

      // 不可重试的错误直接返回
      if (isNonRetryableError(lastError)) {
        addLog('error', platformName + ' 错误不可重试: ' + lastError);
        return result;
      }

      addLog('warn', platformName + ' 同步失败: ' + lastError);
    } catch (e) {
      lastError = e.message;
      if (isNonRetryableError(lastError)) {
        return { success: false, error: lastError };
      }
      addLog('warn', platformName + ' 同步异常: ' + lastError);
    }
  }

  addLog('error', platformName + ' 重试 ' + maxRetries + ' 次后仍失败');
  notifyFailure(platformName, item.title, lastError);
  return { success: false, error: lastError };
}

function isNonRetryableError(error) {
  if (!error) return false;
  var noRetry = ['未配置', '请先', '不支持', '需要至少', '未找到图片上传', 'AppID', 'AppSecret'];
  return noRetry.some(function (k) { return error.indexOf(k) >= 0; });
}

// ===== 通知 =====

function notifySuccess(platformName, title) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '同步成功',
    message: '「' + (title || '无标题') + '」已同步到' + platformName,
  });
}

function notifyFailure(platformName, title, error) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '同步失败',
    message: platformName + '：' + (error || '未知错误'),
  });
}

// ===== 定时发布 =====

async function scheduleSync(payload) {
  var id = 'scheduled_' + Date.now();
  var scheduledTime = new Date(payload.scheduledTime).getTime();

  if (scheduledTime <= Date.now()) {
    return { success: false, error: '定时时间必须在未来' };
  }

  var entry = {
    id: id,
    title: payload.item.title || '无标题',
    folder: payload.item.folder,
    folder_path: payload.item.folder_path,
    platforms: payload.platforms,
    scheduledTime: scheduledTime,
    createdAt: Date.now(),
  };

  var stored = await chrome.storage.local.get(['scheduledItems']);
  var items = stored.scheduledItems || [];
  items.push(entry);
  await chrome.storage.local.set({ scheduledItems: items });

  chrome.alarms.create(id, { when: scheduledTime });
  addLog('info', '已设置定时发布：' + new Date(scheduledTime).toLocaleString('zh-CN'));
  return { success: true, id: id };
}

async function getScheduledItems() {
  var stored = await chrome.storage.local.get(['scheduledItems']);
  return { items: stored.scheduledItems || [] };
}

async function cancelScheduled(id) {
  await chrome.alarms.clear(id);
  var stored = await chrome.storage.local.get(['scheduledItems']);
  var items = (stored.scheduledItems || []).filter(function (s) { return s.id !== id; });
  await chrome.storage.local.set({ scheduledItems: items });
  addLog('info', '已取消定时发布');
  return { success: true };
}

chrome.alarms.onAlarm.addListener(async function (alarm) {
  if (!alarm.name.startsWith('scheduled_')) return;

  var stored = await chrome.storage.local.get(['scheduledItems']);
  var items = stored.scheduledItems || [];
  var entry = items.find(function (s) { return s.id === alarm.name; });

  if (!entry) return;

  addLog('info', '定时发布触发：「' + (entry.title || '无标题') + '」');

  // 从 pendingItems 里找最新的 item 数据（可能已被刷新）
  var item = pendingItems.find(function (p) { return p.folder === entry.folder; });
  if (!item) {
    // 如果 pending 里没有，尝试刷新一次
    if (nativePort) nativePort.postMessage({ type: 'list_pending' });
    await new Promise(function (r) { setTimeout(r, 1000); });
    item = pendingItems.find(function (p) { return p.folder === entry.folder; });
  }

  if (!item) {
    addLog('error', '定时发布失败：内容「' + entry.title + '」已不在待同步列表中');
    notifyFailure('定时发布', entry.title, '内容已不在待同步列表');
  } else {
    for (var i = 0; i < entry.platforms.length; i++) {
      await handleSync({ item: item, platform: entry.platforms[i] });
    }
  }

  // 发布完成后移除
  items = items.filter(function (s) { return s.id !== alarm.name; });
  await chrome.storage.local.set({ scheduledItems: items });
});

// ===== 小红书同步 =====

async function syncToXiaohongshu(item) {
  var imagePaths = item.images || [];
  if (imagePaths.length === 0) {
    return { success: false, error: '小红书笔记需要至少一张图片' };
  }

  // 1. 读取本地图片
  var imageDataList = [];
  for (var i = 0; i < imagePaths.length; i++) {
    addLog('info', '读取图片 (' + (i + 1) + '/' + imagePaths.length + '): ' + imagePaths[i]);
    try {
      var fileData = await withTimeout(readFileFromHost(imagePaths[i], item.folder_path), 10000);
      imageDataList.push(fileData);
    } catch (e) {
      return { success: false, error: '图片读取失败: ' + e.message };
    }
  }

  // 2. 打开创作者发布页
  addLog('info', '打开创作者发布页...');
  var tabs = await chrome.tabs.query({ url: 'https://creator.xiaohongshu.com/*' });
  var targetTab;

  if (tabs && tabs.length > 0) {
    targetTab = tabs[0];
    await chrome.tabs.update(targetTab.id, { url: 'https://creator.xiaohongshu.com/publish/publish?from=tab_switch', active: true });
  } else {
    targetTab = await chrome.tabs.create({ url: 'https://creator.xiaohongshu.com/publish/publish?from=tab_switch', active: true });
  }

  addLog('info', '等待页面加载...');
  await waitForTabLoad(targetTab.id, 10000);

  // 注入 shadow-patch
  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      world: 'MAIN',
      func: function () {
        if (!window.__shadowPatched) {
          var orig = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function (init) {
            if (init && init.mode === 'closed') init.mode = 'open';
            var sr = orig.call(this, init);
            this._shadowRoot = sr;
            return sr;
          };
          window.__shadowPatched = true;
        }
      }
    });
  } catch (e) {}

  await new Promise(function (r) { setTimeout(r, 3000); });

  // 3. 上传图片
  addLog('info', '切换到图文模式并上传图片...');
  for (var j = 0; j < imageDataList.length; j++) {
    try {
      var uploadResult = await withTimeout(chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        world: 'MAIN',
        func: function (base64, mimeType, fileName) {
          return new Promise(function (resolve) {
            try {
              var tabs = document.querySelectorAll('.creator-tab');
              for (var t = 0; t < tabs.length; t++) {
                var titleSpan = tabs[t].querySelector('.title');
                if (titleSpan && titleSpan.textContent.indexOf('图文') >= 0) {
                  tabs[t].click();
                  break;
                }
              }

              setTimeout(function () {
                try {
                  var imgInput = document.querySelector('input[type="file"][accept*=".jpg"]');
                  if (!imgInput) {
                    resolve({ success: false, error: '未找到图片上传框' });
                    return;
                  }

                  var binary = atob(base64);
                  var array = new Uint8Array(binary.length);
                  for (var k = 0; k < binary.length; k++) array[k] = binary.charCodeAt(k);
                  var file = new File([array], fileName, { type: mimeType, lastModified: Date.now() });

                  var dt = new DataTransfer();
                  dt.items.add(file);
                  imgInput.files = dt.files;
                  imgInput.dispatchEvent(new Event('change', { bubbles: true }));

                  setTimeout(function () { resolve({ success: true }); }, 3000);
                } catch (e) {
                  resolve({ success: false, error: e.message });
                }
              }, 2000);
            } catch (e) {
              resolve({ success: false, error: e.message });
            }
          });
        },
        args: [imageDataList[j].base64, imageDataList[j].mimeType, 'cover_' + j + '.png']
      }), 20000);

      var ur = uploadResult && uploadResult[0] && uploadResult[0].result;
      if (ur && !ur.success) {
        addLog('error', '图片上传失败: ' + ur.error);
        return { success: false, error: ur.error };
      }

      addLog('info', '图片 ' + (j + 1) + ' 已上传到页面');
      await new Promise(function (r) { setTimeout(r, 2000); });
    } catch (e) {
      addLog('error', '图片上传失败: ' + e.message);
      return { success: false, error: '图片上传到页面失败: ' + e.message };
    }
  }

  // 4. 等待 CDN 上传，填入标题和正文
  addLog('info', '等待图片上传到 CDN（约5秒）...');
  await new Promise(function (r) { setTimeout(r, 5000); });

  addLog('info', '填入标题和正文...');
  try {
    var result = await withTimeout(
      chrome.tabs.sendMessage(targetTab.id, {
        type: 'xhs_fill_and_save',
        payload: { title: item.title, body: item.body, tags: item.tags }
      }),
      15000
    );

    if (result && result.logs) {
      for (var k = 0; k < result.logs.length; k++) {
        addLog('info', '[页面] ' + result.logs[k]);
      }
    }

    if (result && result.success) {
      addLog('success', result.message || '同步成功');
      notifySuccess('小红书', item.title);
      return { success: true, message: result.message };
    } else {
      addLog('error', (result && result.error) || '未知错误');
      return { success: false, error: (result && result.error) || '未知错误' };
    }
  } catch (e) {
    addLog('error', '填入内容失败: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===== 抖音同步 =====

async function syncToDouyin(item) {
  var imagePaths = item.images || [];
  if (imagePaths.length === 0) {
    return { success: false, error: '抖音图文需要至少一张图片' };
  }

  // 1. 读取本地图片
  var imageDataList = [];
  for (var i = 0; i < imagePaths.length; i++) {
    addLog('info', '读取图片 (' + (i + 1) + '/' + imagePaths.length + '): ' + imagePaths[i]);
    try {
      var fileData = await withTimeout(readFileFromHost(imagePaths[i], item.folder_path), 10000);
      imageDataList.push(fileData);
    } catch (e) {
      return { success: false, error: '图片读取失败: ' + e.message };
    }
  }

  // 2. 打开抖音创作者上传页
  addLog('info', '打开抖音创作者上传页...');
  var tabs = await chrome.tabs.query({ url: 'https://creator.douyin.com/*' });
  var targetTab;

  if (tabs && tabs.length > 0) {
    targetTab = tabs[0];
    await chrome.tabs.update(targetTab.id, {
      url: 'https://creator.douyin.com/creator-micro/content/upload',
      active: true
    });
  } else {
    targetTab = await chrome.tabs.create({
      url: 'https://creator.douyin.com/creator-micro/content/upload',
      active: true
    });
  }

  addLog('info', '等待页面加载...');
  await waitForTabLoad(targetTab.id, 15000);
  await new Promise(function (r) { setTimeout(r, 3000); });

  // 3. 切换到图文模式并上传图片
  addLog('info', '切换到图文模式...');
  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      world: 'MAIN',
      func: function () {
        // 点击"图文"标签（抖音用 Semi UI 的 Tab 组件）
        var allTabs = document.querySelectorAll('[role="tab"], .semi-tabs-tab');
        for (var i = 0; i < allTabs.length; i++) {
          if (allTabs[i].textContent.indexOf('图文') >= 0) {
            allTabs[i].click();
            return;
          }
        }
        // 兜底：找任何包含"图文"文字的可点击元素
        var els = document.querySelectorAll('span, div, button');
        for (var j = 0; j < els.length; j++) {
          if (els[j].textContent.trim() === '图文' || els[j].textContent.trim() === '发布图文') {
            els[j].click();
            return;
          }
        }
      }
    });
  } catch (e) {
    addLog('warn', '切换图文模式可能失败: ' + e.message);
  }

  await new Promise(function (r) { setTimeout(r, 2000); });

  // 4. 上传图片
  addLog('info', '上传图片到抖音...');
  for (var j = 0; j < imageDataList.length; j++) {
    try {
      var uploadResult = await withTimeout(chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        world: 'MAIN',
        func: function (base64, mimeType, fileName) {
          return new Promise(function (resolve) {
            try {
              // 找图片 file input
              var inputs = document.querySelectorAll('input[type="file"]');
              var imgInput = null;
              for (var i = 0; i < inputs.length; i++) {
                var acc = inputs[i].getAttribute('accept') || '';
                if (acc.indexOf('.jpg') >= 0 || acc.indexOf('.png') >= 0 || acc.indexOf('image') >= 0) {
                  imgInput = inputs[i];
                  break;
                }
              }
              if (!imgInput && inputs.length > 0) {
                imgInput = inputs[0];
              }
              if (!imgInput) {
                resolve({ success: false, error: '未找到图片上传框' });
                return;
              }

              var binary = atob(base64);
              var array = new Uint8Array(binary.length);
              for (var k = 0; k < binary.length; k++) array[k] = binary.charCodeAt(k);
              var file = new File([array], fileName, { type: mimeType, lastModified: Date.now() });

              var dt = new DataTransfer();
              dt.items.add(file);
              imgInput.files = dt.files;
              imgInput.dispatchEvent(new Event('change', { bubbles: true }));

              setTimeout(function () { resolve({ success: true }); }, 3000);
            } catch (e) {
              resolve({ success: false, error: e.message });
            }
          });
        },
        args: [imageDataList[j].base64, imageDataList[j].mimeType, 'img_' + j + '.png']
      }), 20000);

      var ur = uploadResult && uploadResult[0] && uploadResult[0].result;
      if (ur && !ur.success) {
        addLog('error', '图片上传失败: ' + ur.error);
        return { success: false, error: ur.error };
      }

      addLog('info', '图片 ' + (j + 1) + ' 已上传');
      await new Promise(function (r) { setTimeout(r, 2000); });
    } catch (e) {
      addLog('error', '图片上传失败: ' + e.message);
      return { success: false, error: '图片上传失败: ' + e.message };
    }
  }

  // 5. 等待图片处理 + 填入标题和正文
  addLog('info', '等待图片处理...');
  await new Promise(function (r) { setTimeout(r, 5000); });

  addLog('info', '填入标题和正文...');
  try {
    var result = await withTimeout(
      chrome.tabs.sendMessage(targetTab.id, {
        type: 'douyin_fill_and_save',
        payload: { title: item.title, body: item.body, tags: item.tags }
      }),
      30000
    );

    if (result && result.logs) {
      for (var k = 0; k < result.logs.length; k++) {
        addLog('info', '[页面] ' + result.logs[k]);
      }
    }

    if (result && result.success) {
      addLog('success', result.message || '抖音同步成功');
      notifySuccess('抖音', item.title);
      return { success: true, message: result.message };
    } else {
      addLog('error', (result && result.error) || '未知错误');
      return { success: false, error: (result && result.error) || '未知错误' };
    }
  } catch (e) {
    addLog('error', '填入内容失败: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ===== 公众号同步（纯 API）=====

async function syncToWechatMp(item) {
  addLog('info', '开始公众号同步（API 方式）...');

  var config = await chrome.storage.local.get(['wechatMpAppId', 'wechatMpAppSecret']);
  if (!config.wechatMpAppId || !config.wechatMpAppSecret) {
    return { success: false, error: '请先在设置页配置公众号 AppID 和 AppSecret' };
  }

  return new Promise(function (resolve) {
    var onMsg = function (msg) {
      if (msg.type === 'wechat_mp_result') {
        nativePort.onMessage.removeListener(onMsg);
        var result = msg.payload;
        if (result.logs) {
          for (var i = 0; i < result.logs.length; i++) {
            addLog('info', '[公众号] ' + result.logs[i]);
          }
        }
        if (result.success) {
          addLog('success', result.message || '公众号同步成功');
          notifySuccess('公众号', item.title);
          resolve({ success: true, message: result.message });
        } else {
          addLog('error', result.error || '公众号同步失败');
          resolve({ success: false, error: result.error });
        }
      }
    };

    if (!nativePort) connectNativeHost();
    if (nativePort) {
      nativePort.onMessage.addListener(onMsg);
      nativePort.postMessage({
        type: 'wechat_mp_sync',
        payload: {
          appId: config.wechatMpAppId,
          appSecret: config.wechatMpAppSecret,
          item: item
        }
      });

      setTimeout(function () {
        nativePort.onMessage.removeListener(onMsg);
        resolve({ success: false, error: '公众号同步超时（30秒）' });
      }, 30000);
    } else {
      resolve({ success: false, error: 'Native Host 未连接' });
    }
  });
}

// ===== 工具函数 =====

function waitForTabLoad(tabId, timeout) {
  return new Promise(function (resolve) {
    var timer = setTimeout(function () {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

connectNativeHost();
