# 草稿推送 DraftPush

> AI Skill 写完内容，一键同步到小红书、公众号、抖音草稿箱

轻量 Chrome 扩展，连接终端 AI Skill 和内容平台草稿箱。Skill 写完内容后自动出现在插件面板中，勾选目标平台，一键同步。

**注意：小红书同步必须使用 Chrome 浏览器**（Dia 浏览器的内容拦截器会阻止图片 CDN 上传）。公众号同步通过 API 完成，不受浏览器限制。

## 快速开始

### 1. 安装扩展

Chrome 打开 `chrome://extensions`，开启开发者模式，点「加载已解压的扩展程序」，选择 `extension/` 目录。

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

在 `~/.draftpush/outbox/待同步/` 下创建测试内容：

```bash
mkdir -p ~/.draftpush/outbox/待同步/2026-06-22-测试笔记
cat > ~/.draftpush/outbox/待同步/2026-06-22-测试笔记/content.json << 'EOF'
{
  "title": "测试笔记",
  "body": "这是一篇测试笔记\n\n## 小标题\n\n正文内容在这里。",
  "tags": ["测试", "草稿推送"],
  "platforms": ["xiaohongshu"],
  "created_at": "2026-06-22T19:00:00+08:00",
  "source_skill": "manual-test",
  "status": "pending"
}
EOF
```

点击浏览器右上角草稿推送图标，应该能看到这篇内容。

## 平台支持

| 平台 | 方式 | 状态 |
|------|------|------|
| 小红书 | DOM 自动化（浏览器登录） | ✅ 已实现 |
| 微信公众号 | API 接口（AppID + AppSecret） | ✅ 已实现 |
| 抖音 | 待开发 | 🔜 计划中 |

### 小红书

通过 Chrome 创作者页面 DOM 自动化完成：上传图片 → 填入标题正文 → 存草稿。需要先在 Chrome 中登录小红书创作者中心。

### 微信公众号

通过官方 API 完成，无需浏览器操作。在设置页配置 AppID 和 AppSecret，并在公众号后台将你的 IP 加入白名单。

## 对接 Skill

Skill 写完内容后，输出到监听目录即可。支持三种格式：

**格式 1：content.json**
```
待同步/{日期-标题}/
├── content.json
└── cover.png
```

**格式 2：meta.json + .md**
```
待同步/{日期-标题}/
├── xhs-meta.json
├── content.md
└── cover.png
```

**格式 3：带 frontmatter 的 .md**
```
待同步/{日期-标题}/
├── content.md    (含 YAML frontmatter)
└── cover.png
```

content.json 格式见 `shared/content-schema.json`。

## 项目结构

```
draftpush/
├── extension/           <- Chrome 扩展
│   ├── manifest.json
│   ├── popup/           <- 面板 UI
│   ├── background/      <- Service Worker（同步调度）
│   ├── content-scripts/  <- 页面注入脚本（小红书编辑器操作）
│   └── options/         <- 设置页
├── native-host/         <- Native Messaging Host（文件读取 + 公众号 API）
├── installer/           <- macOS 安装脚本
└── shared/              <- 内容格式规范
```

## 开发状态

- [x] Phase 1: Chrome 扩展 + Native Host + 小红书 DOM 自动化 + 公众号 API
- [ ] Phase 2: 抖音 adapter + 格式转换器 + 内容预览
- [ ] Phase 3: 平台市场（社区贡献 adapter）
- [ ] Phase 4: 定时推送 + Windows/Linux + Chrome Web Store

## License

MIT
