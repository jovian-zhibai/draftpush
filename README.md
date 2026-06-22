# 草稿推送 DraftPush

> AI Skill 写完内容，一键同步到小红书、公众号、抖音草稿箱

轻量浏览器插件，连接终端 AI Skill 和内容平台草稿箱。Skill 写完内容后自动出现在插件面板中，用户勾选目标平台，确认后一键同步。

## 快速开始

### 1. 安装扩展

开发阶段：Chrome 打开 `chrome://extensions`，开启开发者模式，点「加载已解压的扩展程序」，选择 `extension/` 目录。

### 2. 安装 Native Host

```bash
cd installer
bash install-mac.sh
```

安装脚本会：
- 复制 host 程序到 `/usr/local/lib/draftpush/`
- 注册 Native Messaging Host manifest
- 创建默认目录 `~/.draftpush/outbox/待同步/` 和 `已同步/`

### 3. 测试

在 `~/.draftpush/outbox/待同步/` 下创建一个测试内容：

```bash
mkdir -p ~/.draftpush/outbox/待同步/2026-06-22-测试笔记
cat > ~/.draftpush/outbox/待同步/2026-06-22-测试笔记/content.json << 'EOF'
{
  "title": "测试笔记",
  "body": "这是一篇测试笔记 🎉\n\n## 小标题\n\n正文内容在这里。",
  "tags": ["测试", "草稿推送"],
  "platforms": ["xiaohongshu"],
  "created_at": "2026-06-22T19:00:00+08:00",
  "source_skill": "manual-test",
  "status": "pending"
}
EOF
```

点击浏览器右上角草稿推送图标，应该能看到这篇内容。

## 对接 Skill

Skill 写完内容后，输出标准格式的 content.json 到监听目录即可：

```
~/.draftpush/outbox/待同步/{日期-标题}/
├── content.json
└── images/
    ├── cover.png
    └── img-01.png
```

content.json 格式见 `shared/content-schema.json`。

## 项目结构

```
draftpush/
├── extension/           ← Chrome 扩展
│   ├── manifest.json
│   ├── popup/           ← 面板 UI
│   ├── background/      ← Service Worker
│   ├── adapters/        ← 平台 adapter（可插拔）
│   ├── content-scripts/ ← 页面注入脚本
│   ├── lib/             ← 工具库
│   └── options/         ← 设置页
├── native-host/         ← Native Messaging Host
├── installer/           ← 安装脚本
└── shared/              ← 公共规范
```

## 开发状态

- [x] Phase 1: Chrome 扩展骨架 + Native Host + 小红书 adapter
- [ ] Phase 2: 公众号（API 通道）+ 抖音 + 格式转换器
- [ ] Phase 3: 平台市场
- [ ] Phase 4: 定时推送 + 体验打磨

## License

MIT