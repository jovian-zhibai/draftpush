(() => {
  chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
    if (request.type === 'douyin_fill_and_save') {
      fillAndSave(request.payload)
        .then(sendResponse)
        .catch(function (e) { sendResponse({ success: false, error: e.message }); });
      return true;
    }
  });

  async function fillAndSave(item) {
    var logs = [];
    function log(msg) { logs.push(msg); }

    try {
      // 1. 等待标题输入框
      log('等待编辑器加载...');
      var titleInput = await waitFor('input[placeholder*="填写作品标题"]', 120000);
      if (!titleInput) {
        return { success: false, error: '未找到标题输入框，请确认已上传图片且在编辑页面', logs: logs };
      }

      // 2. 填入标题（抖音限制30字）
      log('填入标题...');
      var title = (item.title || '').slice(0, 30);
      titleInput.focus();
      titleInput.value = title;
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('标题已填入: ' + title.substring(0, 20));

      // 3. 填入正文 + 标签
      log('填入正文...');
      var descEditor = await waitFor('div.zone-container[contenteditable="true"]', 10000);
      if (!descEditor) {
        descEditor = await waitFor('[contenteditable="true"]', 5000);
      }
      if (!descEditor) {
        log('未找到正文编辑器，标题已填入');
        return { success: true, message: '标题已填入，未找到正文编辑器，请手动填写正文', logs: logs };
      }

      descEditor.focus();
      await delay(300);

      // 清空现有内容
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await delay(200);

      // 填入正文（去除 markdown 格式）
      var body = (item.body || '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^[-*+]\s+/gm, '• ')
        .replace(/^>\s+/gm, '')
        .replace(/\n{3,}/g, '\n\n');

      var lines = body.split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (i > 0) document.execCommand('insertParagraph', false, null);
        if (lines[i]) document.execCommand('insertText', false, lines[i]);
      }
      log('正文已填入 (' + lines.length + ' 行)');

      // 4. 添加标签
      var tags = item.tags || [];
      if (tags.length > 0) {
        log('添加标签...');
        document.execCommand('insertParagraph', false, null);
        for (var t = 0; t < tags.length; t++) {
          document.execCommand('insertText', false, ' #' + tags[t]);
          await delay(300);
          // 按空格确认标签
          descEditor.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
          await delay(500);
        }
        // 按 Escape 关闭话题下拉
        descEditor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        log('标签已添加: ' + tags.join(', '));
      }

      descEditor.dispatchEvent(new Event('input', { bubbles: true }));

      // 5. 尝试存草稿
      log('查找存草稿/发布按钮...');
      await delay(1000);

      // 尝试找"存草稿"按钮
      var saveBtn = findButtonByText('存草稿');
      if (saveBtn) {
        log('点击存草稿...');
        saveBtn.click();
        await delay(2000);
        log('存草稿完成');
        return { success: true, message: '标题和正文已填入，已点击存草稿', logs: logs };
      }

      log('未找到存草稿按钮，内容已填入，请手动保存');
      return { success: true, message: '标题和正文已填入，请手动保存', logs: logs };

    } catch (e) {
      return { success: false, error: e.message, logs: logs };
    }
  }

  function findButtonByText(text) {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].textContent.trim().indexOf(text) >= 0) return buttons[i];
    }
    // Semi UI 的按钮可能在 span 里
    var spans = document.querySelectorAll('span[role="button"], div[role="button"]');
    for (var j = 0; j < spans.length; j++) {
      if (spans[j].textContent.trim().indexOf(text) >= 0) return spans[j];
    }
    return null;
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

      var timer = setTimeout(function () {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
})();
