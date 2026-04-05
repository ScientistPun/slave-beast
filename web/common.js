/**
 * 公共 JavaScript
 * 奴隶兽多Agent调度系统 - 公用方法
 * 提供WebSocket通信、消息显示、Agent状态管理等核心功能
 * PC端和移动端共用此文件
 */

// ==================== 配置与常量 ====================

/** WebSocket连接地址，根据当前页面host自动构建 */
const WS_URL = `ws://${window.location.host || 'localhost:3000'}`;

// ==================== 运行时状态 ====================

/** WebSocket实例 */
let ws = null;

/** 连接状态标志 */
let isConnected = false;

/** 重连尝试次数 */
let reconnectAttempts = 0;

/** 最大重连次数 */
const MAX_RECONNECT_ATTEMPTS = 10;

// ==================== 心跳状态 ====================

/** 心跳定时器ID */
let heartbeatInterval = null;

/** 最后心跳确认时间戳 */
let lastHeartbeatAck = 0;

/** 心跳状态：connected | disconnected */
let heartbeatStatus = 'disconnected';

// ==================== Agent配置 ====================

/**
 * Agent配置映射
 * 中文名作为key，方便@提及匹配
 */
const AGENTS = {
  '包工头': { name: '包工头', role: 'ceo', avatar: 'face/ceo.png', color: '#EF4444' },
  '桥王': { name: '桥王', role: 'cto', avatar: 'face/cto.png', color: '#F59E0B' },
  '天文台': { name: '天文台', role: 'cro', avatar: 'face/cro.png', color: '#10B981' },
  '蛇头': { name: '蛇头', role: 'coo', avatar: 'face/coo.png', color: '#3B82F6' },
  '驴仔': { name: '驴仔', role: 'pm', avatar: 'face/pm.png', color: '#8B5CF6' },
  '忍者神龟': { name: '忍者神龟', role: 'qd', avatar: 'face/qd.png', color: '#EC4899' }
};

/** 中文名到role的反向映射，用于快速查找Agent角色 */
const AGENT_NAME_TO_ROLE = {
  '包工头': 'ceo',
  '桥王': 'cto',
  '天文台': 'cro',
  '蛇头': 'coo',
  '驴仔': 'pm',
  '忍者神龟': 'qd'
};

/** Agent状态对应的颜色值 */
const STATUS_COLORS = {
  idle: '#22C55E',
  processing: '#3B82F6',
  finish: '#6B7280',
  reject: '#EF4444',
  busy: '#F59E0B',
  error: '#EF4444',
  offline: '#9CA3AF'
};

/** Agent状态对应的中文显示文本 */
const STATUS_TEXTS = {
  idle: '空闲',
  processing: '执行中',
  finish: '已完成',
  reject: '已驳回',
  busy: '忙碌',
  error: '错误',
  offline: '离线',
  queued: '排队中'
};

/** 默认头像路径 */
const DEFAULT_AVATAR = 'face/boss.png';

/** 已显示消息的ID集合，用于防止重复显示同一条消息 */
const displayedMessages = new Set();

/** Agent状态缓存，用于减少不必要的DOM更新 */
const agentStatusCache = {};

/** 正在输入中的Agent集合，防止重复显示多个指示器 */
const typingAgents = new Set();

// ==================== WebSocket 管理 ====================

/**
 * 初始化WebSocket连接
 * @param {Function} onConnected - 连接成功后的回调函数
 */
function initWebSocket(onConnected) {
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      isConnected = true;
      reconnectAttempts = 0;
      lastHeartbeatAck = Date.now();
      heartbeatStatus = 'connected';
      updateConnectionStatus(true);
      startHeartbeat();
      if (onConnected) onConnected();
    };

    ws.onclose = () => {
      isConnected = false;
      heartbeatStatus = 'disconnected';
      stopHeartbeat();
      updateConnectionStatus(false);

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * reconnectAttempts, 10000);
        addSystemMessage('连接断开，' + (delay / 1000) + '秒后重试...');
        setTimeout(() => initWebSocket(onConnected), delay);
      } else {
        addSystemMessage('连接失败，请刷新页面重试');
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket 错误:', error);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleMessage(message);
      } catch (err) {
        console.error('解析消息错误:', err);
      }
    };
  } catch (error) {
    console.error('初始化WebSocket失败:', error);
  }
}

