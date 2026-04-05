#!/bin/bash
# setup.sh
# 自动安装：Claude Code + cc-switch
# 适用于 Debian / Ubuntu 容器环境（基础依赖已在Dockerfile中安装）

set -e

echo "🔧 开始安装 Claude Code + cc-switch..."

# ---------- 1. 安装 Claude Code ----------
echo "⬇️ 安装 Claude Code CLI..."
curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh
chmod +x /tmp/claude-install.sh
bash /tmp/claude-install.sh

# ---------- 2. 安装 cc-switch ----------
echo "⬇️ 安装 cc-switch..."
curl -fsSL https://github.com/SaladDay/cc-switch-cli/releases/latest/download/install.sh | bash

# ---------- 3. 配置 PATH 环境变量 ----------
echo "🔧 配置环境变量 PATH..."

CLAUDE_PATH="$HOME/.local/bin"
CC_SWITCH_PATH="$HOME/.cc-switch/bin"

# 写入 PATH 到 ~/.bashrc
{
  echo ""
  echo "# === Added by Claude Agent Installer ==="
  echo "export PATH=\"$CLAUDE_PATH:\$PATH\""
  echo "export PATH=\"$CC_SWITCH_PATH:\$PATH\""
  echo "export PATH=\"\$HOME/.local/bin:\$PATH\""
} >> ~/.bashrc

# 确保当前会话 PATH 生效
export PATH="$CLAUDE_PATH:$CC_SWITCH_PATH:$HOME/.local/bin:$PATH"

# ---------- 4. 验证安装 ----------
echo "✅ 验证工具是否安装成功..."

which claude >/dev/null && echo "✔ Claude Code: $(claude -v 2>/dev/null || echo '版本信息获取异常')" || echo "❌ claude 未找到"
which cc-switch >/dev/null && echo "✔ cc-switch: $(cc-switch --version 2>/dev/null || echo '版本信息获取异常')" || echo "❌ cc-switch 未找到"

echo "🎉 Claude + cc-switch 安装完成！"

# ---------- 5. 启动 Redis ----------
echo "🚀 启动 Redis 服务..."
service redis-server start