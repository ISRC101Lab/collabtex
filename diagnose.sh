#!/bin/bash
# CollabTeX 诊断和修复脚本

echo "=== CollabTeX 诊断 ==="
echo ""

# 1. 检查服务器状态
echo "1. 检查服务器状态..."
if pgrep -f "node.*server/index.js" > /dev/null; then
    echo "   ✓ 服务器正在运行"
    PID=$(pgrep -f "node.*server/index.js" | head -1)
    echo "   进程ID: $PID"
else
    echo "   ✗ 服务器未运行"
    exit 1
fi

# 2. 检查端口
echo ""
echo "2. 检查端口..."
if netstat -tlnp 2>/dev/null | grep -q ":4092" || ss -tlnp 2>/dev/null | grep -q ":4092"; then
    echo "   ✓ 端口 4092 正在监听"
else
    echo "   ✗ 端口 4092 未监听"
fi

# 3. 测试登录API
echo ""
echo "3. 测试登录 API..."
RESPONSE=$(curl -s -X POST http://localhost:4092/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}')

if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo "   ✓ 登录 API 工作正常"
    echo "   响应: $RESPONSE"
else
    echo "   ✗ 登录失败"
    echo "   响应: $RESPONSE"
fi

# 4. 检查构建文件
echo ""
echo "4. 检查构建文件..."
if [ -f "public/bundle.js" ] && [ -f "public/style.css" ]; then
    echo "   ✓ 构建文件存在"
    echo "   bundle.js: $(ls -lh public/bundle.js | awk '{print $5, $6, $7, $8}')"
    echo "   style.css: $(ls -lh public/style.css | awk '{print $5, $6, $7, $8}')"
else
    echo "   ✗ 构建文件缺失"
fi

# 5. 检查用户数据库
echo ""
echo "5. 检查用户数据库..."
if [ -f "collabtex-data/users.json" ]; then
    echo "   ✓ 用户数据库存在"
    USERS=$(grep -o '"username":"[^"]*"' collabtex-data/users.json | cut -d'"' -f4 | tr '\n' ', ')
    echo "   用户: $USERS"
else
    echo "   ✗ 用户数据库不存在"
fi

# 6. 提供解决方案
echo ""
echo "=== 解决方案 ==="
echo ""
echo "如果浏览器显示'加载中...'或登录不进去，请尝试:"
echo ""
echo "1. 强制刷新浏览器（清除缓存）:"
echo "   - Chrome/Edge: Ctrl+Shift+R (Linux/Win) 或 Cmd+Shift+R (Mac)"
echo "   - Firefox: Ctrl+F5 (Linux/Win) 或 Cmd+Shift+R (Mac)"
echo ""
echo "2. 清除浏览器缓存和 Cookie:"
echo "   - 打开浏览器开发者工具 (F12)"
echo "   - 右键点击刷新按钮，选择'清空缓存并硬性重新加载'"
echo ""
echo "3. 使用无痕/隐私模式打开:"
echo "   - Chrome: Ctrl+Shift+N"
echo "   - Firefox: Ctrl+Shift+P"
echo ""
echo "4. 或者直接使用 curl 测试:"
echo "   curl -X POST http://localhost:4092/api/login \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"username\":\"admin\",\"password\":\"admin\"}'"
echo ""
echo "登录信息:"
echo "  URL: http://localhost:4092"
echo "  用户名: admin"
echo "  密码: admin"
echo ""