/**
 * 启动心跳机制
 * 每30秒向服务器发送一次心跳，维持连接活跃
 */
function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
      stopHeartbeat();
      return;
    }
    ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
    lastHeartbeatAck = Date.now();
  }, 30000);
}

/**
 * 停止心跳机制
 */
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * 更新页面上的连接状态显示
 * @param {boolean} connected - 是否已连接
 */
function updateConnectionStatus(connected) {
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionText');
  if (dot) {
    if (connected) {
      dot.classList.add('connected');
    } else {
      dot.classList.remove('connected');
    }
  }
  if (text) {
    text.textContent = connected ? '已连接' : '连接中...';
  }
}

// ==================== 消息发送 ====================

/**
 * 发送聊天消息
 * 解析@指令，提取目标Agent，显示正在输入指示器
 * @param {string} content - 消息内容
 * @param {HTMLElement} [messageArea] - 可选，消息显示区域容器
 */
function sendMessage(content, messageArea) {
  if (!isConnected || !content.trim()) return;

  const trimmedContent = content.trim();
  let mentionedAgent = null;

  // 解析@指令
  if (trimmedContent.startsWith('@')) {
    const match = trimmedContent.match(/^@(\S+)\s+(.+)$/);
    if (!match) {
      addSystemMessage('@指令格式：@中文名 任务内容', messageArea);
      return;
    }
    const agentName = match[1];
    if (!AGENTS[agentName]) {
      const available = Object.keys(AGENTS).join('、');
      addSystemMessage('未知Agent "' + agentName + '"，可用：' + available, messageArea);
      return;
    }
    mentionedAgent = agentName;
  }

  const message = {
    type: 'chat',
    sender: '老细',
    content: trimmedContent,
    timestamp: Date.now()
  };

  document.getElementById('chatInput').value = '';

  ws.send(JSON.stringify(message));

  const msgId = message.timestamp + '_' + message.sender;
  addChatMessage(message.sender, message.content, message.timestamp, DEFAULT_AVATAR, msgId, messageArea);

  // 如果是@指令，显示目标Agent的正在输入指示器
  if (mentionedAgent) {
    showTypingIndicator(mentionedAgent, messageArea);
  }
}

// ==================== 消息显示 ====================

/**
 * 添加聊天消息到界面
 * 自动区分PC端和移动端HTML结构，防止重复显示
 * @param {string} sender - 发送者名称
 * @param {string} content - 消息内容
 * @param {number} timestamp - 时间戳
 * @param {string} avatar - 头像路径
 * @param {string} msgId - 消息唯一ID，用于去重
 * @param {HTMLElement} [messageArea] - 可选，消息显示区域容器
 */
function addChatMessage(sender, content, timestamp, avatar, msgId, messageArea) {
  // 防止重复显示
  if (msgId && displayedMessages.has(msgId)) return;
  if (!messageArea) messageArea = document.getElementById('chatArea');
  if (!messageArea) return;
  if (msgId) {
    displayedMessages.add(msgId);
    // 超过1000条时清理旧消息
    if (displayedMessages.size > 1000) {
      const oldMsg = displayedMessages.values().next().value;
      displayedMessages.delete(oldMsg);
    }
  }

  const isUser = sender === '老细';
  const avatarPath = avatar || (isUser ? DEFAULT_AVATAR : getAgentAvatar(sender));
  const role = getAgentRole(sender);
  const senderHtml = isUser ? '' : '<div class="sender" data-role="' + role + '">' + escapeHtml(sender) + '</div>';

  const row = document.createElement('div');
  row.className = isUser ? 'message-row user' : 'message-row agent';

  const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const formattedContent = formatContent(content);

  // PC端结构：头像在外层wrapper中
  const pcMessageHtml =
    '<div class="avatar-wrapper">' +
      '<img class="message-avatar" src="' + avatarPath + '" alt="' + sender + '" onerror="this.src=\'' + DEFAULT_AVATAR + '\'">' +
    '</div>' +
    '<div class="message">' +
      senderHtml +
      '<div class="message-bubble">' +
        '<div class="content">' + formattedContent + '</div>' +
        '<div class="time">' + time + '</div>' +
      '</div>' +
    '</div>';

  // 移动端结构：头像直接放置
  const mobileMessageHtml =
    '<img class="avatar" src="' + avatarPath + '" alt="' + sender + '" onerror="this.src=\'' + DEFAULT_AVATAR + '\'">' +
    '<div class="message">' +
      senderHtml +
      '<div class="message-bubble">' +
        '<div class="content">' + formattedContent + '</div>' +
        '<div class="time">' + time + '</div>' +
      '</div>' +
    '</div>';

  // 根据容器ID判断使用哪种结构
  if (messageArea && messageArea.id === 'chatArea') {
    row.innerHTML = mobileMessageHtml;
  } else {
    row.innerHTML = pcMessageHtml;
  }

  if (messageArea) {
    messageArea.appendChild(row);
  } else {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.appendChild(row);
  }
  scrollToBottom(messageArea);
}

