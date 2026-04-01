# Slave Beast - 多 Agent 协作聊天室

一个基于 WebSocket 的多 Agent 协作系统，用户可以通过自然语言与 CEO Agent 交互，CEO 会协调其他 Agent（如 COO、CSO 等）完成复杂任务。

## 功能特性

- 实时聊天 - WebSocket 双向通信
- 多 Agent 协作 - CEO 可 @ 其他 Agent 分发任务
- 历史记录 - Redis 存储聊天历史
- 简洁界面 - Telegram 风格消息气泡

## 快速开始

### 1. 安装依赖

```bash
cd script
npm install
```

### 2. 配置环境

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
ANTHROPIC_API_KEY=your_api_key
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_MODEL=M2.7-highspeed
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
PORT=3000
```

### 3. 启动服务

```bash
# 启动 WebSocket 服务器
npm start

# 启动 Web 前端（可选，另一个终端）
npm run web
```

### 4. 访问

打开浏览器访问 http://localhost:8080

## Agent 列表

| Agent | 角色 | 说明 |
|-------|------|------|
| CEO | 包工头 | 协调者，接收用户任务并分发 |
| COO | 运营 | 运营相关任务 |
| CSO | 战略 | 战略规划相关 |
| CRO | 首席风险官 | 风险评估 |
| CTO | 技术 | 技术决策 |
| HFD | ?? | 待定义 |
| QPD | ?? | 待定义 |
| TD | ?? | 待定义 |

## 使用方式

1. 直接发送消息给 CEO
2. 使用 `@agent` 指令指定特定 Agent 处理任务
3. CEO 会协调多个 Agent 协作完成复杂任务

## 技术栈

- **后端**: Node.js, WebSocket (ws), Redis
- **前端**: 原生 HTML/CSS/JS
- **AI**: Claude API (MiniMax 兼容)
