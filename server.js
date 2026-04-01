import { WebSocketServer } from 'ws';
import { createClient } from 'redis';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载CEO agent配置
const ceoConfig = readFileSync(join(__dirname, '/agents/ceo.md'), 'utf-8');

// 初始化Anthropic客户端
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
});

// Redis客户端
const redis = createClient({
  url: `redis://${process.env.REDIS_PASSWORD ? ':' + process.env.REDIS_PASSWORD + '@' : ''}${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
});

redis.on('error', (err) => console.log('Redis Client Error', err));

const WEB_PORT = parseInt(process.env.PORT) || 3100

// WebSocket服务器
const wss = new WebSocketServer({ port: WEB_PORT });

// 聊天记录存储在Redis的Key前缀
const CHATROOM_KEY = 'slaves:chatroom:';
const SESSION_KEY = 'slaves:chatroom_session:';

// 存储所有连接的客户端
const clients = new Set();

// 广播消息给所有客户端
function broadcast(data, exclude = null) {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client !== exclude && client.readyState === 1) {
      client.send(message);
    }
  });
}

// 初始化
async function init() {
  await redis.connect();
  console.log('已连接Redis');
  console.log('包工头洽谈室已启动，监听端口 ' + WEB_PORT);
}

// 处理WebSocket消息
async function handleMessage(ws, message) {
  console.log('[WS收到消息]:', message.toString());
  try {
    const data = JSON.parse(message);
    const { type, content, sessionId, messageId } = data;

    if (type === 'chat') {
      console.log('[收到老细信息]:', content);
      const userId = 'boss';
      const timestamp = new Date().toISOString();

      // 1. 保存用户消息到Redis
      await saveMessage(userId, {
        role: 'user',
        content,
        timestamp,
      });

      // 1.5 广播用户消息给所有其他客户端（包括发送者用于去重）
      broadcast({
        type: 'user_message',
        content,
        timestamp,
        userId,
        messageId,  // 用于客户端去重
      });

      // 2. 获取聊天历史
      const history = await getChatHistory(userId);
      console.log('[历史消息数]:', history.length);

      // 3. 调用Claude API
      console.log('[开始调用Claude API]');
      const response = await getClaudeResponse(history, content);
      console.log('[Claude返回]:', response);

      // 4. 保存CEO回复到Redis
      await saveMessage(userId, {
        role: 'agent_ceo',
        content: response,
        timestamp: new Date().toISOString(),
      });

      // 5. 打印CEO回复
      console.log(`[包工头回复] ${response}`);

      // 5. 广播CEO回复给所有客户端
      broadcast({
        type: 'response',
        content: response,
        timestamp: new Date().toISOString(),
      });
    }

    if (type === 'history') {
      const userId = 'boss';
      const history = await getChatHistory(userId);
      ws.send(JSON.stringify({
        type: 'history',
        messages: history,
      }));
    }

    if (type === 'clear') {
      const userId = 'boss';
      await clearHistory(userId);
      ws.send(JSON.stringify({
        type: 'clear',
        success: true,
      }));
    }

  } catch (error) {
    console.error('处理消息错误:', error);
    ws.send(JSON.stringify({
      type: 'error',
      content: '处理消息时出错: ' + error.message,
    }));
  }
}

// 获取Claude回复 (Messages API)
async function getClaudeResponse(history, newMessage) {
  const agentMessages = [];

  // 添加系统提示（CEO的角色设定）
  agentMessages.push({
    role: 'system',
    content: ceoConfig
  });

  // 添加历史消息
  for (const msg of history) {
    // API 只接受 user/assistant/system，将 agent_ceo 转为 assistant
    let role = msg.role;
    if (role === 'agent_ceo') role = 'assistant';
    agentMessages.push({
      role: role,
      content: msg.content
    });
  }

  // 添加新消息
  agentMessages.push({
    role: 'user',
    content: newMessage
  });

  console.log('[DEBUG] 模型:', process.env.ANTHROPIC_MODEL);
  console.log('[DEBUG] API URL:', anthropic.baseURL);
  console.log('[DEBUG] 发送消息数:', agentMessages.length);

  try {
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      messages: agentMessages,
    });

    console.log('[DEBUG] API响应:', JSON.stringify(response).substring(0, 500));

    // 提取文本内容（兼容MiniMax的thinking类型）
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        text = block.text;
        break;
      }
    }

    return text || '处理中...';
  } catch (error) {
    console.error('Claude API错误:', error.message);
    return '有咩请留言，我阵间复你';
  }
}

// 保存消息到Redis
async function saveMessage(userId, message) {
  const key = CHATROOM_KEY + userId;
  try {
    await redis.lPush(key, JSON.stringify(message));
    // 保留最近100条消息
    await redis.lTrim(key, 0, 99);
    // 设置24小时过期时间
    await redis.expire(key, 86400);
  } catch (err) {
    console.error('保存消息失败:', err);
  }
}

// 获取聊天历史
async function getChatHistory(userId) {
  const key = CHATROOM_KEY + userId;
  try {
    const messages = await redis.lRange(key, 0, -1);
    if (!Array.isArray(messages)) {
      console.log('Redis返回非数组:', messages);
      return [];
    }
    // 按时间戳从旧到新排序
    const parsed = messages.map(m => JSON.parse(m));
    return parsed.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (err) {
    console.error('获取历史失败:', err);
    return [];
  }
}

// 清除历史
async function clearHistory(userId) {
  const key = CHATROOM_KEY + userId;
  await redis.del(key);
}

// WebSocket连接处理
wss.on('connection', (ws) => {
  console.log('新客户端连接');

  clients.add(ws);

  // 广播新用户上线通知
  broadcast({
    type: 'online',
    name: '包工头',
    timestamp: new Date().toISOString(),
  });

  ws.on('message', (message) => {
    handleMessage(ws, message.toString());
  });

  ws.on('close', () => {
    console.log('客户端断开连接');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket错误:', error);
    clients.delete(ws);
  });
});

// 启动服务器
init().catch(console.error);

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n正在关闭...');
  await redis.quit();
  wss.close();
  process.exit(0);
});
