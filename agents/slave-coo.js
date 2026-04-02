/**
 * 蛇头 Agent (COO)
 */

const SlaveBase = require('./slave-base');

class COOAgent extends SlaveBase {
  constructor() {
    super('coo', '蛇头');
  }

  async processTask(taskContent, userId) {
    if (this.isProcessing) {
      this.logger.info('任务排队中...');
      return;
    }

    this.isProcessing = true;

    try {
      const prompt = `【待统筹内容】${taskContent}

请以蛇头COO的身份，统筹协调各方资源：
1. 任务分解
2. 责任分配
3. 时间规划
4. 协调要点

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

const agent = new COOAgent();
agent.setupErrorHandlers();
agent.init();
