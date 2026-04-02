/**
 * WebSocket 服务器
 * 负责：接收客户端消息、路由到 Agent、任务排队（Redis）、广播 Agent 回复
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { WebSocketServer } = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const { systemLogger: logger } = require('./utils/logger');
const {
  KEYS,
  initRedis,
  addChatMessage,
  getChatHistory,
  clearChatHistory,
  setAgentOnline,
  setAgentOffline,
  getOnlineAgents,
  isAgentOnline,
  setAgentStatus,
  getAgentStatus,
  getAllAgentStatus,
  addToQueue,
  popFromQueue,
  getQueueLength,
  publish,
  subscribe
} = require('./utils/redis');

// WebSocket 连接存储
const agents = new Map(); // role -> ws
const clients = new Map(); // clientId -> ws

/**
 * 创建 HTTP + WebSocket 服务器
 */
async function main() {
  logger.info('===========================================');
  logger.info('  slave-beasts 多Agent调度系统启动中...');
  logger.info('===========================================');

  // 初始化 Redis
  await initRedis();

  const app = express();
  app.use(express.static(path.join(__dirname, 'web')));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // 处理 WebSocket 连接
  wss.on('connection', (ws) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    clients.set(clientId, ws);

    logger.info(`客户端连接: ${clientId}`);

    // 发送欢迎消息
    ws.send(JSON.stringify({
      type: 'system',
      content: '欢迎来到奴隶兽团队！有什么需要帮忙的？',
      timestamp: Date.now()
    }));

    // 发送聊天历史
    sendChatHistory(ws);

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'agent_register' || message.type === 'agent_reply' || message.type === 'assign_task' || message.type === 'task_result' || message.type === 'task_complete') {
        handleAgentMessage(ws, message);
      } else {
        handleClientMessage(clientId, ws, message);
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      logger.info(`客户端断开: ${clientId}`);
    });
  });

  // 订阅 Agent 状态更新
  await subscribe(KEYS.CHANNEL('agent_updates'), (update) => {
    broadcast({ type: 'agent_update', data: update, timestamp: Date.now() });
  });

  // 订阅聊天广播
  await subscribe(KEYS.CHANNEL('broadcast'), (message) => {
    broadcast(message);
  });

  // 定期广播 Agent 状态
  setInterval(async () => {
    try {
      const status = await getAllAgentStatus();
      broadcast({ type: 'agent_status', data: status, timestamp: Date.now() });
    } catch (err) {
      logger.error('广播状态失败', { error: err.message });
    }
  }, 5000);

  const PORT = process.env.PORT || 8080;
  server.listen(PORT, () => {
    logger.info(`服务器已启动，端口: ${PORT}`);
    logger.info('等待 Agent 连接...');
  });
}

/**
 * 发送聊天历史给客户端
 */
async function sendChatHistory(ws) {
  try {
    const history = await getChatHistory(100);
    ws.send(JSON.stringify({ type: 'chat_history', data: history, timestamp: Date.now() }));
  } catch (err) {
    logger.error('发送聊天历史失败', { error: err.message });
  }
}

/**
 * 处理客户端消息
 */
async function handleClientMessage(clientId, _ws, message) {
  const { type, content } = message;

  if (type === 'chat' && content) {
    // 保存到 Redis
    await addChatMessage({ type: 'user', from: '老细', content });

    // 通过频道广播（subscribe 会转发给所有客户端）
    await publish(KEYS.CHANNEL('broadcast'), {
      type: 'chat',
      from: '老细',
      content,
      timestamp: Date.now()
    });

    // 转发给 CEO 处理
    const ceoWs = agents.get('ceo');
    if (ceoWs && ceoWs.readyState === 1) {
      ceoWs.send(JSON.stringify({
        type: 'user_message',
        content,
        userId: clientId
      }));
    } else {
      _ws.send(JSON.stringify({
        type: 'system',
        content: '包工头暂未上线，请稍后再试...',
        timestamp: Date.now()
      }));
    }
  }

  if (type === 'get_history') {
    const history = await getChatHistory(100);
    _ws.send(JSON.stringify({
      type: 'chat_history',
      data: history,
      timestamp: Date.now()
    }));
  }

  if (type === 'clear_history') {
    await clearChatHistory();
    broadcast({ type: 'history_cleared', timestamp: Date.now() });
  }
}

/**
 * 处理 Agent 消息
 */
async function handleAgentMessage(ws, message) {
  const { type } = message;

  if (type === 'agent_register') {
    await handleAgentRegister(ws, message);
    return;
  }

  if (type === 'agent_reply') {
    await handleAgentReply(message);
    return;
  }

  if (type === 'assign_task') {
    await handleAssignTask(message);
    return;
  }

  if (type === 'task_result') {
    await handleTaskResult(message);
    return;
  }

  if (type === 'task_complete') {
    await handleTaskComplete(message);
    return;
  }
}

/**
 * Agent 注册
 */
async function handleAgentRegister(ws, message) {
  const { role, name } = message;

  agents.set(role, ws);

  // 设置在线状态到 Redis
  await setAgentOnline(role, name);

  // 初始化 Redis 状态
  await setAgentStatus(role, {
    status: 'idle',
    name,
    currentTask: null,
    queueLength: await getQueueLength(role)
  });

  logger.info(`Agent 注册: ${name} (${role})`);

  // 监听断开连接
  ws.on('close', async () => {
    agents.delete(role);
    await setAgentOffline(role);
    logger.info(`Agent 断开: ${name} (${role})`);
    broadcastAgentStatus(role);
  });

  // 广播状态更新
  broadcastAgentStatus(role);
}

