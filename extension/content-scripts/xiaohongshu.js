(() => {
  chrome.runtime.onMessage.addListener(function (request, _sender, sendResponse) {
    if (request.type === 'xhs_fill_and_save') {
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
      // 1. 等待编辑器出现
      log('等待编辑器加载...');
      var titleInput = await waitFor('input.d-text[placeholder*="标题"]', 5000);
      var editor = await waitFor('div.tiptap.ProseMirror', 5000);

      if (!titleInput || !editor) {
        return { success: false, error: '未找到编辑器，请确认已上传图片且在图文编辑页面', logs: logs };
      }

      // 2. 填入标题（小红书限制20字）
      log('填入标题...');
      var title = (item.title || '').slice(0, 20);
      titleInput.focus();
      titleInput.value = title;
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('标题已填入: ' + title);

      // 3. 填入正文（不能用 selectAll，会覆盖图片）
      log('填入正文...');
      editor.focus();
      var body = item.body || '';
      body = body.replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');

      // 把光标移到编辑器末尾，不选中任何内容
      var range = document.createRange();
      var sel = window.getSelection();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      // 逐行插入文本
      var lines = body.split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (i > 0) document.execCommand('insertParagraph', false, null);
        if (lines[i]) document.execCommand('insertText', false, lines[i]);
      }
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      log('正文已填入 (' + lines.length + ' 行)');

      // 4. 点击存草稿
      log('查找存草稿按钮...');
      await delay(500);

      var saveBtn = findSaveDraftButton();
      if (saveBtn) {
        log('点击存草稿...');
        saveBtn.click();
        await delay(2000);
        log('存草稿完成');
        return { success: true, message: '标题和正文已填入，已点击存草稿', logs: logs };
      }

      log('未找到存草稿按钮，内容已填入，请手动保存');
      return { success: true, message: '标题和正文已填入，请手动点击"暂存离开"保存草稿', logs: logs };

    } catch (e) {
      return { success: false, error: e.message, logs: logs };
    }
  }

  function findSaveDraftButton() {
    // 方法1: 通过 open shadow root 访问
    var publishBtn = document.querySelector('xhs-publish-btn');
    if (publishBtn) {
      var shadow = publishBtn.shadowRoot || publishBtn._shadowRoot;
      if (shadow) {
        var btn = shadow.querySelector('button.ce-btn.white');
        if (btn) return btn;
      }
    }

    // 方法2: 遍历所有 shadow root
    var allElements = document.querySelectorAll('*');
    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      var sr = el.shadowRoot || el._shadowRoot;
      if (sr) {
        var found = sr.querySelector('button.ce-btn.white');
        if (found) return found;
      }
    }

    // 方法3: 直接搜索页面上的按钮文字
    var buttons = document.querySelectorAll('button');
    for (var j = 0; j < buttons.length; j++) {
      if (buttons[j].textContent.trim() === '暂存离开') return buttons[j];
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