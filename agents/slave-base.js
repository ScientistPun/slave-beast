/**
 * Agent 基类 - 公共功能
 * 所有 slave-* Agent 都继承此类
 */

const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createLogger } = require('../utils/logger');

// CLI 超时时间
const CLI_TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT) || 60000;

/**
 * Agent 基类
 */
class SlaveBase {
  /**
   * @param {string} role - Agent 角色名
   * @param {string} name - Agent 显示名称
   */
  constructor(role, name) {
    this.role = role;
    this.name = name;
    this.logger = createLogger(name, role);

    this.ws = null;
    this.cliProcess = null;
    this.isProcessing = false;
    this.messageBuffer = '';
    this.pendingResolve = null;
    this.pendingReject = null;

    this.WS_URL = process.env.WS_URL || 'ws://localhost:8080';
    this.CLI_PATH = process.env.CLAUDE_CLI_PATH || 'claude';
  }

  /**
   * 连接到 WebSocket 服务器
   */
  connectWS() {
    this.ws = new WebSocket(this.WS_URL);

    this.ws.on('open', () => {
      this.logger.info('已连接到 WS 服务器');
      this.sendToServer({ type: 'agent_register', role: this.role, name: this.name });
    });

    this.ws.on('close', () => {
      this.logger.warn('WS 连接断开，5秒后重连...');
      setTimeout(() => this.connectWS(), 5000);
    });

    this.ws.on('error', (err) => {
      this.logger.error('WS 错误', { error: err.message });
    });

    this.ws.on('message', (data) => {
      this.handleServerMessage(JSON.parse(data.toString()));
    });
  }

  /**
   * 发送消息到服务器
   */
  sendToServer(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * 处理服务器消息 - 子类重写
   */
  async handleServerMessage(message) {
    const { type, taskContent, userId } = message;

    if (type === 'new_task') {
      this.logger.info(`收到任务: ${taskContent?.substring(0, 50)}`);
      try {
        await this.processTask(taskContent, userId);
      } catch (err) {
        this.logger.error('处理任务失败', { error: err.message });
      }
    }
  }

  /**
   * 处理任务 - 子类重写
   */
  async processTask(taskContent, userId) {
    this.logger.info('processTask 未被子类实现');
  }

  /**
   * 发送消息到 CLI
   */
  sendToCLI(message) {
    return new Promise((resolve, reject) => {
      if (!this.cliProcess) {
        reject(new Error('Claude CLI 未运行'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('发送消息超时'));
      }, CLI_TIMEOUT);

      this.pendingResolve = (response) => {
        clearTimeout(timeout);
        resolve(response);
      };
      this.pendingReject = reject;

      this.cliProcess.stdin.write(message + '\n');
    });
  }

  /**
   * 处理 CLI 输出
   */
  handleCLIOutput(output) {
    this.messageBuffer += output;

    if (output.includes('\n')) {
      const lines = this.messageBuffer.split('\n');
      this.messageBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() && this.pendingResolve) {
          this.pendingResolve(line.trim());
          this.pendingResolve = null;
          this.pendingReject = null;
        }
      }
    }
  }

  /**
   * 启动 Claude CLI
   */
  async startCLI() {
    return new Promise((resolve, reject) => {
      this.logger.info('启动 Claude CLI...');

      // 使用 --print 每次任务新建进程
      this.cliProcess = spawn(this.CLI_PATH, [
        'chat',
        '--print',
        '--agent', `slave-${this.role}`
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.cliProcess.stdout.on('data', (data) => {
        this.handleCLIOutput(data.toString());
      });

      this.cliProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) this.logger.debug(`CLI stderr: ${msg}`);
      });

      this.cliProcess.on('close', (code) => {
        this.logger.warn(`Claude CLI 退出，代码: ${code}`);
        this.cliProcess = null;
      });

      this.cliProcess.on('error', (err) => {
        this.logger.error(`Claude CLI 错误: ${err.message}`);
        reject(err);
      });

      // 等待 CLI 启动
      setTimeout(() => {
        this.logger.info('Claude CLI 已就绪');
        resolve();
      }, 2000);
    });
  }

  /**
   * 初始化 - 子类重写
   */
  async init() {
    this.logger.info('===========================================');
    this.logger.info(`  ${this.name} Agent 启动中...`);
    this.logger.info('===========================================');

    try {
      this.connectWS();
      await this.startCLI();
      this.logger.info(`${this.name} Agent 初始化完成`);
    } catch (err) {
      this.logger.error('初始化失败', { error: err.message });
      setTimeout(() => this.init(), 5000);
    }
  }

  /**
   * 错误处理
   */
  setupErrorHandlers() {
    process.on('uncaughtException', (err) => {
      this.logger.error('未捕获异常', { error: err.message, stack: err.stack });
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.error('未处理的Promise拒绝', { reason });
    });

    process.on('SIGTERM', () => {
      if (this.cliProcess) this.cliProcess.kill();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      if (this.cliProcess) this.cliProcess.kill();
      process.exit(0);
    });
  }
}

module.exports = SlaveBase;
