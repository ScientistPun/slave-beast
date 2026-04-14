/**
 * slave-beasts 核心服务
 * WebSocket 服务 + 消息广播 + Redis 聊天记录 + 任务看板实时推送 + Agent 在线状态
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;
const redis = require('./utils/redis');
const createLogger = require('./utils/logger');

const PORT = process.env.PORT || 3000;
const BOARD_PUSH_INTERVAL = 1000; // 每秒推送看板数据

// 文件管理目录（使用 workspace 目录）
const FILE_DIR = path.join(__dirname, 'workspace');
if (!fs.existsSync(FILE_DIR)) {
  fs.mkdirSync(FILE_DIR, { recursive: true });
}

// 日志
const logger = createLogger('server');

// Agent 列表
const AGENTS = ['ceo', 'cto', 'cro', 'coo', 'pm', 'qd'];

// Agent 角色映射
const AGENT_ROLES = {
  ceo: '包工头',
  cto: '桥王',
  cro: '天文台',
  coo: '蛇头',
  pm: '驴仔',
  qd: '忍者神龟'
};

// 角色中文名到 Agent key 的映射
const ROLE_TO_AGENT = {
  '包工头': 'ceo',
  '桥王': 'cto',
  '天文台': 'cro',
  '蛇头': 'coo',
  '驴仔': 'pm',
  '忍者神龟': 'qd',
  'ceo': 'ceo',
  'cto': 'cto',
  'cro': 'cro',
  'coo': 'coo',
  'pm': 'pm',
  'qd': 'qd'
};

// 所有连接的 WebSocket 客户端
const clients = new Map(); // ws -> { id, type, name }

// Agent 在线状态（内存缓存，快速推送）
const agentOnlineStatus = {};
AGENTS.forEach(agent => {
  agentOnlineStatus[agent] = false;
});

// Agent 最后心跳时间（用于超时检测）
const agentLastHeartbeat = {};
AGENTS.forEach(agent => {
  agentLastHeartbeat[agent] = 0;
});

// 心跳超时阈值（毫秒），超过此时间没收到心跳视为离线
const HEARTBEAT_TIMEOUT = 60000;

// 定时器引用（用于清理）
let boardPushInterval = null;
let heartbeatCheckInterval = null;

// ==================== HTTP 服务器（提供前端页面）====================

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const httpServer = http.createServer((req, res) => {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let urlPath = req.url.split('?')[0];

  // ==================== 文件管理 API ====================

  // 文件列表
  if (urlPath === '/files' && req.method === 'GET') {
    try {
      const files = [];
      if (fs.existsSync(FILE_DIR)) {
        const fileList = fs.readdirSync(FILE_DIR);
        for (const file of fileList) {
          const fileFullPath = path.join(FILE_DIR, file);
          const stat = fs.statSync(fileFullPath);
          files.push({
            name: file,
            size: stat.size,
            mtime: stat.mtime.getTime()
          });
        }
      }
      // 按修改时间倒序
      files.sort((a, b) => b.mtime - a.mtime);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
    } catch (error) {
      logger.error('获取文件列表失败:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '获取文件列表失败' }));
    }
    return;
  }

  // 上传文件
  if (urlPath === '/upload' && req.method === 'POST') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const boundary = req.headers['content-type'].split('; ')[1].replace('boundary=', '');
        const parts = parseMultipart(buffer, boundary);

        for (const part of parts) {
          const filename = part.filename;
          if (filename) {
            const filePath = path.join(FILE_DIR, filename);
            fs.writeFileSync(filePath, part.data);
            logger.info(`文件上传成功: ${filename}`);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        logger.error('文件上传失败:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '文件上传失败' }));
      }
    });
    return;
  }

  // 删除文件
  if (urlPath.startsWith('/files/') && req.method === 'DELETE') {
    const filename = decodeURIComponent(urlPath.slice(7));
    const filePath = path.join(FILE_DIR, filename);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '文件不存在' }));
      return;
    }

    try {
      fs.unlinkSync(filePath);
      logger.info(`文件删除成功: ${filename}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      logger.error('文件删除失败:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '删除失败' }));
    }
    return;
  }

  // 访问上传的文件
  if (urlPath.startsWith('/workspace/')) {
    const filename = decodeURIComponent(urlPath.slice(11));
    const filePath = path.join(FILE_DIR, filename);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filename).toLowerCase();
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf'
      };
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
    return;
  }

  // 解析 multipart form data
  function parseMultipart(buffer, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from('--' + boundary);
    let start = 0;

    while (start < buffer.length) {
      const idx = buffer.indexOf(boundaryBuffer, start);
      if (idx === -1) break;

      const nextIdx = buffer.indexOf(boundaryBuffer, idx + boundaryBuffer.length);
      if (nextIdx === -1) break;

      const chunk = buffer.slice(idx + boundaryBuffer.length + 2, nextIdx - 2);
      const headerEnd = chunk.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        start = nextIdx;
        continue;
      }

      const header = chunk.slice(0, headerEnd).toString();
      const data = chunk.slice(headerEnd + 4);

      const filenameMatch = header.match(/filename="([^"]+)"/);
      if (filenameMatch) {
        parts.push({
          filename: filenameMatch[1],
          data: data
        });
      }

      start = nextIdx;
    }

    return parts;
  }

  // 根路径返回 index.html
  if (urlPath === '/') {
    urlPath = '/index.html';
  }

  // 静态文件服务
  const filePath = path.join(__dirname, 'web', urlPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(filePath));
  } else if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agents: agentOnlineStatus }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// ==================== WebSocket 服务器 ====================

// 客户端 WebSocket 服务器
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  clients.set(ws, { id: clientId, type: 'client', name: '老细' });

  logger.info(`客户端连接: ${clientId}`);

  // 发送欢迎消息
  sendToClient(ws, {
    type: 'system',
    content: '欢迎连接到奴隶兽团队多Agent调度系统！',
    timestamp: Date.now()
  });

  // 立即推送当前看板数据
  pushBoardData();
  pushAllAgentOnlineStatus();

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleClientMessage(ws, message);
    } catch (error) {
      logger.error('处理客户端消息失败:', error);
    }
  });

  ws.on('close', () => {
    logger.info(`客户端断开: ${clientId}`);
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    logger.error(`WebSocket 错误 (${clientId}):`, error);
    clients.delete(ws);
  });
});

// ==================== Agent WebSocket 连接入口 ====================

/**
 * Agent 通过 HTTP POST 接入 WebSocket
 * 路径: /agent-connect?agent=xxx
 */
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/agent-connect') {
    const agentName = url.searchParams.get('agent');
    if (agentName && AGENTS.includes(agentName)) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleAgentConnection(ws, agentName);
      });
    } else {
      socket.destroy();
    }
  } else if (url.pathname === '/' || url.pathname === '') {
    // 普通 WebSocket 客户端连接
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

function handleAgentConnection(ws, agentName) {
  clients.set(ws, { id: `agent_${agentName}`, type: 'agent', name: AGENT_ROLES[agentName] });

  // 更新在线状态
  agentOnlineStatus[agentName] = true;
  updateAgentOnlineStatusInRedis(agentName, true);

  logger.info(`Agent 连接: ${agentName} (${AGENT_ROLES[agentName]})`);

  // 广播 Agent 上线消息
  broadcast({
    type: 'system',
    content: `${AGENT_ROLES[agentName]} 已上线`,
    timestamp: Date.now()
  });

  // 监听来自 Agent 的消息
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleAgentMessage(ws, agentName, message);
    } catch (error) {
      logger.error(`处理 Agent 消息失败 (${agentName}):`, error);
    }
  });

  ws.on('close', () => {
    agentOnlineStatus[agentName] = false;
    agentLastHeartbeat[agentName] = 0; // 重置心跳记录
    updateAgentOnlineStatusInRedis(agentName, false);
    logger.info(`Agent 断开: ${agentName} (${AGENT_ROLES[agentName]})`);

    broadcast({
      type: 'system',
      content: `${AGENT_ROLES[agentName]} 已离线`,
      timestamp: Date.now()
    });
    pushAllAgentOnlineStatus();
    pushBoardData();
  });

  ws.on('error', (error) => {
    logger.error(`Agent WebSocket 错误 (${agentName}):`, error);
  });
}

