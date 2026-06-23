(() => {
  var DEFAULT_SELECTORS = {
    title_input: 'input.d-text[placeholder*="标题"]',
    editor: 'div.tiptap.ProseMirror',
    save_button_shadow: 'xhs-publish-btn',
    save_button_class: 'button.ce-btn.white',
    save_button_text: '暂存离开',
    title_max: 20,
  };

  var sel = DEFAULT_SELECTORS;

  chrome.runtime.sendMessage({ type: 'get_selectors', platform: 'xiaohongshu' }, function (resp) {
    if (resp && resp.selectors) sel = Object.assign({}, DEFAULT_SELECTORS, resp.selectors);
  });

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
      log('等待编辑器加载...');
      var titleInput = await waitFor(sel.title_input, 5000);
      var editor = await waitFor(sel.editor, 5000);

      if (!titleInput || !editor) {
        return { success: false, error: '未找到编辑器，请确认已上传图片且在图文编辑页面', logs: logs };
      }

      log('填入标题...');
      var title = (item.title || '').slice(0, sel.title_max);
      titleInput.focus();
      titleInput.value = title;
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('标题已填入: ' + title);

      log('填入正文...');
      editor.focus();
      var body = item.body || '';
      body = body.replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');

      var range = document.createRange();
      var selection = window.getSelection();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      var lines = body.split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (i > 0) document.execCommand('insertParagraph', false, null);
        if (lines[i]) document.execCommand('insertText', false, lines[i]);
      }
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      log('正文已填入 (' + lines.length + ' 行)');

      var isDirect = item.publishMode === 'publish';
      log(isDirect ? '查找发布按钮...' : '查找存草稿按钮...');
      await delay(1000);

      if (isDirect) {
        var publishBtn = findPublishButton();
        if (!publishBtn) {
          log('发布按钮未立即出现，等待中...');
          await delay(3000);
          publishBtn = findPublishButton();
        }
        if (publishBtn) {
          if (publishBtn.disabled) {
            log('发布按钮暂时不可用，等待...');
            await delay(3000);
          }
          log('点击发布...');
          publishBtn.click();
          await delay(2000);

          // 处理确认对话框
          var confirmBtn = document.querySelector('.modal-footer .btn-primary') ||
                          document.querySelector('.xhs-dialog .btn-primary') ||
                          document.querySelector('button.ce-btn.bg-red:not([disabled])');
          if (!confirmBtn) {
            var allBtns = document.querySelectorAll('button');
            for (var b = 0; b < allBtns.length; b++) {
              var btnText = allBtns[b].textContent.trim();
              if (btnText === '确认' || btnText === '确认发布' || btnText === '确定') {
                confirmBtn = allBtns[b];
                break;
              }
            }
          }
          if (confirmBtn && confirmBtn !== publishBtn) {
            log('点击确认发布...');
            confirmBtn.click();
            await delay(3000);
          }

          log('发布完成');
          return { success: true, message: '标题和正文已填入，已点击发布', logs: logs };
        }
        log('未找到发布按钮，降级为存草稿...');
      }

      var saveBtn = findSaveDraftButton();
      if (saveBtn) {
        log('点击存草稿...');
        saveBtn.click();
        await delay(2000);
        log('存草稿完成');
        return { success: true, message: '标题和正文已填入，已点击存草稿', logs: logs };
      }

      log('未找到按钮，内容已填入，请手动操作');
      return { success: true, message: '标题和正文已填入，请手动保存或发布', logs: logs };

    } catch (e) {
      return { success: false, error: e.message, logs: logs };
    }
  }

  function findPublishButton() {
    var publishEl = document.querySelector(sel.save_button_shadow);
    if (publishEl) {
      var shadow = publishEl.shadowRoot || publishEl._shadowRoot;
      if (shadow) {
        var btn = shadow.querySelector('button.ce-btn.bg-red');
        if (btn) return btn;
      }
    }
    var allElements = document.querySelectorAll('*');
    for (var i = 0; i < allElements.length; i++) {
      var sr = allElements[i].shadowRoot || allElements[i]._shadowRoot;
      if (sr) {
        var found = sr.querySelector('button.ce-btn.bg-red');
        if (found) return found;
      }
    }
    var buttons = document.querySelectorAll('button');
    for (var j = 0; j < buttons.length; j++) {
      if (buttons[j].textContent.trim() === '发布') return buttons[j];
    }
    return null;
  }

  function findSaveDraftButton() {
    var publishBtn = document.querySelector(sel.save_button_shadow);
    if (publishBtn) {
      var shadow = publishBtn.shadowRoot || publishBtn._shadowRoot;
      if (shadow) {
        var btn = shadow.querySelector(sel.save_button_class);
        if (btn) return btn;
      }
    }

    var allElements = document.querySelectorAll('*');
    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      var sr = el.shadowRoot || el._shadowRoot;
      if (sr) {
        var found = sr.querySelector(sel.save_button_class);
        if (found) return found;
      }
    }

    var buttons = document.querySelectorAll('button');
    for (var j = 0; j < buttons.length; j++) {
      if (buttons[j].textContent.trim() === sel.save_button_text) return buttons[j];
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