/**
 * Agent 回复
 */
async function handleAgentReply(message) {
  const { from, content } = message;

  // 保存到 Redis
  await addChatMessage({ type: 'agent', from, content });

  // 通过频道广播（subscribe 会转发给所有客户端）
  await publish(KEYS.CHANNEL('broadcast'), {
    type: 'chat',
    from,
    content,
    timestamp: Date.now()
  });
}

/**
 * 处理任务分配
 */
async function handleAssignTask(message) {
  const { from, to, taskContent, userId, flow } = message;

  const targetBusy = await isAgentBusy(to);

  if (targetBusy) {
    // Agent 忙碌，加入 Redis 队列
    await addToQueue(to, { taskContent, userId, flow, from, addedAt: Date.now() });

    // 更新队列长度（状态保持 processing 表示正在执行）
    await setAgentStatus(to, {
      status: 'processing',
      queueLength: await getQueueLength(to)
    });

    logger.info(`${to} 忙碌，任务入队，当前队列: ${await getQueueLength(to)}`);

    // 通知请求者
    notifyTaskQueued(from, to, await getQueueLength(to));
  } else {
    // Agent 空闲，发送任务
    const targetWs = agents.get(to);
    if (targetWs && targetWs.readyState === 1) {
      // 更新状态为 processing
      await setAgentStatus(to, {
        status: 'processing',
        name: from,
        currentTask: taskContent,
        queueLength: await getQueueLength(to)
      });

      targetWs.send(JSON.stringify({
        type: 'new_task',
        taskContent,
        userId,
        flow
      }));

      logger.info(`任务发送给 ${to}`);

      broadcastAgentStatus(to);
    } else {
      // Agent 不在线，加入队列等待
      await addToQueue(to, { taskContent, userId, flow, from, addedAt: Date.now() });
      logger.info(`${to} 不在线，任务入队`);
    }
  }
}

/**
 * 任务结果（审核驳回）
 */
async function handleTaskResult(message) {
  const { from, status, review, taskContent, userId } = message;

  // status: 'approved' | 'reject'

  if (status === 'reject') {
    // 驳回，通知 CEO
    const ceoWs = agents.get('ceo');
    if (ceoWs && ceoWs.readyState === 1) {
      ceoWs.send(JSON.stringify({
        type: 'task_rejected',
        from,
        review,
        taskContent,
        userId
      }));
    }
  }

  // 更新状态为 idle
  await setAgentStatus(from, {
    status: 'idle',
    currentTask: null,
    queueLength: await getQueueLength(from)
  });

  // 检查队列
  await processNextInQueue(from);

  broadcastAgentStatus(from);
}

/**
 * 任务完成
 */
async function handleTaskComplete(message) {
  const { from, result, taskContent, userId } = message;

  // 更新状态为 finish
  await setAgentStatus(from, {
    status: 'idle',
    currentTask: null,
    queueLength: await getQueueLength(from)
  });

  // 检查队列中是否有等待的任务
  await processNextInQueue(from);

  // 通知 CEO 任务完成
  const ceoWs = agents.get('ceo');
  if (ceoWs && ceoWs.readyState === 1) {
    ceoWs.send(JSON.stringify({
      type: 'task_completed',
      from,
      result,
      taskContent,
      userId
    }));
  }

  broadcastAgentStatus(from);
}

/**
 * 检查 Agent 是否忙碌
 */
async function isAgentBusy(role) {
  const status = await getAgentStatus(role);
  return status && status.status === 'processing';
}

/**
 * 处理队列中的下一个任务
 */
async function processNextInQueue(role) {
  const nextTask = await popFromQueue(role);

  if (nextTask) {
    const targetWs = agents.get(role);
    if (targetWs && targetWs.readyState === 1) {
      await setAgentStatus(role, {
        status: 'processing',
        currentTask: nextTask.taskContent,
        queueLength: await getQueueLength(role)
      });

      targetWs.send(JSON.stringify({
        type: 'new_task',
        taskContent: nextTask.taskContent,
        userId: nextTask.userId,
        flow: nextTask.flow
      }));

      logger.info(`从队列取出任务发送给 ${role}，剩余: ${await getQueueLength(role)}`);

      broadcastAgentStatus(role);
    }
  } else {
    // 队列空，更新为 idle
    await setAgentStatus(role, {
      status: 'idle',
      currentTask: null,
      queueLength: 0
    });

    broadcastAgentStatus(role);
  }
}

/**
 * 广播 Agent 状态
 */
async function broadcastAgentStatus(role) {
  const status = await getAgentStatus(role);
  broadcast({
    type: 'agent_status',
    data: { [role]: status },
    timestamp: Date.now()
  });

  // 发布到频道
  await publish(KEYS.CHANNEL('agent_updates'), {
    role,
    ...status
  });
}

/**
 * 通知任务已入队
 */
async function notifyTaskQueued(requestFrom, targetAgent, queueLength) {
  const fromWs = agents.get(requestFrom);
  if (fromWs && fromWs.readyState === 1) {
    fromWs.send(JSON.stringify({
      type: 'task_queued',
      to: targetAgent,
      queueLength,
      message: `${targetAgent} 忙碌，任务已入队排队`
    }));
  }
}

/**
 * 广播给所有客户端
 */
function broadcast(message) {
  const data = JSON.stringify(message);
  clients.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  });
}

// 错误处理
process.on('uncaughtException', (err) => {
  logger.error('未捕获异常', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('未处理的Promise拒绝', { reason });
});

main().catch((err) => {
  logger.error('启动失败', { error: err.message, stack: err.stack });
  process.exit(1);
});
