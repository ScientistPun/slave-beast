#!/bin/bash

# 奴隶兽团队启动脚本

echo "🔍 正在停止现有进程..."
pkill -f "node.*agent" > /dev/null 2>&1
pkill -f "node.*server" > /dev/null 2>&1
sleep 1

echo "🚀 启动 Redis 服务..."
service redis-server start || redis-server --daemonize yes
sleep 1

mkdir -p logs

echo "🚀 正在启动Server..."
nohup node server.js > logs/server.log 2>&1 &
sleep 2

echo "🚀 正在启动所有Agent..."
nohup node agent-startup.js all > /dev/null 2>&1 &

echo ""
echo "✅ 启动完成！"
echo ""
echo "📋 常用命令："
echo "  查看Server日志: tail -f logs/server.log"
echo "  查看Agent日志: tail -f logs/pm.log"
echo "  停止服务: ./stop.sh"
echo "  查看进程: ps aux | grep node"

# 等待所有后台进程，防止容器退出
wait
