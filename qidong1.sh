# 设置 Base URL
export ANTHROPIC_BASE_URL=https://code.usezyla.com
# ===========================================

# 强制重置 NODE_OPTIONS，防止 fetch 未定义的错误
unset NODE_OPTIONS

# 直接设置密钥，不再每次询问
user_token="sk-d40093f1_13a5406b2519a0e1b8419702"

# 使用 ANTHROPIC_AUTH_TOKEN (对应 Zyla 平台的 Authorization: Bearer ...)
export ANTHROPIC_AUTH_TOKEN=$user_token
export ANTHROPIC_API_KEY=$user_token


# 获取运行目标 (默认为 codex)
case "$1" in
    "claude")
        target="claude"
        shift
        ;;
    "codex"|"openai")
        target="codex"
        shift
        ;;
    -*)
        # 如果第一个参数是选项 (如 --version), 默认使用 codex
        target="codex"
        ;;
    "")
        target="codex"
        ;;
    *)
        # 默认使用 codex，但不 shift (第一个参数可能是传给 codex 的 prompt)
        target="codex"
        ;;
esac



case "$target" in
    "claude")
        if command -v claude &> /dev/null; then
            exec claude "$@"
        else
            echo "错误: 未找到 claude 命令。"
            echo "请运行: npm install -g @anthropic-ai/claude-code"
            exit 127
        fi
        ;;
    "codex"|"openai")
        if command -v codex &> /dev/null; then
            exec codex "$@"
        else
            echo "错误: 未找到 codex 命令。"
            echo "请运行: npm install -g @openai/codex"
            exit 127
        fi
        ;;
    *)
        echo "未知目标: $target"
        echo "用法: $0 [claude|codex|openai] [参数...]"
        exit 1
        ;;
esac