/**
 * 添加系统消息到界面
 * 系统消息样式与普通消息不同，无头像，居中显示
 * @param {string} content - 系统消息内容
 * @param {HTMLElement} [messageArea] - 可选，消息显示区域容器
 */
function addSystemMessage(content, messageArea) {
  const row = document.createElement('div');
  row.className = 'message-row system';
  row.innerHTML = '<div class="message-bubble"><div class="content">' + escapeHtml(content) + '</div></div>';

  if (messageArea) {
    messageArea.appendChild(row);
  } else {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.appendChild(row);
  }
  scrollToBottom(messageArea);
}

/**
 * 将聊天区域滚动到底部
 * 用于新消息到达时自动滚动
 * @param {HTMLElement} [messageArea] - 可选，消息显示区域容器
 */
function scrollToBottom(messageArea) {
  if (messageArea) {
    setTimeout(() => { messageArea.scrollTop = messageArea.scrollHeight; }, 10);
    return;
  }
  const chatArea = document.getElementById('chatArea');
  const chatMessages = document.getElementById('chatMessages');
  const container = chatArea || chatMessages;
  if (container) {
    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 10);
  }
}

// ==================== 工具函数 ====================

/**
 * HTML转义，防止XSS攻击
 * @param {string} text - 原始文本
 * @returns {string} 转义后的HTML安全文本
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 格式化消息内容
 * 高亮@提及和「」包裹的文本
 * @param {string} content - 原始消息内容
 * @returns {string} 格式化后的HTML
 */
function formatContent(content) {
  if (!content) return '';
  let formatted = escapeHtml(content);
  formatted = formatted.replace(/@(\S+)/g, '<span class="at-mention">@$1</span>');
  formatted = formatted.replace(/「([^」]+)」/g, '<strong>「$1」</strong>');
  return formatted;
}

/**
 * 根据发送者名称获取Agent头像
 * @param {string} sender - 发送者名称
 * @returns {string} 头像路径
 */
function getAgentAvatar(sender) {
  const agent = AGENTS[sender];
  return agent ? agent.avatar : DEFAULT_AVATAR;
}

/**
 * 根据发送者名称获取Agent角色
 * @param {string} sender - 发送者名称
 * @returns {string} 角色标识符（如ceo, cto等）
 */
function getAgentRole(sender) {
  return AGENT_NAME_TO_ROLE[sender] || '';
}

// ==================== 正在输入指示器 ====================

/**
 * 显示Agent正在输入的动画指示器
 * 发送@指令后触发，Agent回复后自动消失
 * @param {string} agentName - Agent中文名
 * @param {HTMLElement} [messageArea] - 可选，消息显示区域容器
 */
