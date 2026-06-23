#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_WATCH_DIR = path.join(os.homedir(), '.draftpush', 'outbox');
const PENDING_DIR = '待同步';
const ARCHIVED_DIR = '已同步';

const configPath = path.join(os.homedir(), '.draftpush', 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {}
  return { watch_dir: DEFAULT_WATCH_DIR };
}

function ensureDirs(watchDir) {
  const pending = path.join(watchDir, PENDING_DIR);
  const archived = path.join(watchDir, ARCHIVED_DIR);
  fs.mkdirSync(pending, { recursive: true });
  fs.mkdirSync(archived, { recursive: true });
  return { pending, archived };
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const jsonBuf = Buffer.from(json, 'utf-8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(jsonBuf.length, 0);
  process.stdout.write(lenBuf);
  process.stdout.write(jsonBuf);
}

function readMessage(callback) {
  let buf = Buffer.alloc(0);

  process.stdin.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);

    while (buf.length >= 4) {
      const msgLen = buf.readUInt32LE(0);
      if (buf.length < 4 + msgLen) break;

      const msgStr = buf.slice(4, 4 + msgLen).toString('utf-8');
      buf = buf.slice(4 + msgLen);

      try {
        const msg = JSON.parse(msgStr);
        callback(msg);
      } catch (e) { sendMessage({ type: 'error', payload: { error: 'JSON parse error: ' + e.message } }); }
    }
  });
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    let val = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); });
    }
    meta[key] = val;
  }
  return { meta: meta, body: match[2] };
}

function scanFolder(folderPath, folderName) {
  var files;
  try {
    files = fs.readdirSync(folderPath);
  } catch { return null; }

  var contentJsonPath = path.join(folderPath, 'content.json');
  if (fs.existsSync(contentJsonPath)) {
    try {
      var content = JSON.parse(fs.readFileSync(contentJsonPath, 'utf-8'));
      return Object.assign({}, content, { folder: folderName, folder_path: folderPath });
    } catch {}
  }

  var metaFile = files.find(function (f) { return f.endsWith('-meta.json'); });
  if (metaFile) {
    try {
      var meta = JSON.parse(fs.readFileSync(path.join(folderPath, metaFile), 'utf-8'));
      var mdFile = files.find(function (f) { return f.endsWith('.md'); });
      var body = '';
      var frontMeta = {};
      if (mdFile) {
        var mdContent = fs.readFileSync(path.join(folderPath, mdFile), 'utf-8');
        var parsed = parseFrontmatter(mdContent);
        frontMeta = parsed.meta;
        body = parsed.body;
      }
      var htmlFiles = files.filter(function (f) { return f.endsWith('.html'); });
      var imageFiles = files.filter(function (f) { return /\.(png|jpg|jpeg|gif|webp)$/i.test(f); });

      return {
        title: meta.title || frontMeta.title || folderName,
        body: body,
        tags: meta.tags || frontMeta.tags || [],
        platforms: meta.platforms || frontMeta.platforms || ['xiaohongshu'],
        cover: meta.cover || frontMeta.cover || (htmlFiles.length > 0 ? htmlFiles[0] : ''),
        cover_html: htmlFiles.length > 0 ? htmlFiles[0] : '',
        images: imageFiles,
        status: 'pending',
        folder: folderName,
        folder_path: folderPath,
      };
    } catch {}
  }

  var mdFile = files.find(function (f) { return f.endsWith('.md'); });
  if (mdFile) {
    var mdContent = fs.readFileSync(path.join(folderPath, mdFile), 'utf-8');
    var parsed = parseFrontmatter(mdContent);
    var htmlFiles = files.filter(function (f) { return f.endsWith('.html'); });
    var imageFiles = files.filter(function (f) { return /\.(png|jpg|jpeg|gif|webp)$/i.test(f); });
    var stat = fs.statSync(path.join(folderPath, mdFile));

    return {
      title: parsed.meta.title || folderName,
      body: parsed.body,
      tags: parsed.meta.tags || [],
      platforms: parsed.meta.platforms || ['xiaohongshu'],
      cover: parsed.meta.cover || (htmlFiles.length > 0 ? htmlFiles[0] : ''),
      cover_html: htmlFiles.length > 0 ? htmlFiles[0] : '',
      images: imageFiles,
      created_at: stat.mtime.toISOString(),
      status: 'pending',
      folder: folderName,
      folder_path: folderPath,
    };
  }

  return null;
}