// ==================== 消息处理 ====================

async function handleClientMessage(ws, message) {
  const clientInfo = clients.get(ws);

  switch (message.type) {
    case 'chat':
      await handleChatMessage(clientInfo, message);
      break;

    case 'heartbeat':
      sendToClient(ws, {
        type: 'heartbeat_ack',
        timestamp: Date.now()
      });
      break;

    case 'get_history':
      await handleGetHistory(ws);
      break;

    case 'clear_history':
      await handleClearHistory();
      break;

    case 'clear_all_logs':
      await handleClearAllLogs(ws);
      break;

    case 'get_log_list':
      await handleGetLogList(ws);
      break;

    case 'clear_log':
      await handleClearLog(ws, message.agentName);
      break;

    default:
      logger.warn(`未知消息类型: ${message.type}`);
  }
}

async function handleChatMessage(clientInfo, message) {
  const { sender, content, timestamp } = message;

  // 构建聊天消息
  const chatMsg = {
    sender: sender || '老细',
    content: content || '',
    timestamp: timestamp || Date.now()
  };

  // 保存到 Redis
  try {
    await redis.addChatMessage(chatMsg);
  } catch (error) {
    logger.error('保存聊天记录失败:', error);
  }

  // 广播给所有客户端
  broadcast({
    type: 'chat',
    sender: chatMsg.sender,
    content: chatMsg.content,
    timestamp: chatMsg.timestamp
  });

  // 如果是 @ 指令，解析并分发任务
  if (content && content.trim().startsWith('@')) {
    await handleAtCommand(chatMsg);
  }
}

