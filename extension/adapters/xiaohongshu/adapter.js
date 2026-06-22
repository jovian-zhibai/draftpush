import platformConfig from './platform.json' with { type: 'json' };

class XiaohongshuAdapter {
  constructor() {
    this.config = platformConfig;
    this.id = platformConfig.id;
    this.name = platformConfig.name;
  }

  async checkAuth() {
    try {
      const resp = await fetch('https://edith.xiaohongshu.com/api/sns/web/v1/user/me', {
        credentials: 'include',
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  formatContent(contentJson) {
    let body = contentJson.body || '';

    body = body
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^[-*+]\s+/gm, '• ')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/^>\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n');

    let title = (contentJson.title || '').slice(0, this.config.limits.title_max);

    const tags = (contentJson.tags || [])
      .slice(0, this.config.limits.tags_max)
      .map((t) => `#${t}`)
      .join(' ');

    if (tags) {
      body = body.trim() + '\n\n' + tags;
    }

    if (body.length > this.config.limits.body_max) {
      body = body.slice(0, this.config.limits.body_max - 3) + '...';
    }

    return {
      title,
      body,
      tags: contentJson.tags || [],
      cover: contentJson.cover,
      images: contentJson.images || [],
    };
  }

  async syncToDraft(formattedContent) {
    return {
      success: true,
      formatted: formattedContent,
      message: '内容已格式化，等待 Content Script 写入草稿',
    };
  }
}

export default XiaohongshuAdapter;