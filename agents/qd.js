/**
 * 忍者神龟 (QD)
 * 职责：从队列读取任务，需要 @qd 才接收消息
 */

const BaseAgent = require('./base');

class QDAgent extends BaseAgent {
  constructor() {
    super('qd', '忍者神龟');
    this.logger.info('忍者神龟已初始化');
  }

  // ==================== 消息处理 ====================

  onChatMessage(message) {
    if (this.isMentioned(message)) {
      this.handleAtMessage(message);
    }
  }

  async handleAtMessage(message) {
    if (message.sender == this.agentRole) return;
    let content = message.content || '';
    // 支持 @qd 和 @忍者神龟
    if (content.indexOf(`@${this.agentRole}`) === -1 || content.indexOf('【POV】') === 0 || !content.trim()) return;

    this.logger.info(`[${this.agentName}]收到任务: ${content}`);

    const redis = require('../utils/redis');
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      content,
      from: message.sender || '老细',
      to: 'qd',
      timestamp: Date.now(),
      status: 'pending'
    };

    await redis.lpush(`slavebeasts:agent:qd:queue`, task);
    this.logger.info(`任务已入队: ${task.id}`);
  }

  isMentioned(message) {
    const content = message.content || '';
    // 同时支持 @qd 和 @忍者神龟
    return content.includes('@qd') || content.includes('@忍者神龟');
  }
}

// ==================== 独立运行入口 ====================

async function main() {
  const agent = new QDAgent();

  process.on('SIGTERM', async () => {
    await agent.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await agent.shutdown();
    process.exit(0);
  });

  try {
    await agent.init();
  } catch (err) {
    agent.logger.error('启动失败:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = QDAgent;
