const HOST_NAME = 'com.draftpush.host';
let nativePort = null;
let pendingItems = [];

function connectNativeHost() {
  if (nativePort) return;

  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);

    nativePort.onMessage.addListener((msg) => {
      if (msg.type === 'new_content') {
        pendingItems.push(msg.payload);
        updateBadge();
        chrome.notifications.create(`new-${Date.now()}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '草稿推送',
          message: `新内容：${msg.payload.title}`,
        });
      }

      if (msg.type === 'content_list') {
        pendingItems = msg.payload;
        updateBadge();
      }

      if (msg.type === 'archive_done') {
        pendingItems = pendingItems.filter((item) => item.folder !== msg.payload.folder);
        updateBadge();
      }
    });

    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
    });

    nativePort.postMessage({ type: 'list_pending' });
  } catch (e) {
    nativePort = null;
  }
}

function updateBadge() {
  const count = pendingItems.length;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
}

function sendToHost(message) {
  if (!nativePort) connectNativeHost();
  if (nativePort) {
    nativePort.postMessage(message);
  }
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
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
});

async function handleSync(payload) {
  const { item, platform } = payload;
  try {
    if (platform === 'xiaohongshu') {
      const [tab] = await chrome.tabs.query({ url: 'https://creator.xiaohongshu.com/*' });

      if (!tab) {
        const newTab = await chrome.tabs.create({
          url: 'https://creator.xiaohongshu.com/publish/publish',
          active: false,
        });
        await new Promise((r) => setTimeout(r, 3000));
        const result = await chrome.tabs.sendMessage(newTab.id, {
          type: 'xhs_sync_draft',
          payload: item,
        });
        return result;
      }

      const result = await chrome.tabs.sendMessage(tab.id, {
        type: 'xhs_sync_draft',
        payload: item,
      });
      return result;
    }

    return { success: false, error: `平台 ${platform} 暂未支持` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

connectNativeHost();
