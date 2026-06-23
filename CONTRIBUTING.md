# 贡献指南 — 添加新平台 Adapter

## 架构概览

DraftPush 采用 **Service Worker 调度 + Content Script 执行** 的架构：

```
Service Worker (background)
  ├── handleSync() — 调度入口
  ├── PLATFORM_ADAPTERS — 平台注册表
  ├── syncToXiaohongshu() — 小红书同步
  ├── syncToDouyin() — 抖音同步
  └── syncToWechatMp() — 公众号同步（API 方式）

Content Scripts (页面注入)
  ├── xiaohongshu.js — 小红书编辑器操作
  └── douyin.js — 抖音编辑器操作
```

## 添加新平台步骤

### 1. 确定同步方式

| 方式 | 适用场景 | 示例 |
|------|----------|------|
| DOM 自动化 | 平台无公开 API，需要浏览器操作 | 小红书、抖音 |
| API 调用 | 平台有官方 API | 微信公众号 |

### 2. DOM 自动化方式

#### a. 创建 Content Script

新建 `extension/content-scripts/{platform}.js`：

```javascript
(() => {
  chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
    if (request.type === '{platform}_fill_and_save') {
      fillAndSave(request.payload)
        .then(sendResponse)
        .catch(function (e) { sendResponse({ success: false, error: e.message }); });
      return true;
    }
  });

  async function fillAndSave(item) {
    var logs = [];
    function log(msg) { logs.push(msg); }

    // 1. 等待编辑器元素出现
    // 2. 填入标题
    // 3. 填入正文（注意去除 markdown 格式）
    // 4. 添加标签
    // 5. 点击保存/存草稿按钮

    return { success: true, message: '同步完成', logs: logs };
  }

  function waitFor(selector, timeout) {
    return new Promise(function (resolve) {
      var el = document.querySelector(selector);
      if (el) { resolve(el); return; }
      var observer = new MutationObserver(function () {
        el = document.querySelector(selector);
        if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      var timer = setTimeout(function () { observer.disconnect(); resolve(null); }, timeout);
    });
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
})();
```

#### b. 注册到 manifest.json

```json
{
  "content_scripts": [
    {
      "matches": ["https://{platform-domain}/*"],
      "js": ["content-scripts/{platform}.js"],
      "run_at": "document_idle"
    }
  ],
  "host_permissions": [
    "https://{platform-domain}/*"
  ]
}
```

#### c. 添加同步函数到 service-worker.js

在 `PLATFORM_ADAPTERS` 中注册：

```javascript
var PLATFORM_ADAPTERS = {
  // ... 已有平台
  {platform_id}: { name: '平台名', sync: syncTo{Platform} },
};
```

然后实现 `syncTo{Platform}()` 函数，流程：
1. 读取本地图片（`readFileFromHost`）
2. 打开平台编辑页（`chrome.tabs.create`）
3. 上传图片（`chrome.scripting.executeScript` + DataTransfer）
4. 发消息给 content script 填入内容

#### d. 注册到 popup

在 `popup.js` 的 `PLATFORMS` 对象中添加：

```javascript
var PLATFORMS = {
  // ... 已有平台
  {platform_id}: '平台名',
};
```

### 3. API 方式（参考公众号）

如果平台有官方 API：
1. 在 `native-host/host.js` 中添加 API 调用逻辑
2. 在 `service-worker.js` 中添加消息转发
3. 在 `options.html` 中添加 API 配置 UI

### 4. 测试清单

- [ ] 图片上传成功
- [ ] 标题填入正确（注意平台字数限制）
- [ ] 正文格式正确（markdown 已清除）
- [ ] 标签添加正确
- [ ] 存草稿/发布成功
- [ ] 失败时有明确错误信息
- [ ] 重试逻辑正常工作

## 平台限制参考

| 平台 | 标题限制 | 正文限制 | 图片限制 |
|------|----------|----------|----------|
| 小红书 | 20字 | 1000字 | 9张 |
| 抖音 | 30字 | 2000字 | 35张 |
| 公众号 | 64字 | 无限制 | 通过 API |
