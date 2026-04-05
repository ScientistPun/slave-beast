const Redis = require('ioredis');
require('dotenv').config();

// 创建Redis连接
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB || 0,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  showFriendlyErrorStack: true
});

// 连接事件监听
redis.on('connect', () => {
  console.log('[Redis] 连接成功');
});

redis.on('ready', () => {
  console.log('[Redis] 服务就绪');
});

redis.on('error', (error) => {
  console.error('[Redis] 连接错误:', error.message);
});

redis.on('reconnecting', () => {
  console.log('[Redis] 正在重连...');
});

// Redis操作封装
class RedisClient {
  constructor() {
    this.redis = redis;
  }

  // ========== 队列操作 ==========

  /**
   * 从队列左侧推入数据
   * @param {string} key - 队列键名
   * @param {*} value - 要存储的数据
   */
  async lpush(key, value) {
    try {
      return await this.redis.lpush(key, JSON.stringify(value));
    } catch (error) {
      console.error(`[Redis] lpush失败 ${key}:`, error);
      throw error;
    }
  }

  /**
   * 从队列右侧弹出数据
   * @param {string} key - 队列键名
   * @returns {*} - 弹出的数据
   */
  async rpop(key) {
    try {
      const value = await this.redis.rpop(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`[Redis] rpop失败 ${key}:`, error);
      throw error;
    }
  }

  /**
   * 获取队列长度
   * @param {string} key - 队列键名
   * @returns {number} - 队列长度
   */
  async llen(key) {
    try {
      return await this.redis.llen(key);
    } catch (error) {
      console.error(`[Redis] llen失败 ${key}:`, error);
      throw error;
    }
  }

  // ========== 状态读写 ==========

  /**
   * 设置键值对
   * @param {string} key - 键名
   * @param {*} value - 值
   */
  async set(key, value) {
    try {
      return await this.redis.set(key, JSON.stringify(value));
    } catch (error) {
      console.error(`[Redis] set失败 ${key}:`, error);
      throw error;
    }
  }

  /**
   * 获取键值
   * @param {string} key - 键名
   * @returns {*} - 存储的值
   */
  async get(key) {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`[Redis] get失败 ${key}:`, error);
      throw error;
    }
  }

  /**
   * 删除键
   * @param {string} key - 键名
   */
  async del(key) {
    try {
      return await this.redis.del(key);
    } catch (error) {
      console.error(`[Redis] del失败 ${key}:`, error);
      throw error;
    }
  }

  // ========== 聊天记录操作 ==========

  /**
   * 添加聊天记录
   * @param {Object} message - 消息对象
   */
  async addChatMessage(message) {
    try {
      // 添加到聊天记录列表（左侧推入，最新的在前）
      await this.redis.lpush('slavebeasts:chat:history', JSON.stringify(message));
      // 只保留最近1000条记录
      await this.redis.ltrim('slavebeasts:chat:history', 0, 999);
      return true;
    } catch (error) {
      console.error('[Redis] 添加聊天记录失败:', error);
      throw error;
    }
  }

  /**
   * 获取聊天记录
   * @param {number} count - 获取数量，默认10
   * @returns {Array} - 消息数组
   */
  async getChatHistory(count = 10) {
    try {
      const messages = await this.redis.lrange('slavebeasts:chat:history', 0, count - 1);
      return messages.map(msg => JSON.parse(msg)).reverse();
    } catch (error) {
      console.error('[Redis] 获取聊天记录失败:', error);
      throw error;
    }
  }

  // ========== 全局任务操作 ==========

  /**
   * 设置任务
   * @param {string} taskId - 任务ID
   * @param {Object} task - 任务对象
   */
  async setTask(taskId, task) {
    try {
      return await this.redis.hset('slavebeasts:tasks', taskId, JSON.stringify(task));
    } catch (error) {
      console.error(`[Redis] 设置任务失败 ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * 获取任务
   * @param {string} taskId - 任务ID
   * @returns {Object} - 任务对象
   */
  async getTask(taskId) {
    try {
      const task = await this.redis.hget('slavebeasts:tasks', taskId);
      return task ? JSON.parse(task) : null;
    } catch (error) {
      console.error(`[Redis] 获取任务失败 ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * 获取所有任务
   * @returns {Array} - 任务数组
   */
  async getAllTasks() {
    try {
      const tasks = await this.redis.hgetall('slavebeasts:tasks');
      return Object.entries(tasks).map(([id, data]) => ({
        id,
        ...JSON.parse(data)
      }));
    } catch (error) {
      console.error('[Redis] 获取所有任务失败:', error);
      throw error;
    }
  }

  /**
   * 删除任务
   * @param {string} taskId - 任务ID
   */
  async deleteTask(taskId) {
    try {
      return await this.redis.hdel('slavebeasts:tasks', taskId);
    } catch (error) {
      console.error(`[Redis] 删除任务失败 ${taskId}:`, error);
      throw error;
    }
  }

  // ========== Agent状态批量获取 ==========

  /**
   * 获取所有Agent状态（用于看板）
   * @returns {Array} - Agent状态数组
   */
  async getAllAgentStatus() {
    const agents = ['ceo', 'cto', 'cro', 'coo', 'pm', 'qd'];
    const statuses = [];

    for (const agent of agents) {
      try {
        const status = await this.get(`slavebeasts:agent:${agent}:status`);
        if (status) {
          statuses.push(status);
        } else {
          // 返回默认状态
          statuses.push({
            name: agent,
            role: this.getAgentRole(agent),
            busy: false,
            currentTask: null,
            progress: 0,
            queueLength: 0,
            status: 'idle',
            updateTime: Date.now()
          });
        }
      } catch (error) {
        console.error(`[Redis] 获取Agent状态失败 ${agent}:`, error);
      }
    }

    return statuses;
  }

  /**
   * 获取Agent角色名
   * @param {string} agentName - Agent名称
   * @returns {string} - 角色名称
   */
  getAgentRole(agentName) {
    const roles = {
      ceo: '包工头',
      cto: '桥王',
      cro: '天文台',
      coo: '蛇头',
      pm: '驴仔',
      qd: '忍者神龟'
    };
    return roles[agentName] || agentName;
  }

  // ========== 工具方法 ==========

  /**
   * 清空所有数据（谨慎使用）
   */
  async flushAll() {
    try {
      await this.redis.flushdb();
      console.log('[Redis] 数据库已清空');
      return true;
    } catch (error) {
      console.error('[Redis] 清空数据库失败:', error);
      throw error;
    }
  }

  /**
   * 获取Redis连接状态
   */
  getConnectionStatus() {
    return {
      status: this.redis.status,
      options: {
        host: this.redis.options.host,
        port: this.redis.options.port,
        db: this.redis.options.db
      }
    };
  }
}

module.exports = new RedisClient();
module.exports.raw = redis;