function scanPending(pendingDir) {
  var items = [];
  if (!fs.existsSync(pendingDir)) return items;

  var folders = fs.readdirSync(pendingDir, { withFileTypes: true })
    .filter(function (d) { return d.isDirectory(); });

  for (var i = 0; i < folders.length; i++) {
    var folderPath = path.join(pendingDir, folders[i].name);
    var item = scanFolder(folderPath, folders[i].name);
    if (item) items.push(item);
  }

  return items;
}

function archiveFolder(pendingDir, archivedDir, folderName) {
  const src = path.join(pendingDir, folderName);
  const dst = path.join(archivedDir, folderName);

  if (!fs.existsSync(src)) return false;

  const logPath = path.join(src, 'sync_log.json');
  const log = {
    synced_at: new Date().toISOString(),
    from: src,
    to: dst,
  };
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  fs.renameSync(src, dst);
  return true;
}

function main() {
  var config = loadConfig();
  var watchDir = config.watch_dir || DEFAULT_WATCH_DIR;
  var dirs = ensureDirs(watchDir);

  readMessage(function (msg) {
    if (msg.type === 'list_pending') {
      var items = scanPending(dirs.pending);
      sendMessage({ type: 'content_list', payload: items });
    }

    if (msg.type === 'archive') {
      var ok = archiveFolder(dirs.pending, dirs.archived, msg.payload.folder);
      sendMessage({
        type: 'archive_done',
        payload: { folder: msg.payload.folder, success: ok },
      });
    }

    if (msg.type === 'get_config') {
      sendMessage({ type: 'config', payload: config });
    }

    if (msg.type === 'set_config') {
      Object.assign(config, msg.payload);
      var configDir = path.dirname(configPath);
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      watchDir = config.watch_dir || DEFAULT_WATCH_DIR;
      dirs = ensureDirs(watchDir);
      sendMessage({ type: 'config_saved', payload: config });
    }

    if (msg.type === 'read_file') {
      var filePath = msg.payload.path;
      if (!path.isAbsolute(filePath) && msg.payload.folder_path) {
        filePath = path.join(msg.payload.folder_path, filePath);
      }
      try {
        var data = fs.readFileSync(filePath);
        var base64 = data.toString('base64');
        var ext = path.extname(filePath).toLowerCase();
        var mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        sendMessage({ type: 'file_data', payload: { path: filePath, base64: base64, mimeType: mimeType, size: data.length } });
      } catch (e) {
        sendMessage({ type: 'file_error', payload: { path: filePath, error: e.message } });
      }
    }

    if (msg.type === 'wechat_mp_sync') {
      wechatMpSync(msg.payload).then(function (result) {
        sendMessage({ type: 'wechat_mp_result', payload: result });
      });
    }
  });

  var debounceTimer = null;

  try {
    fs.watch(dirs.pending, { recursive: true }, function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        var items = scanPending(dirs.pending);
        sendMessage({ type: 'content_list', payload: items });
      }, 500);
    });
  } catch {}
}

// ===== 微信公众号 API =====

var https = require('https');
var http = require('http');

