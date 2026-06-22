/**
 * 平台 Adapter 模板
 *
 * 新增平台：
 * 1. 复制 _template/ 目录，重命名为平台 ID
 * 2. 修改 platform.json 填入平台信息
 * 3. 实现下面三个方法
 */

class TemplateAdapter {
  constructor(platformConfig) {
    this.config = platformConfig;
    this.id = platformConfig.id;
    this.name = platformConfig.name;
  }

  /**
   * 检查用户是否已鉴权
   * - browser 类型：检查浏览器是否已登录该平台
   * - api 类型：验证 AppID/AppSecret 是否有效
   * @returns {Promise<boolean>}
   */
  async checkAuth() {
    // 示例：检查浏览器登录态
    // const resp = await fetch('https://creator.example.com/api/user/info', {
    //   credentials: 'include',
    // });
    // return resp.ok;

    throw new Error('checkAuth() not implemented');
  }

  /**
   * 将标准 content.json 转为平台特定格式
   * @param {object} contentJson - 标准 content.json 内容
   * @returns {object} 平台特定格式的内容
   */
  formatContent(contentJson) {
    // 根据 platform.json 中的 format 字段：
    // - "plaintext": 去掉 Markdown 语法，保留纯文本
    // - "html": Markdown → HTML
    // - "markdown": 原样输出

    throw new Error('formatContent() not implemented');
  }

  /**
   * 将格式化后的内容写入平台草稿箱
   * @param {object} formattedContent - formatContent() 的输出
   * @returns {Promise<{success: boolean, message?: string, error?: string}>}
   */
  async syncToDraft(formattedContent) {
    // 实现平台特定的草稿写入逻辑
    // 可以是调用 API，也可以是操作页面 DOM

    throw new Error('syncToDraft() not implemented');
  }
}

export default TemplateAdapter;