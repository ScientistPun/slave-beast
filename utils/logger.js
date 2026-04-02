/**
 * 日志工具模块
 * 为每个Agent提供独立的日志记录功能
 * 日志同时输出到终端和文件
 */

const fs = require('fs');
const path = require('path');

// 日志目录
const LOG_DIR = path.join(__dirname, '..', 'logs');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 创建日志器实例
 * @param {string} agentName - Agent名称
 * @param {string} agentRole - Agent角色
 */
function createLogger(agentName, agentRole) {
  const logFile = path.join(LOG_DIR, `${agentRole}.log`);
  const errorFile = path.join(LOG_DIR, `${agentRole}_error.log`);

  /**
   * 格式化日志消息
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {Object} data - 额外数据
   */
  function formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    let logMsg = `[${timestamp}] [${level.toUpperCase()}] [${agentName}] ${message}`;
    if (data) {
      logMsg += ` ${JSON.stringify(data)}`;
    }
    return logMsg;
  }

  /**
   * 写入日志文件
   * @param {string} file - 文件路径
   * @param {string} content - 日志内容
   */
  function writeToFile(file, content) {
    fs.appendFile(file, content + '\n', (err) => {
      if (err) console.error('日志写入失败:', err);
    });
  }

  return {
    /**
     * 普通日志
     */
    info(message, data) {
      const formatted = formatMessage('info', message, data);
      console.log(formatted);
      writeToFile(logFile, formatted);
    },

    /**
     * 警告日志
     */
    warn(message, data) {
      const formatted = formatMessage('warn', message, data);
      console.warn(formatted);
      writeToFile(logFile, formatted);
    },

    /**
     * 错误日志
     */
    error(message, data) {
      const formatted = formatMessage('error', message, data);
      console.error(formatted);
      writeToFile(logFile, formatted);
      writeToFile(errorFile, formatted);
    },

    /**
     * 调试日志
     */
    debug(message, data) {
      if (process.env.DEBUG) {
        const formatted = formatMessage('debug', message, data);
        console.log(formatted);
        writeToFile(logFile, formatted);
      }
    },

    /**
     * 任务开始日志
     */
    taskStart(taskId, taskName) {
      this.info(`任务开始: ${taskName}`, { taskId });
    },

    /**
     * 任务完成日志
     */
    taskComplete(taskId, taskName, result) {
      this.info(`任务完成: ${taskName}`, { taskId, result });
    },

    /**
     * 任务失败日志
     */
    taskFail(taskId, taskName, error) {
      this.error(`任务失败: ${taskName}`, { taskId, error });
    },

    /**
     * 队列状态日志
     */
    queueStatus(currentTask, queueLength) {
      this.info(`状态更新`, {
        currentTask: currentTask || '无',
        queueLength
      });
    },

    /**
     * 获取日志文件路径
     */
    getLogFile() {
      return logFile;
    }
  };
}

/**
 * 系统日志器（用于主进程）
 */
const systemLogger = createLogger('System', 'system');

/**
 * 清理旧日志（保留最近N天）
 * @param {number} days - 保留天数
 */
function cleanOldLogs(days = 7) {
  const now = Date.now();
  const maxAge = days * 24 * 60 * 60 * 1000;

  fs.readdirSync(LOG_DIR).forEach(file => {
    if (file.endsWith('.log')) {
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`[Logger] 已删除过期日志: ${file}`);
      }
    }
  });
}

module.exports = {
  createLogger,
  systemLogger,
  cleanOldLogs
};
