/**
 * 忍者神龟 Agent (QD)
 */

const SlaveBase = require('./slave-base');

class QDAgent extends SlaveBase {
  constructor() {
    super('qd', '忍者神龟');
  }

  async processTask(taskContent, userId) {
    if (this.isProcessing) {
      this.logger.info('任务排队中...');
      return;
    }

    this.isProcessing = true;

    try {
      const prompt = `【质量把控任务】${taskContent}

请以忍者神龟QD的身份，进行质量把控和落地实施：
1. 成果质量检查
2. 风险点排查
3. 最终审核
4. 优化建议

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

const agent = new QDAgent();
agent.setupErrorHandlers();
agent.init();
