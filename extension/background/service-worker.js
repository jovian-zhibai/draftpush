var HOST_NAME = 'com.draftpush.host';
var nativePort = null;
var pendingItems = [];
var fileCallbacks = {};

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
});

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

// ===== 小红书签名 =====

async function getXhsSignTab() {
  var tabs = await chrome.tabs.query({ url: ['https://www.xiaohongshu.com/*', 'https://creator.xiaohongshu.com/*'] });
  if (tabs && tabs.length > 0) return tabs[0];
  var newTab = await chrome.tabs.create({ url: 'https://www.xiaohongshu.com/explore', active: false });
  await new Promise(function (r) { setTimeout(r, 3000); });
  return newTab;
}

async function getXhsSign(uri, data) {
  try {
    var tab = await getXhsSignTab();
    var dataStr = data ? JSON.stringify(data) : '';
    var signPromise = chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: function (uri, dataStr) {
        try {
          if (typeof window._webmsxyw === 'function') {
            var data = dataStr ? JSON.parse(dataStr) : undefined;
            var signResult = window._webmsxyw(uri, data);
            return signResult;
          }
          return null;
        } catch (e) {
          return null;
        }
      },
      args: [uri, dataStr]
    });
    var results = await withTimeout(signPromise, 5000);
    if (results && results[0] && results[0].result) {
      addLog('info', '签名获取成功');
      return results[0].result;
    }
    addLog('info', '签名函数未找到，跳过签名');
  } catch (e) {
    addLog('info', '签名获取跳过: ' + e.message);
  }
  return null;
}

// ===== 小红书 API 直接调用 =====

var XHS_API = 'https://edith.xiaohongshu.com';

var SIGN_REQUIRED_PREFIXES = ['/web_api/', '/api/sns/web/'];

async function xhsFetch(method, uri, data, extraHeaders) {
  var url = XHS_API + uri;
  var headers = {
    'Content-Type': 'application/json',
    'Origin': 'https://creator.xiaohongshu.com',
    'Referer': 'https://creator.xiaohongshu.com/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  var needSign = SIGN_REQUIRED_PREFIXES.some(function (p) { return uri.startsWith(p); });
  if (needSign) {
    var signHeaders = await getXhsSign(uri, data);
    if (signHeaders) {
      var signKeys = Object.keys(signHeaders);
      for (var i = 0; i < signKeys.length; i++) {
        var sk = signKeys[i];
        if (sk.toLowerCase().startsWith('x-')) {
          headers[sk] = signHeaders[sk];
        }
      }
    }
  }
  if (extraHeaders) {
    for (var k in extraHeaders) headers[k] = extraHeaders[k];
  }

  var opts = { method: method, headers: headers, credentials: 'include' };
  if (data && method === 'POST') {
    opts.body = JSON.stringify(data);
  }

  var resp = await fetch(url, opts);
  if (!resp.ok) {
    throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
  }
  var json = await resp.json();
  if (json.success) {
    return json.data || json.success;
  }
  throw new Error(json.msg || json.code || '请求失败');
}

async function xhsGetUploadPermit() {
  var uri = '/api/media/v1/upload/web/permit?biz_name=spectrum&scene=image&file_count=1&version=1&source=web';
  var res = await xhsFetch('GET', uri);
  var permit = res.uploadTempPermits[0];
  return { fileId: permit.fileIds[0], token: permit.token };
}

async function xhsUploadImage(fileId, token, base64Data, mimeType) {
  var binary = Uint8Array.from(atob(base64Data), function (c) { return c.charCodeAt(0); });
  var url = 'https://ros-upload.xiaohongshu.com/' + fileId;
  var resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'X-Cos-Security-Token': token,
      'Content-Type': mimeType || 'image/jpeg'
    },
    body: binary.buffer
  });
  if (!resp.ok) {
    throw new Error('图片上传失败: HTTP ' + resp.status);
  }
  return { success: true };
}

