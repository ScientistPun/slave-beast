/**
 * Redis 工具模块
 * 提供 Redis 连接和常用操作
 */

const Redis = require('ioredis');

// Redis 配置
const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3
};

// 创建主 Redis 客户端
const redis = new Redis(REDIS_CONFIG);

// 创建发布客户端（用于 Pub/Sub）
const publisher = new Redis(REDIS_CONFIG);

// 创建订阅客户端（用于接收消息）
const subscriber = new Redis(REDIS_CONFIG);

// Redis 键名前缀
const PREFIX = 'slavebeasts';

// Redis 键名常量
const KEYS = {
  // 全局聊天记录
  CHAT_HISTORY: `${PREFIX}:chat:history`,

  // 聊天在线状态
  CHAT_ONLINE: `${PREFIX}:chat:online`,

  // Agent 队列
  AGENT_QUEUE: (role) => `${PREFIX}:agent:${role}:queue`,

  // Agent 状态
  AGENT_STATUS: (role) => `${PREFIX}:agent:${role}:status`,

  // Agent 当前任务
  AGENT_CURRENT_TASK: (role) => `${PREFIX}:agent:${role}:current_task`,

  // 全局任务列表
  TASKS: `${PREFIX}:tasks`,

  // 任务详情
  TASK: (taskId) => `${PREFIX}:task:${taskId}`,

  // 频道
  CHANNEL: (name) => `${PREFIX}:channel:${name}`
};

// 代理名称映射
const AGENT_NAMES = {
  boss: '包工头',
  ceo: '包工头',
  cto: '桥王',
  cro: '天文台',
  coo: '蛇头',
  pm: '驴仔',
  qd: '忍者神龟'
};

// 监听连接事件
redis.on('connect', () => {
  console.log('[Redis] 主客户端已连接');
});

redis.on('error', (err) => {
  console.error('[Redis] 主客户端错误:', err.message);
});

publisher.on('connect', () => {
  console.log('[Redis] 发布客户端已连接');
});

subscriber.on('connect', () => {
  console.log('[Redis] 订阅客户端已连接');
});

/**
 * 初始化 Redis 数据结构
 */
async function initRedis() {
  try {
    // 设置默认Agent状态
    const agents = ['ceo', 'cto', 'cro', 'coo', 'pm', 'qd'];
    for (const agent of agents) {
      const status = await redis.get(KEYS.AGENT_STATUS(agent));
      if (!status) {
        await redis.set(KEYS.AGENT_STATUS(agent), JSON.stringify({
          status: 'idle',
          currentTask: null,
          queueLength: 0,
          lastUpdate: Date.now()
        }));
      }
    }
    console.log('[Redis] 初始化完成');
  } catch (err) {
    console.error('[Redis] 初始化错误:', err.message);
  }
}

/**
 * 添加聊天记录
 * @param {Object} message - 消息对象
 */
async function addChatMessage(message) {
  const msg = JSON.stringify({
    ...message,
    timestamp: Date.now()
  });
  await redis.rpush(KEYS.CHAT_HISTORY, msg);
}

/**
 * 获取聊天记录
 * @param {number} limit - 获取数量
 */
async function getChatHistory(limit = 100) {
  const messages = await redis.lrange(KEYS.CHAT_HISTORY, -limit, -1);
  return messages.map(m => JSON.parse(m));
}

/**
 * 清空聊天记录
 */
async function clearChatHistory() {
  await redis.del(KEYS.CHAT_HISTORY);
}

/**
 * 设置 Agent 在线状态
 * @param {string} role - Agent角色
 * @param {string} name - Agent名称
 */
async function setAgentOnline(role, name) {
  await redis.hset(KEYS.CHAT_ONLINE, role, JSON.stringify({ name, onlineAt: Date.now() }));
}

/**
 * 设置 Agent 离线状态
 * @param {string} role - Agent角色
 */
async function setAgentOffline(role) {
  await redis.hdel(KEYS.CHAT_ONLINE, role);
}

/**
 * 获取所有在线 Agent
 */
async function getOnlineAgents() {
  const data = await redis.hgetall(KEYS.CHAT_ONLINE);
  const result = {};
  for (const [role, info] of Object.entries(data)) {
    result[role] = JSON.parse(info);
  }
  return result;
}

/**
 * 检查 Agent 是否在线
 * @param {string} role - Agent角色
 */
async function isAgentOnline(role) {
  return await redis.hexists(KEYS.CHAT_ONLINE, role);
}

/**
 * 设置 Agent 状态
 * @param {string} role - Agent角色
 * @param {Object} status - 状态对象
 */
