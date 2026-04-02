/**
 * 驴仔 Agent (PM)
 */

const SlaveBase = require('./slave-base');

class PMAgent extends SlaveBase {
  constructor() {
    super('pm', '驴仔');
  }

  async processTask(taskContent, userId) {
    if (this.isProcessing) {
      this.logger.info('任务排队中...');
      return;
    }

    this.isProcessing = true;

    try {
      const prompt = `【执行任务】${taskContent}

请以驴仔PM的身份，完成以下工作：
1. 落地步骤设计
2. 实施部署方案
3. 操作手册编写

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

const agent = new PMAgent();
agent.setupErrorHandlers();
agent.init();