async function xhsCreateNote(title, desc, imageFileIds, tags, isPrivate) {
  var images = imageFileIds.map(function (fid) {
    return {
      file_id: fid,
      metadata: { source: -1 },
      stickers: { version: 2, floating: [] },
      extra_info_json: '{"mimeType":"image/jpeg"}'
    };
  });

  var businessBinds = JSON.stringify({
    version: 1, noteId: 0, noteOrderBind: {},
    notePostTiming: { postTime: null },
    noteCollectionBind: { id: '' }
  });

  var noteData = {
    common: {
      type: 'normal',
      title: title,
      note_id: '',
      desc: desc,
      source: '{"type":"web","ids":"","extraInfo":"{\\"subType\\":\\"official\\"}"}',
      business_binds: businessBinds,
      ats: [],
      hash_tag: [],
      post_loc: {},
      privacy_info: { op_type: 1, type: isPrivate ? 1 : 0 }
    },
    image_info: { images: images },
    video_info: null
  };

  var tab = await getXhsSignTab();
  var noteDataStr = JSON.stringify(noteData);

  addLog('info', '在小红书页面中发起创建请求...');

  var results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: function (noteDataStr) {
      return new Promise(function (resolve) {
        try {
          var noteData = JSON.parse(noteDataStr);
          var uri = '/web_api/sns/v2/note';
          var bodyStr = JSON.stringify(noteData);

          var headers = {
            'Content-Type': 'application/json',
            'Origin': 'https://creator.xiaohongshu.com',
            'Referer': 'https://creator.xiaohongshu.com/'
          };

          if (typeof window._webmsxyw === 'function') {
            var sign = window._webmsxyw(uri, noteData);
            if (sign) {
              var keys = Object.keys(sign);
              for (var i = 0; i < keys.length; i++) {
                headers[keys[i]] = sign[keys[i]];
              }
            }
          }

          fetch('https://edith.xiaohongshu.com' + uri, {
            method: 'POST',
            headers: headers,
            credentials: 'include',
            body: bodyStr
          }).then(function (resp) {
            return resp.json().then(function (json) {
              resolve({ status: resp.status, data: json });
            });
          }).catch(function (e) {
            resolve({ error: e.message });
          });
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    },
    args: [noteDataStr]
  });

  var result = results && results[0] && results[0].result;
  if (!result) throw new Error('页面执行无返回');
  if (result.error) throw new Error(result.error);
  if (result.data && result.data.success) return result.data.data || result.data.success;
  if (result.status === 461 || result.status === 471) throw new Error('触发验证码（' + result.status + '），请在浏览器里打开小红书完成验证后重试');
  throw new Error('HTTP ' + result.status + ': ' + JSON.stringify(result.data || {}));
}

// ===== 同步主流程 =====

async function handleSync(payload) {
  var item = payload.item;
  var platform = payload.platform;
  addLog('info', '开始同步「' + (item.title || '无标题') + '」到 ' + platform);

  try {
    if (platform === 'xiaohongshu') {
      return await syncToXiaohongshu(item);
    }
    if (platform === 'wechat_mp') {
      return await syncToWechatMp(item);
    }
    addLog('error', '平台 ' + platform + ' 暂未支持');
    return { success: false, error: '平台 ' + platform + ' 暂未支持' };
  } catch (e) {
    addLog('error', '同步异常: ' + e.message);
    return { success: false, error: e.message };
  }
}

async function syncToXiaohongshu(item) {
  var imagePaths = item.images || [];
  if (imagePaths.length === 0) {
    return { success: false, error: '小红书笔记需要至少一张图片，请先在创作者页面手动上传图片' };
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

  // 2. 打开或找到创作者发布页
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

  // 注入 shadow-patch 让 closed shadow DOM 变 open
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

  // 3. 点击"上传图文"标签并通过 file input 上传图片
  addLog('info', '切换到图文模式并上传图片...');
  for (var j = 0; j < imageDataList.length; j++) {
    try {
      var uploadResult = await withTimeout(chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        world: 'MAIN',
        func: function (base64, mimeType, fileName) {
          return new Promise(function (resolve) {
            try {
              // 先点击"上传图文"标签
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
                  // 找到图片文件输入框（accept 包含 .jpg 的那个）
                  var imgInput = document.querySelector('input[type="file"][accept*=".jpg"]');
                  if (!imgInput) {
                    resolve({ success: false, error: '未找到图片上传框，请确认在"上传图文"标签页' });
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

  // 4. 等待图片上传完成 + 编辑器出现，填入标题和正文，存草稿
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

// ===== 公众号同步（纯 API，后台完成）=====

async function syncToWechatMp(item) {
  addLog('info', '开始公众号同步（API 方式）...');

  // 从 chrome.storage 读取 AppID 和 AppSecret
  var config = await chrome.storage.local.get(['wechatMpAppId', 'wechatMpAppSecret']);
  if (!config.wechatMpAppId || !config.wechatMpAppSecret) {
    addLog('error', '请先在设置页配置公众号 AppID 和 AppSecret');
    return { success: false, error: '请先在设置页配置公众号 AppID 和 AppSecret' };
  }

  // 通过 Native Host 执行 API 调用
  return new Promise(function (resolve) {
    var callbackKey = 'wechat_mp_' + Date.now();

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