async function handleAtCommand(message) {
  // 解析 @agent 指令
  const match = message.content.match(/^@(\S+)\s+(.+)/);
  if (!match) return;

  const targetAgent = match[1].toLowerCase();
  const taskContent = match[2];
  const sender = message.sender;

  // 支持中文名和英文名
  const resolvedAgent = ROLE_TO_AGENT[targetAgent] || targetAgent;

  // CEO 不走队列，直接让 CEO 自己处理消息
  if (resolvedAgent === 'ceo') {
    return;
  }

  if (!AGENTS.includes(resolvedAgent)) {
    broadcast({
      type: 'system',
      content: `未知的 Agent: ${targetAgent}，可用: ${AGENTS.join(', ')} / ${Object.keys(AGENT_ROLES).join(', ')}`,
      timestamp: Date.now()
    });
    return;
  }

  // 将任务推入对应 Agent 的队列
  const task = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    content: taskContent,
    from: sender,
    to: resolvedAgent,
    timestamp: Date.now(),
    status: 'pending'
  };

  try {
    // 保存任务到全局任务列表
    await redis.setTask(task.id, task);
    // 推入 Agent 队列
    await redis.lpush(`slavebeasts:agent:${resolvedAgent}:queue`, task);

    // 获取队列长度
    const queueLength = await redis.llen(`slavebeasts:agent:${resolvedAgent}:queue`);

    // 更新状态
    await updateAgentStatus(resolvedAgent, {
      name: resolvedAgent,
      role: resolvedAgent,
      busy: true,
      currentTask: taskContent,
      progress: 0,
      queueLength: queueLength - 1,
      status: queueLength > 1 ? 'queued' : 'processing'
    });

    broadcast({
      type: 'system',
      content: `任务已分配给 ${AGENT_ROLES[resolvedAgent]}，队列位置: ${queueLength}`,
      timestamp: Date.now()
    });

    // 转发任务消息给对应 Agent（通过 Redis Pub/Sub 或直接检查队列）
    // 这里通过定期推送看板数据，Agent 监听自己的队列来获取任务
    pushBoardData();
  } catch (error) {
    logger.error('分配任务失败:', error);
  }
}

