/**
 * 包工头 (CEO)
 * 职责：接收所有用户消息，直接发给 Claude 处理
 */

const BaseAgent = require('./base');

class CEOAgent extends BaseAgent {
  constructor() {
    super('ceo', '包工头');
    this.hasQueue = false; // CEO 没有队列，直接处理消息
    this.logger.info('包工头已初始化');
  }

  // ==================== 消息处理 ====================

  onChatMessage(message) {
    if (message.sender == this.agentRole) return;
    let content = message.content || '';
    
    // 支持 @包工头
    if (content.indexOf(`@${this.agentRole}`) === -1 || content.indexOf('【POV】') === 0 || !content.trim()) return;

    this.logger.info(`[${this.agentName}]收到[${message.sender}]消息: ${content}`);
    const sessionId = this.sendMessageToCLI({ content, from: message.sender || '老细' });
    this.saveSessionId(sessionId);
  }
}

// ==================== 独立运行入口 ====================

async function main() {
  const agent = new CEOAgent();

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

module.exports = CEOAgent;