async function setAgentStatus(role, status) {
  const data = JSON.stringify({
    ...status,
    lastUpdate: Date.now()
  });
  await redis.set(KEYS.AGENT_STATUS(role), data);
}

/**
 * 获取 Agent 状态
 * @param {string} role - Agent角色
 */
async function getAgentStatus(role) {
  const data = await redis.get(KEYS.AGENT_STATUS(role));
  return data ? JSON.parse(data) : null;
}

/**
 * 获取所有 Agent 状态
 */
async function getAllAgentStatus() {
  const agentsList = ['ceo', 'cto', 'cro', 'coo', 'pm', 'qd'];

  // 并行获取所有状态、队列长度和在线状态
  const promises = agentsList.map(async (agent) => {
    const [status, queueLen, online] = await Promise.all([
      getAgentStatus(agent),
      redis.llen(KEYS.AGENT_QUEUE(agent)),
      redis.hexists(KEYS.CHAT_ONLINE, agent)
    ]);
    return { agent, status, queueLen, online: online === 1 };
  });

  const results = await Promise.all(promises);
  const statuses = {};

  for (const { agent, status, queueLen, online } of results) {
    statuses[agent] = status ? { ...status, queueLength: queueLen, online } : { online };
  }

  return statuses;
}

/**
 * 添加任务到 Agent 队列
 * @param {string} role - Agent角色
 * @param {Object} task - 任务对象
 */
async function addToQueue(role, task) {
  const taskStr = JSON.stringify({
    ...task,
    addedAt: Date.now()
  });
  await redis.rpush(KEYS.AGENT_QUEUE(role), taskStr);
}

/**
 * 从 Agent 队列获取任务（不删除）
 * @param {string} role - Agent角色
 */
async function peekQueue(role) {
  const tasks = await redis.lrange(KEYS.AGENT_QUEUE(role), 0, -1);
  return tasks.map(t => JSON.parse(t));
}

/**
 * 从 Agent 队列取出下一个任务
 * @param {string} role - Agent角色
 */
async function popFromQueue(role) {
  const taskStr = await redis.lpop(KEYS.AGENT_QUEUE(role));
  return taskStr ? JSON.parse(taskStr) : null;
}

/**
 * 获取 Agent 队列长度
 * @param {string} role - Agent角色
 */
async function getQueueLength(role) {
  return await redis.llen(KEYS.AGENT_QUEUE(role));
}

/**
 * 发布消息到频道
 * @param {string} channel - 频道名
 * @param {Object} message - 消息
 */
async function publish(channel, message) {
  await publisher.publish(channel, JSON.stringify(message));
}

/**
 * 订阅频道
 * @param {string} channel - 频道名
 * @param {Function} callback - 回调函数
 */
async function subscribe(channel, callback) {
  await subscriber.subscribe(channel);
  subscriber.on('message', (ch, message) => {
    if (ch === channel) {
      callback(JSON.parse(message));
    }
  });
}

/**
 * 创建新任务
 * @param {Object} taskData - 任务数据
 */
async function createTask(taskData) {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const task = {
    id: taskId,
    ...taskData,
    status: 'pending',
    createdAt: Date.now(),
    steps: []
  };
  await redis.set(KEYS.TASK(taskId), JSON.stringify(task));
  await redis.rpush(KEYS.TASKS, taskId);
  return task;
}

/**
 * 更新任务
 * @param {string} taskId - 任务ID
 * @param {Object} updates - 更新数据
 */
async function updateTask(taskId, updates) {
  const taskStr = await redis.get(KEYS.TASK(taskId));
  if (taskStr) {
    const task = JSON.parse(taskStr);
    const updated = { ...task, ...updates };
    await redis.set(KEYS.TASK(taskId), JSON.stringify(updated));
    return updated;
  }
  return null;
}

/**
 * 获取任务
 * @param {string} taskId - 任务ID
 */
async function getTask(taskId) {
  const taskStr = await redis.get(KEYS.TASK(taskId));
  return taskStr ? JSON.parse(taskStr) : null;
}

/**
 * 发布 Agent 状态更新（广播）
 * @param {string} role - Agent角色
 * @param {Object} status - 新状态
 */
async function broadcastAgentUpdate(role, status) {
  await publish(KEYS.CHANNEL('agent_updates'), {
    role,
    ...status,
    timestamp: Date.now()
  });
}

module.exports = {
  redis,
  publisher,
  subscriber,
  KEYS,
  AGENT_NAMES,
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
  peekQueue,
  popFromQueue,
  getQueueLength,
  publish,
  subscribe,
  createTask,
  updateTask,
  getTask,
  broadcastAgentUpdate
};
