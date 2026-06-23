#!/bin/bash
set -e

HOST_NAME="com.draftpush.host"
HOST_DIR="/usr/local/lib/draftpush"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "  草稿推送 DraftPush - 安装 Native Host"
echo "  (Linux)"
echo "============================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请先安装 Node.js"
    echo "下载地址: https://nodejs.org/"
    exit 1
fi

NODE_PATH=$(which node)
echo "✓ Node.js: $NODE_PATH"

# 复制 host 文件
echo "→ 安装 host 到 $HOST_DIR ..."
sudo mkdir -p "$HOST_DIR"
sudo cp "$PROJECT_DIR/native-host/host.js" "$HOST_DIR/host.js"
sudo chmod +x "$HOST_DIR/host.js"

# 创建启动脚本
LAUNCHER="$HOST_DIR/launcher.sh"
sudo tee "$LAUNCHER" > /dev/null << EOF
#!/bin/bash
exec "$NODE_PATH" "$HOST_DIR/host.js"
EOF
sudo chmod +x "$LAUNCHER"

# 获取 Extension ID
echo ""
read -p "请输入 Chrome 扩展 ID（在 chrome://extensions 中查看）: " EXT_ID

if [ -z "$EXT_ID" ]; then
    echo "错误: 扩展 ID 不能为空"
    exit 1
fi

# 检测浏览器并注册
CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"

register_host() {
    local dir="$1"
    local name="$2"
    mkdir -p "$dir"
    cat > "$dir/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "草稿推送 DraftPush Native Messaging Host",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF
    echo "✓ 已注册到 $name: $dir/$HOST_NAME.json"
}

if [ -d "$HOME/.config/google-chrome" ]; then
    register_host "$CHROME_DIR" "Chrome"
fi

if [ -d "$HOME/.config/chromium" ]; then
    register_host "$CHROMIUM_DIR" "Chromium"
fi

if [ ! -d "$HOME/.config/google-chrome" ] && [ ! -d "$HOME/.config/chromium" ]; then
    register_host "$CHROME_DIR" "Chrome"
fi

# 创建默认目录
DEFAULT_DIR="$HOME/.draftpush/outbox"
mkdir -p "$DEFAULT_DIR/待同步"
mkdir -p "$DEFAULT_DIR/已同步"
echo "✓ 默认目录: $DEFAULT_DIR"

# 创建默认配置
CONFIG="$HOME/.draftpush/config.json"
if [ ! -f "$CONFIG" ]; then
    cat > "$CONFIG" << EOF
{
  "watch_dir": "$DEFAULT_DIR"
}
EOF
    echo "✓ 配置文件: $CONFIG"
fi

echo ""
echo "============================================"
echo "  安装完成！"
echo "============================================"
echo ""
echo "现在可以："
echo "1. 刷新 Chrome 扩展页面"
echo "2. 点击草稿推送图标，确认 Host 已连接"
echo "3. 把内容放到 $DEFAULT_DIR/待同步/ 试试"
echo ""