function showTypingIndicator(agentName, messageArea) {
  if (typingAgents.has(agentName)) return;
  typingAgents.add(agentName);

  // 根据容器类型选择不同的HTML结构
  const isMobile = messageArea?.id === 'chatArea' || (!messageArea && document.getElementById('chatArea'));

  const row = document.createElement('div');
  row.className = 'message-row agent typing-row';
  row.id = 'typing-' + agentName;

  if (isMobile) {
    // 移动端结构
    row.innerHTML =
      '<img class="avatar" src="' + getAgentAvatar(agentName) + '" alt="' + agentName + '" onerror="this.src=\'' + DEFAULT_AVATAR + '\'">' +
      '<div class="message">' +
        '<div class="sender" data-role="' + getAgentRole(agentName) + '">' + agentName + '</div>' +
        '<div class="message-bubble typing-bubble">' +
          '<span class="typing-text">正在输入中</span>' +
          '<div class="typing-dots"><span></span><span></span><span></span></div>' +
        '</div>' +
      '</div>';
  } else {
    // PC端结构
    row.innerHTML =
      '<div class="avatar-wrapper">' +
        '<img class="message-avatar" src="' + getAgentAvatar(agentName) + '" alt="' + agentName + '" onerror="this.src=\'' + DEFAULT_AVATAR + '\'">' +
      '</div>' +
      '<div class="message">' +
        '<div class="sender" data-role="' + getAgentRole(agentName) + '">' + agentName + '</div>' +
        '<div class="message-bubble typing-bubble">' +
          '<span class="typing-text">正在输入中</span>' +
          '<div class="typing-dots"><span></span><span></span><span></span></div>' +
        '</div>' +
      '</div>';
  }

  const container = messageArea || getMessageArea();
  if (container) {
    container.appendChild(row);
    scrollToBottom(container);
  }
}

/**
 * 隐藏Agent正在输入的动画指示器
 * Agent回复消息时自动调用
 * @param {string} agentName - Agent中文名
 */
function hideTypingIndicator(agentName) {
  if (!typingAgents.has(agentName)) return;
  typingAgents.delete(agentName);

  // 从正确的容器中移除
  const container = getMessageArea();
  if (container) {
    const row = container.querySelector('#typing-' + agentName);
    if (row) row.remove();
  }
}

// ==================== 消息处理 ====================

/**
 * 获取当前页面的消息显示区域
 * 优先返回chatArea（移动端），其次返回chatMessages（PC端）
 * @returns {HTMLElement|null} 消息显示区域容器
 */
function getMessageArea() {
  const chatMessages = document.getElementById('chatMessages');
  const chatArea = document.getElementById('chatArea');
  return chatArea || chatMessages;
}

/**
 * 处理来自WebSocket的所有消息
 * 根据消息类型分发到不同的处理函数
 * @param {Object} message - 解析后的消息对象
 */
function handleMessage(message) {
  const messageArea = getMessageArea();

  switch (message.type) {
    case 'system':
      // 过滤掉agent_online_update消息，避免刷屏
      if (message.content && message.content.startsWith('agent_online_update')) return;
      addSystemMessage(message.content, messageArea);
      break;

    case 'chat':
      const sender = message.sender || '系统';
      const msgId = message.timestamp + '_' + sender;
      const avatar = sender === '老细' ? DEFAULT_AVATAR : getAgentAvatar(sender);

      // Agent回复时隐藏正在输入指示器
      if (sender !== '老细' && sender !== '系统') {
        hideTypingIndicator(sender);
      }

      addChatMessage(sender, message.content, message.timestamp, avatar, msgId, messageArea);
      break;

    case 'history':
      loadChatHistory(message.messages);
      break;

    case 'board':
      updateAgentStatusFromBoard(message.agents);
      break;

    case 'agent_update':
      updateSingleAgent(message.data);
      break;

    case 'history_cleared':
      clearChatMessages();
      addSystemMessage('聊天记录已清空', messageArea);
      break;

    case 'log_list':
      showLogModal(message.files);
      break;

    case 'logs_cleared':
      addSystemMessage(message.message, messageArea);
      break;

    case 'log_cleared':
      if (message.success) {
        addSystemMessage('已清空 ' + message.agentName + ' 日志', messageArea);
      } else {
        addSystemMessage('清空日志失败: ' + message.message, messageArea);
      }
      break;

    default:
      console.log('未知消息类型:', message.type);
  }
}

/**
 * 清空所有聊天消息
 * 同时清空PC端和移动端的消息区域
 */
