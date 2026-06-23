@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set HOST_NAME=com.draftpush.host

echo ============================================
echo   草稿推送 DraftPush - 安装 Native Host
echo   (Windows)
echo ============================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo 错误: 未找到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('where node') do set NODE_PATH=%%i
echo ✓ Node.js: %NODE_PATH%

:: 设置安装目录
set HOST_DIR=%LOCALAPPDATA%\DraftPush
set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..

:: 复制 host 文件
echo → 安装 host 到 %HOST_DIR% ...
if not exist "%HOST_DIR%" mkdir "%HOST_DIR%"
copy /Y "%PROJECT_DIR%\native-host\host.js" "%HOST_DIR%\host.js" >nul
echo ✓ Host 已复制

:: 创建启动脚本
(
echo @echo off
echo "%NODE_PATH%" "%HOST_DIR%\host.js"
) > "%HOST_DIR%\launcher.bat"
echo ✓ 启动脚本已创建

:: 获取 Extension ID
echo.
set /p EXT_ID="请输入 Chrome 扩展 ID（在 chrome://extensions 中查看）: "

if "%EXT_ID%"=="" (
    echo 错误: 扩展 ID 不能为空
    pause
    exit /b 1
)

:: 注册 Native Messaging Host（通过注册表）
set REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%
set MANIFEST_PATH=%HOST_DIR%\%HOST_NAME%.json

:: 写 manifest 文件
(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "草稿推送 DraftPush Native Messaging Host",
echo   "path": "%HOST_DIR:\=\\%\\launcher.bat",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

:: 写注册表
reg add "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul
echo ✓ 已注册到 Chrome: %REG_KEY%

:: 创建默认目录
set DEFAULT_DIR=%USERPROFILE%\.draftpush\outbox
if not exist "%DEFAULT_DIR%\待同步" mkdir "%DEFAULT_DIR%\待同步"
if not exist "%DEFAULT_DIR%\已同步" mkdir "%DEFAULT_DIR%\已同步"
echo ✓ 默认目录: %DEFAULT_DIR%

:: 创建默认配置
set CONFIG=%USERPROFILE%\.draftpush\config.json
if not exist "%CONFIG%" (
    (
    echo {
    echo   "watch_dir": "%DEFAULT_DIR:\=/%"
    echo }
    ) > "%CONFIG%"
    echo ✓ 配置文件: %CONFIG%
)

echo.
echo ============================================
echo   安装完成！
echo ============================================
echo.
echo 现在可以：
echo 1. 刷新 Chrome 扩展页面
echo 2. 点击草稿推送图标，确认 Host 已连接
echo 3. 把内容放到 %DEFAULT_DIR%\待同步\ 试试
echo.
pause
