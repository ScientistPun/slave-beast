/**
 * 包工头 Agent (CEO)
 */

const SlaveBase = require('./slave-base');

// 闲聊关键词
const CHAT_KEYWORDS = ['你好', 'hi', 'hello', '早晨', '下午好', '谢谢', '多谢', 'ok', '哈哈', '拜拜', '嗨', '在吗', '食咗未', '最近点样', '听日见'];

// Agent 提及映射
const AGENT_MENTIONS = {
  '包工头': 'ceo', '桥王': 'cto', '天文台': 'cro',
  '蛇头': 'coo', '驴仔': 'pm', '忍者神龟': 'qd'
};

class CEOAgent extends SlaveBase {
  constructor() {
    super('ceo', '包工头');
  }

  async handleServerMessage(message) {
    const { type, content, userId } = message;

    if (type === 'user_message') {
      this.logger.info(`收到用户消息: ${content?.substring(0, 50)}`);

      const mentionedAgent = this.detectMention(content);

      if (mentionedAgent) {
        await this.handleDirectAssign(content, mentionedAgent, userId);
      } else if (this.isCasualChat(content)) {
        await this.handleCasualChat();
      } else {
        await this.startFullFlow(content, userId);
      }
    }

    // CEO also receives task results
    if (type === 'task_result') {
      this.isProcessing = false;
      this.logger.info('任务完成，恢复处理');
    }
  }

  detectMention(content) {
    for (const [name, role] of Object.entries(AGENT_MENTIONS)) {
      if (content.includes(`@${name}`) || content.includes(`@${name} `)) {
        return role;
      }
    }
    return null;
  }

  isCasualChat(content) {
    const lowerContent = content.toLowerCase();
    return CHAT_KEYWORDS.some(keyword => lowerContent.includes(keyword.toLowerCase()));
  }

  async handleCasualChat() {
    const responses = [
      '早晨老细！有咩吩咐？', '收到！有咩想搞嘅？', '明白，听朝想点？',
      '好嘞！有咩就尽管开口！', '系度！等紧你吩咐。', '老细，有咩就唔使客气，尽管开口！'
    ];
    await this.replyAsCEO(responses[Math.floor(Math.random() * responses.length)]);
  }

  async replyAsCEO(content) {
    this.sendToServer({ type: 'agent_reply', from: this.name, content });
  }

  async handleDirectAssign(content, agentRole, userId) {
    const taskContent = content.replace(/@[包工头桥王天文台蛇头驴仔忍者神龟]\s*/g, '').trim();

    if (!taskContent) {
      await this.replyAsCEO('你想我帮你分配咩任务？讲清楚啲啦！');
      return;
    }

    const agentNames = { ceo: '包工头', cto: '桥王', cro: '天文台', coo: '蛇头', pm: '驴仔', qd: '忍者神龟' };
    await this.replyAsCEO(`收到！我依家就叫${agentNames[agentRole]}帮你搞。`);

    this.sendToServer({ type: 'assign_task', from: this.role, to: agentRole, taskContent, userId });
  }

  async startFullFlow(taskContent, userId) {
    this.isProcessing = true;
    await this.replyAsCEO('收到！任务已安排，等我大包协调下先！');

    this.sendToServer({ type: 'assign_task', from: this.role, to: 'cto', taskContent, userId, flow: 'full' });
  }

  // Note: isProcessing should be reset when CEO receives task result from CTO
}

const agent = new CEOAgent();
agent.setupErrorHandlers();
agent.init();
