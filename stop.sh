#!/bin/bash

# 奴隶兽团队停止脚本

echo "🔍 正在停止服务..."

# 查找进程并发送SIGTERM
pids=$(ps aux | grep -E "node.*server|node.*agent" | grep -v grep | awk '{print $2}')

if [ -z "$pids" ]; then
  echo "✅ 没有发现运行中的服务"
  exit 0
fi

echo "🛑 正在停止进程: $pids"

# 优雅停止
for pid in $pids; do
  kill -15 $pid 2>/dev/null
done

sleep 2

# 检查是否还在运行
remaining=$(ps aux | grep -E "node.*server|node.*agent" | grep -v grep | awk '{print $2}')
if [ -n "$remaining" ]; then
  echo "⚠️  强制停止剩余进程..."
  for pid in $remaining; do
    kill -9 $pid 2>/dev/null
  done
fi

echo "✅ 服务已停止"
