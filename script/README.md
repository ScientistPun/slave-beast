# CEO 聊天室

与CEO Agent（执行总监）的WebSocket实时聊天室。

## 功能特性

- 实时WebSocket通信
- 聊天内容自动存入Redis
- 支持加载历史记录
- 支持多会话（通过sessionId区分）
- CEO角色配置来自`/agents/ceo.md`

## 快速开始

### 1. 配置环境变量

编辑 `.env` 文件，填入你的Anthropic API Key：

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### 2. 确保Redis运行中

```bash
# macOS
brew services start redis

# Ubuntu/Debian
sudo systemctl start redis

# 或直接运行
redis-server
```

### 3. 启动服务器

```bash
npm start
```

### 4. 打开浏览器

访问 http://localhost:3000

## API 接口

### WebSocket消息格式

**发送消息：**
```json
{
  "type": "chat",
  "content": "你好，CEO！",
  "sessionId": "user_abc123"
}
```

**获取历史：**
```json
{
  "type": "history",
  "sessionId": "user_abc123"
}
```

**清空对话：**
```json
{
  "type": "clear",
  "sessionId": "user_abc123"
}
```

## Redis数据结构

- Key: `ceo_chat:history:{sessionId}`
- Type: List（最新消息在前面）
- TTL: 24小时自动过期

```bash
# 查看所有会话
KEYS ceo_chat:*

# 查看某会话历史
LRANGE ceo_chat:history:user_abc123 0 -1

# JSON格式化查看
LRANGE ceo_chat:history:user_abc123 0 -1 | jq -r '.[]'
```

## 项目结构

```
ceo-chat/
├── server.js          # 主服务器
├── public/
│   └── index.html     # 前端页面
├── .env               # 环境变量
└── package.json
```
