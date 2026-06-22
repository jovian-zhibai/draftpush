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

// Native Messaging 协议：消息以 4 字节长度前缀 + JSON 传输
function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(json.length, 0);
  process.stdout.write(buf);
  process.stdout.write(json);
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
      } catch {}
    }
  });
}

function scanPending(pendingDir) {
  const items = [];
  if (!fs.existsSync(pendingDir)) return items;

  const folders = fs.readdirSync(pendingDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const folder of folders) {
    const contentFile = path.join(pendingDir, folder.name, 'content.json');
    if (fs.existsSync(contentFile)) {
      try {
        const content = JSON.parse(fs.readFileSync(contentFile, 'utf-8'));
        items.push({
          ...content,
          folder: folder.name,
          folder_path: path.join(pendingDir, folder.name),
        });
      } catch {}
    }
  }

  return items;
}

function archiveFolder(pendingDir, archivedDir, folderName) {
  const src = path.join(pendingDir, folderName);
  const dst = path.join(archivedDir, folderName);

  if (!fs.existsSync(src)) return false;

  // 写同步日志
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
  const config = loadConfig();
  const watchDir = config.watch_dir || DEFAULT_WATCH_DIR;
  const { pending, archived } = ensureDirs(watchDir);

  // 处理来自插件的消息
  readMessage((msg) => {
    if (msg.type === 'list_pending') {
      const items = scanPending(pending);
      sendMessage({ type: 'content_list', payload: items });
    }

    if (msg.type === 'archive') {
      const ok = archiveFolder(pending, archived, msg.payload.folder);
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
      const configDir = path.dirname(configPath);
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      sendMessage({ type: 'config_saved', payload: config });
    }
  });

  // 监听目录变化
  let debounceTimer = null;

  try {
    fs.watch(pending, { recursive: true }, (_event, _filename) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const items = scanPending(pending);
        sendMessage({ type: 'content_list', payload: items });
      }, 500);
    });
  } catch {}
}

main();