async function handleAgentMessage(ws, agentName, message) {
  const clientInfo = clients.get(ws);

  switch (message.type) {
    case 'chat':
      // Agent 发送的消息
      await handleAgentChatMessage(agentName, message);
      break;

    case 'heartbeat':
      // 记录心跳时间，用于超时检测
      agentLastHeartbeat[agentName] = Date.now();
      sendToClient(ws, {
        type: 'heartbeat_ack',
        timestamp: Date.now()
      });
      break;

    case 'status_update':
      // Agent 状态更新
      await handleAgentStatusUpdate(agentName, message.data);
      break;

    case 'progress_update':
      // 进度更新
      await handleAgentProgressUpdate(agentName, message.data);
      break;

    case 'task_complete':
      // 任务完成
      await handleTaskComplete(agentName, message.data);
      break;

    case 'task_reject':
      // 任务驳回
      await handleTaskReject(agentName, message.data);
      break;

    case 'online':
      // Agent 上报在线状态，重置心跳计时
      agentOnlineStatus[agentName] = true;
      agentLastHeartbeat[agentName] = Date.now();
      await updateAgentOnlineStatusInRedis(agentName, true);
      pushAllAgentOnlineStatus();
      break;

    default:
      logger.warn(`Agent 未知消息类型: ${message.type} (from ${agentName})`);
  }
}

async function handleAgentChatMessage(agentName, message) {
  const { content, timestamp } = message;
  const sender = AGENT_ROLES[agentName] || agentName;

  const chatMsg = {
    sender,
    content: content || '',
    timestamp: timestamp || Date.now()
  };

  try {
    await redis.addChatMessage(chatMsg);
  } catch (error) {
    logger.error('保存 Agent 聊天记录失败:', error);
  }

  broadcast({
    type: 'chat',
    sender: chatMsg.sender,
    content: chatMsg.content,
    timestamp: chatMsg.timestamp
  });
}

async function handleAgentStatusUpdate(agentName, data) {
  if (!data) return;

  const currentStatus = await redis.get(`slavebeasts:agent:${agentName}:status`);
  const queueLength = await redis.llen(`slavebeasts:agent:${agentName}:queue`);

  const newStatus = {
    name: agentName,
    role: AGENT_ROLES[agentName],
    busy: data.busy || false,
    currentTask: data.currentTask || null,
    progress: data.progress || 0,
    queueLength: queueLength,
    status: data.status || (data.busy ? 'processing' : 'idle'),
    updateTime: Date.now(),
    online: agentOnlineStatus[agentName]
  };

  try {
    await redis.set(`slavebeasts:agent:${agentName}:status`, newStatus);
  } catch (error) {
    logger.error(`更新 Agent 状态失败 (${agentName}):`, error);
  }

  // 广播单个 Agent 状态更新
  broadcast({
    type: 'agent_update',
    data: newStatus
  });

  pushBoardData();
}

async function handleAgentProgressUpdate(agentName, data) {
  if (!data) return;

  const currentStatus = await redis.get(`slavebeasts:agent:${agentName}:status`);
  if (currentStatus) {
    currentStatus.progress = data.progress || currentStatus.progress || 0;
    currentStatus.status = data.status || currentStatus.status || 'processing';
    currentStatus.updateTime = Date.now();
    currentStatus.online = agentOnlineStatus[agentName];

    try {
      await redis.set(`slavebeasts:agent:${agentName}:status`, currentStatus);
    } catch (error) {
      logger.error(`更新 Agent 进度失败 (${agentName}):`, error);
    }

    broadcast({
      type: 'agent_update',
      data: currentStatus
    });
  }
}

async function handleTaskComplete(agentName, data) {
  logger.info(`任务完成 (${agentName}): ${JSON.stringify(data)}`);

  // 清空当前任务，标记为 idle
  const queueLength = await redis.llen(`slavebeasts:agent:${agentName}:queue`);

  if (queueLength > 0) {
    // 还有排队任务，取下一个
    const nextTask = await redis.rpop(`slavebeasts:agent:${agentName}:queue`);
    await updateAgentStatus(agentName, {
      name: agentName,
      role: agentName,
      busy: true,
      currentTask: nextTask ? nextTask.content : null,
      progress: 0,
      queueLength: await redis.llen(`slavebeasts:agent:${agentName}:queue`),
      status: 'processing'
    });
  } else {
    await updateAgentStatus(agentName, {
      name: agentName,
      role: agentName,
      busy: false,
      currentTask: null,
      progress: 100,
      queueLength: 0,
      status: 'finish'
    });
  }

  pushBoardData();
}

