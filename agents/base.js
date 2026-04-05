/**
 * Agent 基类
 * 职责：连接 WebSocket、心跳、消息收发、Redis 操作
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const createLogger = require('../utils/logger');

class BaseAgent {
  constructor(agentName, agentRole) {
    this.location = process.env.location || "广东广州";
    this.agentName = agentName;
    this.agentRole = agentRole;

    this.busy = false;
    this.currentTask = null;
    this.progress = 0;
    this.status = 'idle';
    this.queue = [];
    this.hasQueue = true; // 是否有任务队列，CEO 设为 false

    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.MAX_RECONNECT = 30;

    this.logger = createLogger(agentName);
    this.logger.info(`Agent "${agentName}" (${agentRole}) 初始化，工作目录: ${this.workDir}`);
  }

  // ==================== 初始化 ====================

  async init() {
    this.logger.info(`[${this.agentName}]开始初始化...`);
    await this.connectWebSocket();
    await this.loadPrompt();
    await this.initSessionId();
    this.startHeartbeat();
    this.startProcessLoop();
    this.logger.info(`[${this.agentName}]初始化完成`);
  }

  async initSessionId() {
    const redis = require('../utils/redis');
    // 每次初始化时清空旧 session，用新会话（确保格式不会跑偏）
    await redis.redis.del(`slavebeasts:agent:${this.agentName}:session`);
    this.sessionId = null;
    this.logger.info(`[${this.agentName}]已清空旧 session，每次启动用新会话`);
  }

  async getSessionId() {
    const redis = require('../utils/redis');
    return await redis.get(`slavebeasts:agent:${this.agentName}:session`);
  }

  async saveSessionId(sessionId) {
    const redis = require('../utils/redis');
    if (!sessionId) return ;
    this.sessionId = sessionId;
    await redis.set(`slavebeasts:agent:${this.agentName}:session`, sessionId);
    this.logger.info(`[${this.agentName}]保存 session: ${sessionId}`);
  }

  // ==================== WebSocket 连接 ====================

  async connectWebSocket() {
    const wsUrl = `ws://localhost:3000/agent-connect?agent=${this.agentName}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.logger.info('WebSocket 连接成功');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.send({ type: 'online' });
        this.updateStatus();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (err) {
          this.logger.error('解析消息失败:', err);
        }
      });

      this.ws.on('close', () => {
        this.logger.warn('WebSocket 连接关闭');
        this.connected = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.logger.error('WebSocket 错误:', err);
      });

      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('WebSocket 连接超时'));
        }
      }, 10000);
    });
  }

  scheduleReconnect() {
    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.MAX_RECONNECT) {
      this.logger.error('重连次数超限，停止重连');
      process.exit(1);
      return;
    }
    const delay = Math.min(1000 * this.reconnectAttempts, 10000);
    this.logger.info(`${delay / 1000}秒后尝试重连...`);
    setTimeout(() => {
      this.connectWebSocket().catch(err => {
        this.logger.error('重连失败:', err);
      });
    }, delay);
  }

  // ==================== 消息处理 ====================

  handleMessage(message) {
    switch (message.type) {
      case 'heartbeat_ack':
        break;
      case 'board':
        this.onBoardUpdate(message.agents);
        break;
      case 'new_task':
        this.onNewTask(message.task, message.queueLength);
        break;
      case 'chat':
        this.onChatMessage(message);
        break;
      case 'cli_input':
        this.onCLIOutput(message.content);
        break;
      case 'system':
        this.logger.info(`[${this.agentName}]系统通知:${message.content}`);
        break;
      default:
        this.logger.info(`[${this.agentName}]收到未知消息:(${message.type})${message.content?message.content:''}`);
    }
  }

  onBoardUpdate(agents) {}
  onNewTask(task, queueLength) {}
  onChatMessage(message) {}
  onCLIOutput(content) {}

  // ==================== 任务循环 ====================

  startProcessLoop() {
    if (!this.hasQueue) return; // CEO 没有队列，不启动循环
    this.processLoopInterval = setInterval(async () => {
      if (!this.busy) {
        await this.processLoop();
      }
    }, 3000);
  }

  async processLoop() {
    // 默认：从队列取任务执行，子类可覆盖
    if (this.busy) return;

    const taskData = await this.peekTask();
    if (!taskData) return;

    const queueLength = await this.getQueueLength();
    this.logger.info(`[${this.agentName}] 发现 ${queueLength} 个待处理任务`);

    this.busy = true;
    this.currentTask = taskData;
    this.status = 'processing';
    this.progress = 0;
    await this.updateStatus();

    try {
      const task = await this.dequeueTask();
      if (task) {
        const taskObj = typeof task === 'string' ? JSON.parse(task) : task;
        const sessionId = await this.sendMessageToCLI(taskObj);
        this.saveSessionId(sessionId);
        this.logger.info(`[${this.agentName}] 任务完成`);
      }
    } catch (err) {
      this.logger.error(`[${this.agentName}] 任务执行失败:`, err);
      this.status = 'reject';
    }

    this.progress = 100;
    this.status = 'finish';
    this.busy = false;
    this.currentTask = null;
    await this.updateStatus();
  }

  async dequeueTask() {
    const redis = require('../utils/redis');
    return await redis.rpop(`slavebeasts:agent:${this.agentName}:queue`);
  }

  async peekTask() {
    const redis = require('../utils/redis');
    const tasks = await redis.redis.lrange(`slavebeasts:agent:${this.agentName}:queue`, -1, -1);
    if (tasks && tasks.length > 0) {
      return JSON.parse(tasks[0]);
    }
    return null;
  }

  async getQueueLength() {
    const redis = require('../utils/redis');
    return await redis.llen(`slavebeasts:agent:${this.agentName}:queue`);
  }

  // ==================== Claude CLI 执行 ====================

  async loadPrompt() {
    const promptPath = path.join(__dirname, '/../agents-prompt', `${this.agentName}.json`);
    if (fs.existsSync(promptPath)) {
      const json = JSON.parse(fs.readFileSync(promptPath, 'utf-8'));
      this.prompt = JSON.stringify(json);
      this.logger.info('已加载 prompt');
    } else {
      this.prompt = '';
    }
  }

  /**
   * 发送消息给 Claude CLI，返回响应文本
   */
  async sendMessageToCLI(message) {
    // 先获取 sessionid（在 Promise 外部）
    const currentSessionId = await this.getSessionId();

    return new Promise((resolve, reject) => {
      const msgContent = typeof message === 'string' ? message : message.content;
      if (!msgContent || !msgContent.trim()) {
        reject(new Error('消息内容为空'));
        return;
      }

      const args = [
        '--print', msgContent,
        '--tools', 'default',
        '--output-format', 'stream-json',
        // '--max-turns', "3",
        // '--dangerously-skip-permissions',
        "--append-system-prompt", `你所在地区是${this.location}`,
        '--verbose'
      ];

      // 带上 sessionid 恢复会话
      if (currentSessionId) {
        args.push('--resume', currentSessionId);
      }

      // 带上 prompt
      if (this.prompt) {
        args.push('--agents', this.prompt);
      } else {
        args.push('--agent', this.agentName)
      }

      this.logger.info(`[${this.agentName}] 启动 CLI: claude ${args.join(' ')}`);
      // this.logger.info(`[${this.agentName}] 启动 CLI 并发送: ${msgContent}, 类型: ${typeof msgContent}`);

      const cliProcess = spawn('claude', args, {
        cwd: this.workDir,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let newSessionId = null;
      let resultCount = 0;
      let errorOutput = '';
                                                                                                                                                                                                 
      cliProcess.stderr.on('data', (data) => {                                                                                                                                                                                                     
        const errorStr = data.toString();                                                                                                                                                                                                          
        this.logger.warn(`[${this.agentName}] CLI 警告输出: ${errorStr}`);                                                                                                                                                                        
        errorOutput += errorStr;                                                                                                                                                                                                                   
      }); 

      // 实时处理每一行输出
      cliProcess.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          resultCount++;
          this.logger.info(`[${this.agentName}] CLI 响应[${resultCount}]: ${line}`);

          try {
            const parsed = JSON.parse(line);

            if (parsed.type === 'assistant' && parsed.message?.type == 'message') {
              for (const item of parsed.message?.content || []) {
                if (item.type == 'text') {
                  // 实时发送到聊天室
                  this.sendChat(item.text);
                } 
                /* if (item.type == 'thinking') {
                  this.sendChat('【POV】' + item.thinking);
                } */
              }
            }

            // 退出
            if (parsed.type == 'result') {
              // 保存 session（Claude CLI 返回 session_id）
              if (parsed.session_id) {
                newSessionId = parsed.session_id;
              }                                                                                                                                                                                                                                          
              if (parsed.is_error == true) {                                                                                                                                                                                                             
                errorOutput = line.trim();                                                                                                                                                                                                               
                this.logger.info(`[${this.agentName}] CLI 出错退出`);                                                                                                                                                                                    
                cliProcess.kill();                                                                                                                                                                                                                       
                break;                                                                                                                                                                                                                                   
              }                                                                                                                                                                                                                                          
              // 只有终端状态是completed才是真的完成，否则只是单轮结束，继续等待                                                                                                                                                                         
              if (parsed.terminal_reason === 'completed') {                                                                                                                                                                                              
                this.logger.info(`[${this.agentName}] CLI 任务完成退出`);                                                                                                                                                                                
                cliProcess.kill();                                                                                                                                                                                                                       
                break;                                                                                                                                                                                                                                   
              }  
            }
          } catch (e) {
            // 非 JSON 行，忽略
            errorOutput = JSON.stringify(e);
          }
        }
      });

      cliProcess.on('close', (code) => {
        if (code === 0) {
          resolve(newSessionId);
        } else {
          this.logger.error(`CLI 异常退出: code=${code}, stderr=${errorOutput}`);
          reject(new Error(`CLI exited with code ${code}`));
        }
      });

      cliProcess.on('error', (err) => {
        this.logger.error('CLI 进程错误:', err);
        reject(err);
      });
    });
  }

  // ==================== 状态管理 ====================

  async updateStatus() {
    const redis = require('../utils/redis');
    const queueLength = await this.getQueueLength();
    const statusData = {
      name: this.agentName,
      role: this.agentRole,
      busy: this.busy,
      currentTask: this.currentTask ? (typeof this.currentTask === 'string' ? this.currentTask : this.currentTask.content) : null,
      progress: Math.round(this.progress),
      queueLength,
      status: this.status,
      updateTime: Date.now()
    };
    await redis.set(`slavebeasts:agent:${this.agentName}:status`, statusData);
    this.send({ type: 'status_update', data: statusData });
  }

  async updateProgress(progress, extraData = {}) {
    this.progress = progress;
    const redis = require('../utils/redis');
    const status = await redis.get(`slavebeasts:agent:${this.agentName}:status`);
    if (status) {
      status.progress = progress;
      status.status = this.status;
      status.updateTime = Date.now();
      await redis.set(`slavebeasts:agent:${this.agentName}:status`, status);
    }
    this.send({ type: 'progress_update', data: { progress, ...extraData } });
  }

  // ==================== 心跳 ====================

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'heartbeat', timestamp: Date.now() });
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ==================== 消息发送 ====================

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendChat(content) {
    this.send({
      type: 'chat',
      sender: this.agentRole,
      content,
      timestamp: Date.now()
    });
  }

  // ==================== 工具 ====================

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== 生命周期 ====================

  async shutdown() {
    this.logger.info('开始关闭...');
    this.stopHeartbeat();
    if (this.processLoopInterval) clearInterval(this.processLoopInterval);
    if (this.ws) this.ws.close();
    this.logger.info('关闭完成');
  }
}

module.exports = BaseAgent;
