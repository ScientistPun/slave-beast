#!/bin/bash

# 奴隶兽团队一键停止脚本

echo "🔍 正在查找所有Agent进程..."
pids=$(pgrep -f "node.*agent")

if [ -z "$pids" ]; then
  echo "ℹ️  没有发现正在运行的Agent进程"
  exit 0
fi

echo "🛑 正在停止以下Agent进程："
echo "$pids"

pkill -f "node.*agent" > /dev/null 2>&1
sleep 1

# 验证是否停止
remaining=$(pgrep -f "node.*agent")
if [ -z "$remaining" ]; then
  echo "✅ 所有Agent进程已成功停止"
else
  echo "⚠️  以下进程未能停止，需要手动kill："
  echo "$remaining"
  exit 1
fi