async function handleTaskReject(agentName, data) {
  logger.info(`任务驳回 (${agentName}): ${JSON.stringify(data)}`);

  // 驳回后清空当前任务
  const queueLength = await redis.llen(`slavebeasts:agent:${agentName}:queue`);

  if (queueLength > 0) {
    const nextTask = await redis.rpop(`slavebeasts:agent:${agentName}:queue`);
    await updateAgentStatus(agentName, {
      name: agentName,
      role: agentName,
      busy: true,
      currentTask: nextTask ? nextTask.content : null,
      progress: 0,
      queueLength: await redis.llen(`slavebeasts:agent:${agentName}:queue`),
      status: 'processing'
    });
  } else {
    await updateAgentStatus(agentName, {
      name: agentName,
      role: agentName,
      busy: false,
      currentTask: null,
      progress: 0,
      queueLength: 0,
      status: 'reject'
    });
  }

  // 广播驳回消息
  broadcast({
    type: 'system',
    content: `${AGENT_ROLES[agentName]} 驳回了任务: ${data?.reason || '无理由'}`,
    timestamp: Date.now()
  });

  pushBoardData();
}

async function handleGetHistory(ws) {
  try {
    const messages = await redis.getChatHistory(10);
    logger.info('发送历史消息, 数量:', messages ? messages.length : 0);
    if (messages && messages.length > 0) {
      logger.info('第一条消息:', JSON.stringify(messages[0]));
    }
    sendToClient(ws, {
      type: 'history',
      messages: messages || []
    });
  } catch (error) {
    logger.error('获取历史记录失败:', error);
    sendToClient(ws, {
      type: 'history',
      messages: []
    });
  }
}

async function handleClearHistory() {
  try {
    // 清空聊天记录
    await redis.redis.del('slavebeasts:chat:history');

    broadcast({
      type: 'history_cleared',
      timestamp: Date.now()
    });

    logger.info('聊天记录和所有 Agent 会话已清空');
  } catch (error) {
    logger.error('清空历史记录失败:', error);
  }
}

// ==================== 状态管理 ====================

async function updateAgentStatus(agentName, status) {
  try {
    await redis.set(`slavebeasts:agent:${agentName}:status`, status);
  } catch (error) {
    logger.error(`更新 Agent 状态失败 (${agentName}):`, error);
  }
}

async function updateAgentOnlineStatusInRedis(agentName, online) {
  try {
    await redis.redis.hset('slavebeasts:agent:online', agentName, online ? '1' : '0');
  } catch (error) {
    logger.error(`更新 Agent 在线状态失败 (${agentName}):`, error);
  }
}

// ==================== 看板推送 ====================

// 每秒推送看板数据
boardPushInterval = setInterval(async () => {
  await pushBoardData();
}, BOARD_PUSH_INTERVAL);

