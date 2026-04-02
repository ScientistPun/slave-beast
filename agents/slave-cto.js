/**
 * 桥王 Agent (CTO)
 */

const SlaveBase = require('./slave-base');

class CTOAgent extends SlaveBase {
  constructor() {
    super('cto', '桥王');
  }

  async processTask(taskContent, userId) {
    if (this.isProcessing) {
      this.logger.info('任务排队中...');
      return;
    }

    this.isProcessing = true;

    try {
      const prompt = `【任务】${taskContent}

请以桥王CTO的身份，设计完整的解决方案：
1. 方案概述
2. 技术路径
3. 实施步骤
4. 风险评估

请用港式粤语回复。`;

      this.logger.info('等待 Claude CLI 响应...');
      const result = await this.sendToCLI(prompt);

      this.sendToServer({
        type: 'task_result',
        from: this.role,
        result,
        taskContent,
        userId
      });

      this.sendToServer({ type: 'agent_reply', from: this.name, content: `${result}` });

    } catch (err) {
      this.logger.error('处理任务出错', { error: err.message });
      this.sendToServer({ type: 'task_error', from: this.role, error: err.message });
    }

    this.isProcessing = false;
  }
}

const agent = new CTOAgent();
agent.setupErrorHandlers();
agent.init();
