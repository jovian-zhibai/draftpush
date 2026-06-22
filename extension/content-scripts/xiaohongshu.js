(() => {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'xhs_sync_draft') {
      syncDraft(request.payload)
        .then(sendResponse)
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;
    }

    if (request.type === 'xhs_check_login') {
      checkLogin()
        .then((ok) => sendResponse({ loggedIn: ok }))
        .catch(() => sendResponse({ loggedIn: false }));
      return true;
    }
  });

  async function checkLogin() {
    try {
      const resp = await fetch(
        'https://edith.xiaohongshu.com/api/sns/web/v1/user/me',
        { credentials: 'include' }
      );
      return resp.ok;
    } catch {
      return false;
    }
  }

  async function syncDraft(item) {
    const loggedIn = await checkLogin();
    if (!loggedIn) {
      return { success: false, error: '请先在浏览器中登录小红书' };
    }

    try {
      const imageUrls = [];

      if (item.images && item.images.length > 0) {
        for (const imgPath of item.images) {
          // Phase 1: 图片上传需要对接小红书的上传接口
          // 实际实现中需要：
          // 1. 从本地读取图片（通过 Native Host 传 base64）
          // 2. 调用小红书图片上传 API
          // 3. 拿到 CDN URL
          imageUrls.push(imgPath);
        }
      }

      // Phase 1: 通过操作页面 DOM 填入内容
      // 小红书创作者平台的发布页面结构：
      // - 标题输入框
      // - 正文编辑器（富文本）
      // - 标签输入
      // - 图片上传区域
      const titleInput = document.querySelector(
        '[placeholder="填写标题，可能会有更多赞哦～"],' +
        'input[class*="title"],' +
        '[data-testid="note-title"]'
      );

      const editor = document.querySelector(
        '[contenteditable="true"],' +
        '[class*="editor"],' +
        '[data-testid="note-content"]'
      );

      if (titleInput) {
        setNativeValue(titleInput, item.title || '');
      }

      if (editor) {
        editor.focus();
        editor.innerHTML = '';
        const lines = (item.body || '').split('\n');
        for (const line of lines) {
          const p = document.createElement('p');
          p.textContent = line || '​';
          editor.appendChild(p);
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }

      return {
        success: true,
        message: '内容已填入小红书编辑器，请检查后手动发布',
      };
    } catch (e) {
      return { success: false, error: `同步失败: ${e.message}` };
    }
  }

  function setNativeValue(element, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
})();