function clearChatMessages() {
  const chatMessages = document.getElementById('chatMessages');
  const chatArea = document.getElementById('chatArea');
  const emptyState = '<div class="empty-state" id="emptyState"><span class="icon">💬</span><p>暂无消息</p><p style="font-size:0.75rem;">输入@指令开始对话</p></div>';

  if (chatMessages) chatMessages.innerHTML = '';
  if (chatArea) chatArea.innerHTML = emptyState;
  displayedMessages.clear();
}

/**
 * 加载并显示聊天历史记录
 * @param {Array} messages - 历史消息数组
 */
function loadChatHistory(messages) {
  clearChatMessages();
  displayedMessages.clear();

  if (!messages || messages.length === 0) return;

  // PC端使用 chatMessages，移动端使用 chatArea
  const messageArea = document.getElementById('chatArea') || document.getElementById('chatMessages');
  if (!messageArea) return;

  // 清空空状态
  messageArea.innerHTML = '';

  messages.forEach(msg => {
      const sender = msg.sender || '系统';
      const msgId = msg.timestamp + '_' + sender;
      const avatar = sender === '老细' ? DEFAULT_AVATAR : getAgentAvatar(sender);
      addChatMessage(sender, msg.content, msg.timestamp, avatar, msgId, messageArea);
  });
}

// ==================== 请求方法 ====================

/**
 * 请求服务器发送聊天历史记录
 */
function requestHistory() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'get_history' }));
  }
}

/**
 * 请求服务器清空聊天历史记录
 */
function requestClearHistory() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear_history' }));
  }
}

/**
 * 请求服务器清空所有日志文件
 */
function requestClearAllLogs() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear_all_logs' }));
  }
}

/**
 * 请求服务器发送日志文件列表
 */
function requestLogList() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'get_log_list' }));
  }
}

// ==================== 确认弹窗 ====================

/**
 * 显示确认弹窗
 * @param {string} title - 弹窗标题
 * @param {string} message - 确认消息内容
 * @param {Function} onConfirm - 确认按钮回调函数
 */
function showConfirmModal(title, message, onConfirm) {
  let modal = document.getElementById('confirmModal');
  let modalTitle = document.getElementById('confirmModalTitle');
  let modalMessage = document.getElementById('confirmModalMessage');
  let confirmBtn = document.getElementById('confirmModalBtn');
  let cancelBtn = document.getElementById('confirmModalCancel');

  // 如果弹窗不存在，动态创建
  if (!modal) {
    const modalHtml =
      '<div class="modal-overlay confirm-modal" id="confirmModal">' +
        '<div class="modal-content">' +
          '<h3 id="confirmModalTitle"></h3>' +
          '<p id="confirmModalMessage" style="margin: 16px 0; color: var(--text-secondary);"></p>' +
          '<div style="display: flex; gap: 10px;">' +
            '<button class="modal-btn" id="confirmModalCancel" style="flex:1; background: var(--bg-main);">取消</button>' +
            '<button class="modal-btn confirm" id="confirmModalBtn" style="flex:1; background: #EF4444; color: white;">确定</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    modal = document.getElementById('confirmModal');
    cancelBtn = document.getElementById('confirmModalCancel');
    confirmBtn = document.getElementById('confirmModalBtn');

    // 绑定取消事件
    cancelBtn?.addEventListener('click', closeConfirmModal);
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closeConfirmModal();
    });
  }

  modalTitle = document.getElementById('confirmModalTitle');
  modalMessage = document.getElementById('confirmModalMessage');
  confirmBtn = document.getElementById('confirmModalBtn');

  modalTitle.textContent = title;
  modalMessage.textContent = message;

  // 绑定确认事件
  confirmBtn.onclick = () => {
    closeConfirmModal();
    if (onConfirm) onConfirm();
  };

  modal.classList.add('active');
}

/**
 * 关闭确认弹窗
 */
function closeConfirmModal() {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.classList.remove('active');
}

// ==================== 日志弹窗 ====================

/**
 * 显示日志文件选择弹窗
 * @param {Array} files - 日志文件列表，每个元素包含name和size
 */