async function pushBoardData() {
  try {
    const allStatus = await redis.getAllAgentStatus();

    // 合并在线状态
    const boardData = allStatus.map(status => {
      const name = status.name || status.role;
      const agentKey = ROLE_TO_AGENT[name] || name;
      return {
        ...status,
        name: agentKey,
        role: agentKey,
        online: agentOnlineStatus[agentKey] !== false
      };
    });

    broadcast({
      type: 'board',
      agents: boardData,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error('推送看板数据失败:', error);
  }
}

async function pushAllAgentOnlineStatus() {
  // 只更新看板数据，在线状态已经包含在 board 数据中
  // 不再广播 agent_online_update，避免显示在聊天框
  await pushBoardData();
}

// ==================== 广播工具 ====================

function broadcast(message) {
  const data = JSON.stringify(message);
  let sentCount = 0;

  clients.forEach((clientInfo, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      sentCount++;
    }
  });

  return sentCount;
}

function sendToClient(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ==================== Agent 向指定 Agent 发送消息 ====================

/**
 * 通过 WebSocket 向指定 Agent 发送消息
 * Agent 注册后会在 clients map 中
 */
function sendToAgent(agentName, message) {
  let targetWs = null;

  clients.forEach((info, ws) => {
    if (info.type === 'agent' && info.name === AGENT_ROLES[agentName]) {
      targetWs = ws;
    }
  });

  if (targetWs && targetWs.readyState === WebSocket.OPEN) {
    targetWs.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// ==================== 定时检查 Agent 在线状态（心跳超时检测）====================

heartbeatCheckInterval = setInterval(async () => {
  try {
    const now = Date.now();
    let changed = false;

    for (const agent of AGENTS) {
      const lastHb = agentLastHeartbeat[agent];
      const isOnline = agentOnlineStatus[agent];

      // 检查心跳超时
      if (isOnline && lastHb > 0 && (now - lastHb) > HEARTBEAT_TIMEOUT) {
        logger.warn(`Agent "${agent}" 心跳超时，标记为离线`);
        agentOnlineStatus[agent] = false;
        await updateAgentOnlineStatusInRedis(agent, false);
        changed = true;
      }

      // 检查 Redis 中没有记录
      const redisOnline = await redis.redis.hgetall('slavebeasts:agent:online');
      if (redisOnline && redisOnline[agent] === undefined && agentOnlineStatus[agent] === true) {
        agentOnlineStatus[agent] = false;
        changed = true;
      }
    }

    // 有状态变化才推送
    if (changed) {
      pushAllAgentOnlineStatus();
      pushBoardData();
    }
  } catch (error) {
    // 忽略错误
  }
}, 10000);

// ==================== 启动服务器 ====================

httpServer.listen(PORT, () => {
  logger.info(`奴隶兽服务器启动成功，端口: ${PORT}`);
  logger.info(`WebSocket 服务已就绪`);
  logger.info(`Agent 连接入口: ws://localhost:${PORT}/agent-connect?agent=<agent-name>`);
});

// ==================== 优雅关闭 ====================

function cleanup() {
  logger.info('正在清理定时器...');
  if (boardPushInterval) clearInterval(boardPushInterval);
  if (heartbeatCheckInterval) clearInterval(heartbeatCheckInterval);
  logger.info('定时器已清理');
}

process.on('SIGTERM', async () => {
  logger.info('收到 SIGTERM，开始关闭服务器...');
  cleanup();
  wss.close(() => {
    httpServer.close(() => {
      logger.info('服务器已关闭');
      process.exit(0);
    });
  });
});

process.on('SIGINT', async () => {
  logger.info('收到 SIGINT，开始关闭服务器...');
  cleanup();
  wss.close(() => {
    httpServer.close(() => {
      logger.info('服务器已关闭');
      process.exit(0);
    });
  });
});

// 导出工具函数（供 agent-startup.js 使用）
module.exports = {
  sendToAgent,
  broadcast,
  AGENTS,
  AGENT_ROLES,
  clients,
  wss
};

// ==================== 日志管理 ====================

const { clearLog, clearAllLogs, getLogFiles } = require('./utils/logger');

async function handleGetLogList(ws) {
  try {
    const files = getLogFiles();
    sendToClient(ws, {
      type: 'log_list',
      files: files
    });
  } catch (error) {
    logger.error('获取日志列表失败:', error);
    sendToClient(ws, {
      type: 'log_list',
      files: []
    });
  }
}

async function handleClearAllLogs(ws) {
  try {
    const cleared = clearAllLogs();
    logger.info(`已清空所有日志: ${cleared.join(', ')}`);
    sendToClient(ws, {
      type: 'logs_cleared',
      message: `已清空 ${cleared.length} 个日志文件`
    });
  } catch (error) {
    logger.error('清空所有日志失败:', error);
    sendToClient(ws, {
      type: 'logs_cleared',
      message: '清空日志失败'
    });
  }
}

async function handleClearLog(ws, agentName) {
  if (!agentName) {
    sendToClient(ws, {
      type: 'log_cleared',
      success: false,
      message: '未指定日志名'
    });
    return;
  }

  try {
    const success = clearLog(agentName);
    if (success) {
      logger.info(`已清空日志: ${agentName}`);
      sendToClient(ws, {
        type: 'log_cleared',
        success: true,
        agentName: agentName,
        message: `已清空 ${agentName} 日志`
      });
    } else {
      sendToClient(ws, {
        type: 'log_cleared',
        success: false,
        message: `日志文件 ${agentName} 不存在`
      });
    }
  } catch (error) {
    logger.error(`清空日志失败 (${agentName}):`, error);
    sendToClient(ws, {
      type: 'log_cleared',
      success: false,
      message: '清空日志失败'
    });
  }
}
