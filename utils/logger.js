const winston = require('winston');
const fs = require('fs');
const path = require('path');

// 确保logs目录存在
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// 清空指定 agent 的日志文件
function clearLog(agentName) {
  // 移除可能存在的.log后缀，避免重复拼接
  const cleanName = agentName.endsWith('.log') ? agentName.slice(0, -4) : agentName;
  const logFile = path.join(logsDir, `${cleanName}.log`);
  if (fs.existsSync(logFile)) {
    // 只清空文件内容，不删除文件（保持文件句柄）
    fs.writeFileSync(logFile, '', 'utf-8');
    return true;
  }
  return false;
}

// 清空所有 agent 的日志
function clearAllLogs() {
  const results = [];
  if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir);
    for (const file of files) {
      if (file.endsWith('.log')) {
        const filePath = path.join(logsDir, file);
        fs.writeFileSync(filePath, '', 'utf-8');
        results.push(file);
      }
    }
  }
  return results;
}

// 获取所有日志文件列表
function getLogFiles() {
  if (!fs.existsSync(logsDir)) {
    return [];
  }
  return fs.readdirSync(logsDir)
    .filter(f => f.endsWith('.log'))
    .map(f => ({
      name: f,
      path: path.join(logsDir, f),
      size: fs.statSync(path.join(logsDir, f)).size
    }));
}

// 创建Logger实例的工厂函数
function createLogger(agentName) {
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.printf(({ timestamp, level, message, stack }) => {
        const logMessage = `[${timestamp}] [${agentName}] [${level.toUpperCase()}]: ${message}`;
        return stack ? `${logMessage}\n${stack}` : logMessage;
      })
    ),
    transports: [
      // 输出到控制台
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, stack }) => {
            const logMessage = `[${timestamp}] [${agentName}] [${level.toUpperCase()}]: ${message}`;
            return stack ? `${logMessage}\n${stack}` : logMessage;
          })
        )
      }),
      // 输出到文件
      new winston.transports.File({
        filename: path.join(logsDir, `${agentName}.log`),
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        tailable: true
      })
    ]
  });

  // 给 logger 添加清空自身日志的方法
  logger.clearLog = () => clearLog(agentName);

  return logger;
}

module.exports = createLogger;
module.exports.clearLog = clearLog;
module.exports.clearAllLogs = clearAllLogs;
module.exports.getLogFiles = getLogFiles;