function showLogModal(files) {
  const modal = document.getElementById('logModal');
  const list = document.getElementById('logList');

  if (!modal || !list) return;

  list.innerHTML = '';

  if (!files || files.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:20px;">暂无日志文件</p>';
  } else {
    files.forEach(file => {
      const btn = document.createElement('button');
      btn.className = 'modal-btn';
      btn.textContent = file.name + ' (' + formatFileSize(file.size) + ')';
      btn.onclick = function() {
        clearLog(file.name);
        closeLogModal();
      };
      list.appendChild(btn);
    });
  }

  modal.classList.add('active');
}

/**
 * 关闭日志文件选择弹窗
 */
function closeLogModal() {
  const modal = document.getElementById('logModal');
  if (modal) modal.classList.remove('active');
}

/**
 * 请求服务器清空指定Agent的日志文件
 * @param {string} agentName - Agent名称
 */
function clearLog(agentName) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear_log', agentName: agentName }));
  }
}

/**
 * 格式化文件大小为人类可读字符串
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小字符串
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==================== Agent状态更新 ====================

/**
 * 从看板数据批量更新所有Agent状态
 * @param {Array} agents - Agent状态数组
 */
function updateAgentStatusFromBoard(agents) {
  if (!agents || !Array.isArray(agents)) return;

  const statusData = {};
  agents.forEach(agent => {
    if (agent) {
      const key = agent.role || agent.name;
      if (key) statusData[key] = agent;
    }
  });

  updateAgentStatus(statusData);
}

/**
 * 更新Agent状态显示（PC端看板）
 * @param {Object} statusData - Agent状态数据映射
 */
function updateAgentStatus(statusData) {
  const agentList = document.getElementById('agentList');
  for (const [name, agent] of Object.entries(AGENTS)) {
    const role = agent.role;
    const status = statusData[role];
    const existingEl = document.querySelector('[data-agent="' + role + '"]');

    if (existingEl) {
      updateAgentElement(existingEl, name, status);
    } else if (agentList) {
      const agentEl = createAgentElement(role, agent, status);
      agentList.appendChild(agentEl);
    }
  }

  updateMobileAgentChips(statusData);
}

/**
 * 更新移动端Agent状态芯片显示
 * 同时更新 agentStatusCache，保证弹窗显示正确信息
 * @param {Object} statusData - Agent状态数据映射
 */
function updateMobileAgentChips(statusData) {
  const agentBar = document.getElementById('agentBar');

  for (const [name, agent] of Object.entries(AGENTS)) {
    const role = agent.role;
    const status = statusData[role];
    const isOnline = !status || status.online !== false;

    // 更新缓存（供移动端弹窗使用）
    const cached = agentStatusCache[name] || {};
    agentStatusCache[name] = {
      status: status?.status || cached.status || 'idle',
      task: status?.currentTask || cached.task || '暂无任务',
      queueLength: status?.queueLength ?? cached.queueLength ?? 0,
      progress: status?.progress ?? cached.progress ?? 0,
      online: isOnline
    };

    // 如果 agentBar 存在，更新芯片显示
    if (agentBar) {
      let chip = agentBar.querySelector('[data-agent-chip="' + role + '"]');

      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'agent-chip';
        chip.setAttribute('data-agent-chip', role);
        chip.innerHTML = '<span class="status-dot"></span><span class="agent-name">' + agent.name + '</span>';
        agentBar.appendChild(chip);
      }

      if (isOnline) {
        chip.classList.remove('offline');
      } else {
        chip.classList.add('offline');
      }
    }
  }
}

/**
 * 更新单个Agent状态
 * @param {Object} update - 包含role, status, currentTask等字段的更新对象
 */
function updateSingleAgent(update) {
  if (!update || !update.role) return;

  const { role, status, currentTask, queueLength, progress, online } = update;
  const name = Object.keys(AGENTS).find(key => AGENTS[key].role === role);
  const agentList = document.getElementById('agentList');
  let existingEl = document.querySelector('[data-agent="' + role + '"]');

  if (!existingEl && name && agentList) {
    const agentEl = createAgentElement(name, AGENTS[name], { status, currentTask, queueLength, progress, online });
    agentList.appendChild(agentEl);
  } else if (existingEl && name) {
    updateAgentElement(existingEl, name, { status, currentTask, queueLength, progress, online });
  }

  updateMobileAgentChips({ [role]: { status, currentTask, queueLength, progress, online } });
}

