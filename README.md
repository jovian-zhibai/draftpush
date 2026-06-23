# 草稿推送 DraftPush

> AI Skill 写完内容，一键同步到小红书、公众号、抖音草稿箱

轻量 Chrome 扩展，连接终端 AI Skill 和内容平台草稿箱。Skill 写完内容后自动出现在插件面板中，勾选目标平台，一键同步。支持失败自动重试和定时发布。

**注意：在 Dia 浏览器中使用时**，需要对小红书/抖音创作者页面关闭内容拦截（Site Menu > Block Ads & Trackers 取消勾选），否则图片 CDN 上传会被拦截。Chrome 无此问题。

## 快速开始

### 1. 安装扩展

Chrome 打开 `chrome://extensions`，开启开发者模式，点「加载已解压的扩展程序」，选择 `extension/` 目录。

### 2. 安装 Native Host

```bash
# macOS
cd installer && bash install-mac.sh

# Linux
cd installer && bash install-linux.sh

# Windows
cd installer && install-windows.bat
```

安装脚本会：
- 复制 host 程序到系统目录
- 注册 Native Messaging Host
- 创建默认目录 `~/.draftpush/outbox/待同步/` 和 `已同步/`

### 3. 测试

在 `~/.draftpush/outbox/待同步/` 下创建测试内容：

```bash
mkdir -p ~/.draftpush/outbox/待同步/2026-06-23-测试笔记
cat > ~/.draftpush/outbox/待同步/2026-06-23-测试笔记/content.json << 'EOF'
{
  "title": "测试笔记",
  "body": "这是一篇测试笔记\n\n正文内容在这里。",
  "tags": ["测试", "草稿推送"],
  "platforms": ["xiaohongshu"],
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
| 抖音 | DOM 自动化（浏览器登录） | ✅ 已实现 |

### 小红书

通过 Chrome 创作者页面 DOM 自动化完成。需要先在 Chrome 中登录小红书创作者中心。

### 微信公众号

通过官方 API 完成，无需浏览器操作。在设置页配置 AppID 和 AppSecret，并在公众号后台将你的 IP 加入白名单。

### 抖音

通过 Chrome 创作者页面 DOM 自动化完成。需要先在 Chrome 中登录抖音创作者中心。

## 功能特性

- **一键同步** — 勾选平台，点击同步
- **内容预览** — 点击标题预览格式化后的内容
- **失败重试** — 同步失败自动重试 2 次，间隔递增
- **定时发布** — 设置未来时间，到点自动同步
- **桌面通知** — 同步成功/失败桌面提醒
- **多格式支持** — content.json / meta.json + .md / frontmatter .md

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
├── extension/              <- Chrome 扩展
│   ├── manifest.json
│   ├── popup/              <- 面板 UI（内容列表、预览、定时）
│   ├── background/         <- Service Worker（同步调度、重试、定时）
│   ├── content-scripts/    <- 页面注入脚本
│   │   ├── xiaohongshu.js  <- 小红书编辑器操作
│   │   └── douyin.js       <- 抖音编辑器操作
│   └── options/            <- 设置页
├── native-host/            <- Native Messaging Host（文件读取 + 公众号 API）
├── installer/              <- 安装脚本（macOS / Linux / Windows）
├── shared/                 <- 内容格式规范
├── CONTRIBUTING.md         <- 添加新平台指南
└── README.md
```

## 添加新平台

参见 [CONTRIBUTING.md](CONTRIBUTING.md)，包含完整的 adapter 开发指南和代码模板。

## 开发状态

- [x] Phase 1: Chrome 扩展 + Native Host + 小红书 + 公众号
- [x] Phase 2: 抖音 adapter + 内容预览 + 格式转换
- [x] Phase 3: Adapter 注册机制 + 开发文档
- [x] Phase 4: 失败重试 + 定时发布 + 通知 + 跨平台安装
- [ ] 下一步: Chrome Web Store 上架 + 更多平台

## License

MIT
