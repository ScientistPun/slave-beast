/**
 * 天文台 Agent (CRO)
 */

const SlaveBase = require('./slave-base');

class CROAgent extends SlaveBase {
  constructor() {
    super('cro', '天文台');
  }

  async processTask(taskContent, userId) {
    if (this.isProcessing) {
      this.logger.info('任务排队中...');
      return;
    }

    this.isProcessing = true;

    try {
      const prompt = `【待审核内容】${taskContent}

请以天文台CRO的身份，对上述内容进行风险审核和可行性评估：
1. 风险点识别
2. 合规性检查
3. 可行性分析
4. 改进建议

请用港式粤语回复，保持严谨但接地气的风格。`;

      this.logger.info('等待 Claude CLI 响应...');
      const review = await this.sendToCLI(prompt);

      this.sendToServer({
        type: 'task_result',
        from: this.role,
        status: 'approved',
        review,
        taskContent,
        userId
      });

      this.sendToServer({ type: 'agent_reply', from: this.name, content: `${review}` });

    } catch (err) {
      this.logger.error('处理任务出错', { error: err.message });
      this.sendToServer({ type: 'task_error', from: this.role, error: err.message });
    }

    this.isProcessing = false;
  }
}

const agent = new CROAgent();
agent.setupErrorHandlers();
agent.init();
