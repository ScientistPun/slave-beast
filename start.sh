#!/bin/bash

# 奴隶兽团队一键后台启动脚本

echo "🔍 正在停止现有Agent进程..."
pkill -f "node.*agent" > /dev/null 2>&1
sleep 1

echo "🚀 正在后台启动所有Agent..."
nohup node agent-startup.js all > /dev/null 2>&1 &

echo ""
echo "✅ 启动完成！所有Agent已在后台运行"
echo ""
echo "📋 常用命令："
echo "  查看PM日志: tail -f logs/pm.log"
echo "  查看所有日志: ls -la logs/"
echo "  停止所有Agent: pkill -f 'node.*agent'"
echo "  查看进程: ps aux | grep node.*agent"