/**
 * 创建Agent列表项元素
 * @param {string} role - Agent角色标识
 * @param {Object} agent - Agent配置对象
 * @param {Object} status - Agent状态对象
 * @returns {HTMLElement} Agent列表项DOM元素
 */
function createAgentElement(role, agent, status) {
  const isOnline = !status || status.online !== false;
  const agentStatus = status ? status.status : 'idle';
  const currentTask = status && status.currentTask ? status.currentTask : '暂无任务';
  const progress = status && status.progress ? status.progress : 0;
  const queueLength = status && status.queueLength ? status.queueLength : 0;

  const el = document.createElement('div');
  el.className = 'agent-item' + (isOnline ? '' : ' offline');
  el.setAttribute('data-agent', role);

  el.innerHTML =
    '<img class="agent-avatar" src="' + agent.avatar + '" alt="' + agent.name + '" onerror="this.src=\'' + DEFAULT_AVATAR + '\'">' +
    '<div class="agent-info">' +
      '<div class="agent-name">' + agent.name + '</div>' +
      '<div class="agent-task">' + escapeHtml(currentTask) + '</div>' +
      '<div class="progress-container">' +
        '<div class="progress-bar ' + (isOnline ? agentStatus : 'error') + '" style="width:' + progress + '%"></div>' +
      '</div>' +
    '</div>' +
    '<div class="agent-status">' +
      '<span class="status-badge ' + (isOnline ? agentStatus : 'error') + '">' + (isOnline ? (STATUS_TEXTS[agentStatus] || '未知') : '离线') + '</span>' +
      (queueLength > 0 ? '<span class="queue-count">排队: ' + queueLength + '</span>' : '') +
    '</div>';

  // 点击Agent项时，自动填充@指令到输入框
  el.addEventListener('click', function() {
    const input = document.getElementById('chatInput');
    if (input) {
      input.value = '@' + agent.name + ' ';
      input.focus();
    }
  });

  return el;
}

/**
 * 更新已有Agent列表项的显示状态
 * 使用缓存避免不必要的DOM操作
 * @param {HTMLElement} el - Agent列表项DOM元素
 * @param {string} name - Agent中文名
 * @param {Object} status - Agent状态对象
 */
function updateAgentElement(el, name, status) {
  if (!el) return;

  const newStatus = status ? status.status : 'error';
  const newTask = status && status.currentTask ? status.currentTask : '暂无任务';
  const newQueueLength = status && status.queueLength ? status.queueLength : 0;
  const newProgress = status && status.progress ? status.progress : 0;
  const newOnline = !status || status.online !== false;

  // 检查是否真的有变化，避免不必要的DOM更新
  const cached = agentStatusCache[name];
  if (cached && cached.status === newStatus && cached.task === newTask &&
      cached.queueLength === newQueueLength && cached.online === newOnline &&
      cached.progress === newProgress) {
    return;
  }

  // 更新缓存
  agentStatusCache[name] = {
    status: newStatus,
    task: newTask,
    queueLength: newQueueLength,
    progress: newProgress,
    online: newOnline
  };

  const statusBadge = el.querySelector('.status-badge');
  const taskText = el.querySelector('.agent-task');
  const queueCount = el.querySelector('.queue-count');
  const progressBar = el.querySelector('.progress-bar');

  if (statusBadge) {
    statusBadge.className = 'status-badge ' + (newOnline ? newStatus : 'error');
    statusBadge.textContent = newOnline ? (STATUS_TEXTS[newStatus] || '未知') : '离线';
  }

  if (taskText) taskText.textContent = newTask;
  if (queueCount) queueCount.textContent = newQueueLength > 0 ? '排队: ' + newQueueLength : '';

  if (progressBar) {
    progressBar.style.width = newProgress + '%';
    progressBar.className = 'progress-bar ' + (newOnline ? newStatus : 'error');
  }

  if (newOnline) {
    el.classList.remove('offline');
  } else {
    el.classList.add('offline');
  }
}
