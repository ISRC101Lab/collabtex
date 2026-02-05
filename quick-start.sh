#!/bin/bash
# 快速检查和启动脚本

clear
echo "════════════════════════════════════════════════"
echo "  CollabTeX 自动登录版本 - 快速启动"
echo "════════════════════════════════════════════════"
echo ""

# 检查服务器状态
if pgrep -f "node.*server/index.js" > /dev/null; then
    PID=$(pgrep -f "node.*server/index.js" | head -1)
    echo "✓ 服务器正在运行 (PID: $PID)"
    echo ""
    echo "访问地址:"
    echo "  🌐 http://localhost:4092"
    echo ""
    echo "测试页面:"
    echo "  🧪 http://localhost:4092/test-login.html"
    echo ""
    echo "特性:"
    echo "  ✓ 自动登录 (无需输入用户名密码)"
    echo "  ✓ 深色主题"
    echo "  ✓ 现代化UI"
    echo ""
    echo "如果浏览器显示旧版本，请按 Ctrl+Shift+R 强制刷新"
    echo ""
else
    echo "✗ 服务器未运行"
    echo ""
    read -p "是否现在启动服务器? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "正在启动服务器..."
        ./run.sh
    fi
fi

echo "════════════════════════════════════════════════"
