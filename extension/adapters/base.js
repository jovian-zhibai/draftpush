class BaseAdapter {
  constructor(platformConfig) {
    this.config = platformConfig;
    this.id = platformConfig.id;
    this.name = platformConfig.name;
  }

  async checkAuth() {
    throw new Error(`${this.id}: checkAuth() not implemented`);
  }

  formatContent(_contentJson) {
    throw new Error(`${this.id}: formatContent() not implemented`);
  }

  async syncToDraft(_formattedContent) {
    throw new Error(`${this.id}: syncToDraft() not implemented`);
  }

  async sync(contentJson) {
    const authOk = await this.checkAuth();
    if (!authOk) {
      return { success: false, error: `请先登录${this.name}` };
    }

    const formatted = this.formatContent(contentJson);
    return this.syncToDraft(formatted);
  }
}

if (typeof module !== 'undefined') {
  module.exports = BaseAdapter;
}