/**
 * 驴仔 (PM)
 * 职责：从队列读取任务，需要 @pm 才接收消息
 */

const BaseAgent = require('./base');

class PMAgent extends BaseAgent {
  constructor() {
    super('pm', '驴仔');
    this.logger.info('驴仔已初始化');
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
    // 支持 @pm 和 @驴仔
    if (content.indexOf(`@${this.agentRole}`) === -1 || content.indexOf('【POV】') === 0 || !content.trim()) return;

    this.logger.info(`[${this.agentName}]收到任务: ${content}`);

    const redis = require('../utils/redis');
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      content,
      from: message.sender || '老细',
      to: 'pm',
      timestamp: Date.now(),
      status: 'pending'
    };

    await redis.lpush(`slavebeasts:agent:pm:queue`, task);
    this.logger.info(`任务已入队: ${task.id}`);
  }

  isMentioned(message) {
    const content = message.content || '';
    // 同时支持 @pm 和 @驴仔
    return content.includes('@pm') || content.includes('@驴仔');
  }
}

// ==================== 独立运行入口 ====================

async function main() {
  const agent = new PMAgent();

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

module.exports = PMAgent;