function httpRequest(url, options, body) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith('https') ? https : http;
    var req = mod.request(url, options, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks);
        try { resolve(JSON.parse(raw.toString())); }
        catch (e) { resolve({ raw: raw.toString() }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartUpload(url, filePath, fieldName) {
  return new Promise(function (resolve, reject) {
    var fileData = fs.readFileSync(filePath);
    var fileName = path.basename(filePath);
    var ext = path.extname(filePath).toLowerCase();
    var mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    var boundary = '----DraftPush' + Date.now();

    var header = '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="' + fieldName + '"; filename="' + fileName + '"\r\n' +
      'Content-Type: ' + mimeType + '\r\n\r\n';
    var footer = '\r\n--' + boundary + '--\r\n';

    var body = Buffer.concat([Buffer.from(header), fileData, Buffer.from(footer)]);

    var urlObj = new URL(url);
    var options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length
      }
    };

    var req = https.request(options, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { resolve({ error: 'parse error' }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(md) {
  var lines = md.split('\n');
  var html = [];
  var inList = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    var h3 = line.match(/^### (.+)$/);
    if (h3) { if (inList) { html.push('</ul>'); inList = false; } html.push('<h3>' + inlineFormat(h3[1]) + '</h3>'); continue; }
    var h2 = line.match(/^## (.+)$/);
    if (h2) { if (inList) { html.push('</ul>'); inList = false; } html.push('<h2>' + inlineFormat(h2[1]) + '</h2>'); continue; }
    var h1 = line.match(/^# (.+)$/);
    if (h1) { if (inList) { html.push('</ul>'); inList = false; } html.push('<h1>' + inlineFormat(h1[1]) + '</h1>'); continue; }

    var ul = line.match(/^[-*+] (.+)$/);
    if (ul) { if (!inList) { html.push('<ul>'); inList = true; } html.push('<li>' + inlineFormat(ul[1]) + '</li>'); continue; }

    var ol = line.match(/^\d+\. (.+)$/);
    if (ol) { if (!inList) { html.push('<ul>'); inList = true; } html.push('<li>' + inlineFormat(ol[1]) + '</li>'); continue; }

    var bq = line.match(/^> (.+)$/);
    if (bq) { if (inList) { html.push('</ul>'); inList = false; } html.push('<blockquote>' + inlineFormat(bq[1]) + '</blockquote>'); continue; }

    if (line.trim() === '') { if (inList) { html.push('</ul>'); inList = false; } continue; }

    if (inList) { html.push('</ul>'); inList = false; }
    html.push('<p>' + inlineFormat(line) + '</p>');
  }

  if (inList) html.push('</ul>');
  return html.join('');
}

async function wechatMpSync(payload) {
  var logs = [];
  function log(msg) { logs.push(msg); }

  try {
    var appId = payload.appId;
    var appSecret = payload.appSecret;
    var item = payload.item;

    if (!appId || !appSecret) {
      return { success: false, error: '请先配置公众号 AppID 和 AppSecret', logs: logs };
    }

    // 1. 获取 access_token
    log('获取 access_token...');
    var tokenUrl = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + appId + '&secret=' + appSecret;
    var tokenRes = await httpRequest(tokenUrl, { method: 'GET' });

    if (!tokenRes.access_token) {
      return { success: false, error: '获取 token 失败: ' + (tokenRes.errmsg || JSON.stringify(tokenRes)), logs: logs };
    }
    var token = tokenRes.access_token;
    log('access_token 获取成功');

    // 2. 上传封面图（永久素材）
    var thumbMediaId = '';
    var coverPath = '';
    if (item.images && item.images.length > 0) {
      var imgFile = item.images[0];
      if (!path.isAbsolute(imgFile) && item.folder_path) {
        coverPath = path.join(item.folder_path, imgFile);
      } else {
        coverPath = imgFile;
      }
    }

    if (coverPath && fs.existsSync(coverPath)) {
      log('上传封面图...');
      var uploadUrl = 'https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=' + token + '&type=image';
      var uploadRes = await multipartUpload(uploadUrl, coverPath, 'media');

      if (uploadRes.media_id) {
        thumbMediaId = uploadRes.media_id;
        log('封面图上传成功: ' + thumbMediaId);
      } else {
        log('封面图上传失败: ' + (uploadRes.errmsg || JSON.stringify(uploadRes)));
      }
    }

    // 3. 转换正文 Markdown → HTML
    log('转换正文格式...');
    var body = item.body || '';
    var htmlContent = markdownToHtml(body);

    // 4. 创建草稿
    log('创建草稿...');
    var draftData = {
      articles: [{
        title: item.title || '未命名文章',
        content: htmlContent,
        digest: (body.replace(/[#*`\n]/g, ' ').trim()).substring(0, 120),
        author: item.author || '',
        content_source_url: '',
        need_open_comment: 0,
        only_fans_can_comment: 0
      }]
    };

    if (thumbMediaId) {
      draftData.articles[0].thumb_media_id = thumbMediaId;
    }

    var draftUrl = 'https://api.weixin.qq.com/cgi-bin/draft/add?access_token=' + token;
    var draftRes = await httpRequest(draftUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify(draftData));

    if (draftRes.media_id) {
      log('草稿创建成功! media_id: ' + draftRes.media_id);
      return { success: true, message: '公众号草稿创建成功，media_id: ' + draftRes.media_id, logs: logs };
    } else {
      log('草稿创建失败: ' + (draftRes.errmsg || JSON.stringify(draftRes)));
      return { success: false, error: '草稿创建失败: ' + (draftRes.errmsg || JSON.stringify(draftRes)), logs: logs };
    }

  } catch (e) {
    log('同步异常: ' + e.message);
    return { success: false, error: e.message, logs: logs };
  }
}

main();