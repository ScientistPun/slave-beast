/**
 * 前端 JavaScript
 * 奴隶兽多Agent调度系统 - 前端界面
 */

// 配置
const WS_URL = `ws://${window.location.host || 'localhost:3000'}`;

// 状态
let ws = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// 心跳状态
let heartbeatInterval = null;
let lastHeartbeatAck = 0;
let heartbeatStatus = 'disconnected';

// Agent 配置（中文名作为key，方便@提及）
const AGENTS = {
  '包工头': { name: '包工头', role: 'ceo', avatar: 'face/ceo.png', color: '#EF4444' },
  '桥王': { name: '桥王', role: 'cto', avatar: 'face/cto.png', color: '#F59E0B' },
  '天文台': { name: '天文台', role: 'cro', avatar: 'face/cro.png', color: '#10B981' },
  '蛇头': { name: '蛇头', role: 'coo', avatar: 'face/coo.png', color: '#3B82F6' },
  '驴仔': { name: '驴仔', role: 'pm', avatar: 'face/pm.png', color: '#8B5CF6' },
  '忍者神龟': { name: '忍者神龟', role: 'qd', avatar: 'face/qd.png', color: '#EC4899' }
};

// 中文名到role的反向映射
const AGENT_NAME_TO_ROLE = {
  '包工头': 'ceo',
  '桥王': 'cto',
  '天文台': 'cro',
  '蛇头': 'coo',
  '驴仔': 'pm',
  '忍者神龟': 'qd'
};

// 状态颜色映射
const STATUS_COLORS = {
  idle: '#22C55E',
  processing: '#3B82F6',
  finish: '#6B7280',
  reject: '#EF4444',
  busy: '#F59E0B',
  error: '#EF4444',
  offline: '#9CA3AF'
};

// 状态文本映射
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

// 默认头像
const DEFAULT_AVATAR = 'face/boss.png';

// 已显示消息集合（防止重复）
const displayedMessages = new Set();

// Agent状态缓存
const agentStatusCache = {};

// 正在输入中的Agent集合
const typingAgents = new Set();

// DOM 元素引用
let chatMessages, chatInput, sendBtn, agentList, loadHistoryBtn, clearHistoryBtn;
let clearAllLogsBtn, clearLogBtn, logModal, logList, cancelLogBtn;
let connectionDot, connectionText;

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
  initDOMReferences();
  initAgentList();
  initWebSocket();
  chatInput?.focus();
});

function initDOMReferences() {
  chatMessages = document.getElementById('chatMessages');
  chatInput = document.getElementById('chatInput');
  sendBtn = document.getElementById('sendBtn');
  agentList = document.getElementById('agentList');
  loadHistoryBtn = document.getElementById('loadHistoryBtn');
  clearHistoryBtn = document.getElementById('clearHistoryBtn');
  clearAllLogsBtn = document.getElementById('clearAllLogsBtn');
  clearLogBtn = document.getElementById('clearLogBtn');
  logModal = document.getElementById('logModal');
  logList = document.getElementById('logList');
  cancelLogBtn = document.getElementById('cancelLogBtn');
  connectionDot = document.getElementById('connectionDot');
  connectionText = document.getElementById('connectionText');

  // 事件绑定
  sendBtn?.addEventListener('click', () => sendMessage(chatInput?.value));
  chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage(chatInput?.value);
  });
  loadHistoryBtn?.addEventListener('click', requestHistory);
  clearHistoryBtn?.addEventListener('click', requestClearHistory);
  clearAllLogsBtn?.addEventListener('click', requestClearAllLogs);
  clearLogBtn?.addEventListener('click', requestLogList);
  cancelLogBtn?.addEventListener('click', closeLogModal);

  // 点击弹窗背景关闭
  logModal?.addEventListener('click', (e) => {
    if (e.target === logModal) closeLogModal();
  });
}

// ==================== WebSocket 管理 ====================

function initWebSocket() {
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      isConnected = true;
      reconnectAttempts = 0;
      lastHeartbeatAck = Date.now();
      heartbeatStatus = 'connected';
      updateConnectionStatus(true);
      startHeartbeat();
      requestHistory();
      addSystemMessage('已连接到服务器');
    };

    ws.onclose = () => {
      isConnected = false;
      heartbeatStatus = 'disconnected';
      stopHeartbeat();
      updateConnectionStatus(false);

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * reconnectAttempts, 10000);
        addSystemMessage(`连接断开，${delay / 1000}秒后重试...`);
        setTimeout(initWebSocket, delay);
      } else {
        addSystemMessage('连接失败，请刷新页面重试');
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket 错误:', error);
      addSystemMessage('连接发生错误');
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
    addSystemMessage('初始化连接失败');
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
      stopHeartbeat();
      return;
    }

    ws.send(JSON.stringify({
      type: 'heartbeat',
      timestamp: Date.now()
    }));

    if (Date.now() - lastHeartbeatAck > 35000) {
      heartbeatStatus = 'timeout';
    }
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ==================== 消息处理 ====================

function handleMessage(message) {
  switch (message.type) {
    case 'system':
      // 忽略 agent_online_update 等内部状态消息
      if (message.content && message.content.startsWith('agent_online_update')) return;
      addSystemMessage(message.content);
      break;

    case 'chat':
      const sender = message.sender || '系统';
      const msgId = message.timestamp + '_' + sender;
      const avatar = sender === '老细' ? DEFAULT_AVATAR : getAgentAvatar(sender);

      // 如果是Agent回复，移除该Agent的"正在输入中"气泡
      if (sender != '老细' && sender != '系统') {
        console.log(sender);
        hideTypingIndicator(sender);
      }

      addChatMessage(sender, message.content, message.timestamp, avatar, msgId);
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
      chatMessages.innerHTML = '';
      displayedMessages.clear();
      addSystemMessage('聊天记录已清空');
      break;

    case 'log_list':
      showLogModal(message.files);
      break;

    case 'logs_cleared':
      addSystemMessage(message.message);
      break;

    case 'log_cleared':
      if (message.success) {
        addSystemMessage(message.message);
      } else {
        addSystemMessage(message.message);
      }
      closeLogModal();
      break;

    case 'heartbeat_ack':
      lastHeartbeatAck = Date.now();
      heartbeatStatus = 'connected';
      break;

    default:
      console.log('未知消息类型:', message.type);
  }
}

function sendMessage(content) {
  if (!isConnected || !content.trim()) return;

  // 检查@指令格式
  const trimmedContent = content.trim();
  let mentionedAgent = null;

  if (trimmedContent.startsWith('@')) {
    const match = trimmedContent.match(/^@(\S+)\s+(.+)$/);
    if (!match) {
      addSystemMessage('提示：@指令格式为 @中文名 任务内容，例如 @包工头 分析需求');
      return;
    }
    const agentName = match[1];
    const taskContent = match[2];

    if (!AGENTS[agentName]) {
      const available = Object.keys(AGENTS).join('、');
      addSystemMessage(`提示：未知的Agent "${agentName}"，可用Agent: ${available}`);
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

  ws.send(JSON.stringify(message));

  // 立即显示自己发送的消息
  const msgId = message.timestamp + '_' + message.sender;
  addChatMessage(message.sender, message.content, message.timestamp, DEFAULT_AVATAR, msgId);

  // 如果@了某个Agent且该Agent在线，显示"正在输入中..."气泡
  if (mentionedAgent) {
    const agentInfo = AGENTS[mentionedAgent];
    if (agentInfo) {
      const role = agentInfo.role;
      const cached = agentStatusCache[mentionedAgent];
      if (cached && cached.online) {
        showTypingIndicator(mentionedAgent, agentInfo);
      }
    }
  }

  // 添加 loading 动画
  const loadingId = addLoadingMessage();

  chatInput.value = '';
  chatInput.focus();

  // 监听响应，收到后移除 loading 和 typing
  const removeLoadingOnResponse = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'chat' || msg.type === 'cli_output') {
        removeLoadingMessage(loadingId);
        ws.removeEventListener('message', removeLoadingOnResponse);
      }
    } catch {}
  };
  ws.addEventListener('message', removeLoadingOnResponse);

  // 30秒后自动移除作为超时保护
  setTimeout(() => {
    removeLoadingMessage(loadingId);
    // 超时后也移除typing指示
    if (mentionedAgent) {
      hideTypingIndicator(mentionedAgent);
    }
    ws.removeEventListener('message', removeLoadingOnResponse);
  }, 30000);
}

// ==================== Loading 动画 ====================

function addLoadingMessage() {
  const id = 'loading-' + Date.now();
  const row = document.createElement('div');
  row.id = id;
  row.className = 'message-row loading-row';
  row.innerHTML = `
    <div class="message loading-message">
      <div class="loading-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return id;
}

function removeLoadingMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ==================== Agent 正在输入中 气泡 ====================

function showTypingIndicator(agentName, agentInfo) {
  // 防止重复添加同一个Agent的typing气泡
  if (typingAgents.has(agentName)) {
    return;
  }
  typingAgents.add(agentName);

  const id = 'typing-' + agentName;
  const row = document.createElement('div');
  row.id = id;
  row.className = 'message-row agent typing-row';
  row.dataset.agent = agentName;

  const avatarPath = agentInfo?.avatar || getAgentAvatar(agentName);

  row.innerHTML = `
    <div class="avatar-wrapper">
      <img class="message-avatar" src="${avatarPath}" alt="${agentName}" onerror="this.src='${DEFAULT_AVATAR}'">
    </div>
    <div class="message">
      <div class="sender">${escapeHtml(agentName)}</div>
      <div class="message-bubble typing-bubble">
        <span class="typing-text">正在输入中...</span>
        <span class="typing-dots"><span></span><span></span><span></span></span>
      </div>
    </div>
  `;

  chatMessages.appendChild(row);
  scrollToBottom();
}

function hideTypingIndicator(agentName) {
  if (!typingAgents.has(agentName)) {
    return;
  }
  typingAgents.delete(agentName);

  const id = 'typing-' + agentName;
  const el = document.getElementById(id);
  if (el) {
    el.remove();
  }
}

// ==================== UI 渲染 ====================

function addChatMessage(sender, content, timestamp, avatar, msgId) {
  // 防止重复显示同一消息
  if (msgId && displayedMessages.has(msgId)) {
    return;
  }
  if (msgId) {
    displayedMessages.add(msgId);
    // 限制集合大小，防止内存泄漏
    if (displayedMessages.size > 1000) {
      const oldMsg = displayedMessages.values().next().value;
      displayedMessages.delete(oldMsg);
    }
  }

  const isUser = sender === '老细';
  const avatarPath = avatar || (isUser ? DEFAULT_AVATAR : getAgentAvatar(sender));
  const role = getAgentRole(sender);
  const senderHtml = isUser ? '' : `<div class="sender" data-role="${role}">${escapeHtml(sender)}</div>`;

  const row = document.createElement('div');
  row.className = isUser ? 'message-row user' : 'message-row agent';

  const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  // 高亮@指令
  const formattedContent = formatContent(content);

  row.innerHTML = `
    <div class="avatar-wrapper">
      <img class="message-avatar" src="${avatarPath}" alt="${sender}" onerror="this.src='${DEFAULT_AVATAR}'">
    </div>
    <div class="message">
      ${senderHtml}
      <div class="message-bubble">
        <div class="content">${formattedContent}</div>
        <div class="time">${time}</div>
      </div>
    </div>
  `;

  chatMessages.appendChild(row);
  scrollToBottom();
}

function addSystemMessage(content) {
  const row = document.createElement('div');
  row.className = 'message-row system';
  row.innerHTML = `
    <div class="message">
      <div class="message-bubble">
        <div class="content" style="color: var(--text-secondary);">${escapeHtml(content)}</div>
      </div>
    </div>
  `;
  chatMessages.appendChild(row);
  scrollToBottom();
}

function loadChatHistory(history) {
  chatMessages.innerHTML = '';
  displayedMessages.clear();

  if (!history || history.length === 0) {
    addSystemMessage('暂无历史记录');
    return;
  }

  addSystemMessage(`加载了 ${history.length} 条历史记录`);

  history.forEach(msg => {
    const sender = msg.sender || '系统';
    const msgId = msg.timestamp + '_' + sender;
    const avatar = sender === '老细' ? DEFAULT_AVATAR : getAgentAvatar(sender);
    addChatMessage(sender, msg.content, msg.timestamp, avatar, msgId);
  });

  scrollToBottom();
}

// ==================== Agent 状态看板 ====================

function initAgentList() {
  if (!agentList) return;
  agentList.innerHTML = '';

  for (const [name, agent] of Object.entries(AGENTS)) {
    const agentEl = createAgentElement(agent.role, agent, {
      online: false,
      status: 'offline',
      progress: 0,
      currentTask: '未上线',
      queueLength: 0
    });
    agentList.appendChild(agentEl);

    // 初始化缓存
    agentStatusCache[name] = {
      status: 'offline',
      task: '未上线',
      queueLength: 0,
      progress: 0,
      online: false
    };
  }
}

function createAgentElement(role, agent, status) {
  const div = document.createElement('div');
  div.className = 'agent-item';
  div.dataset.agent = role;

  const isOffline = !status || status.online === false;
  if (isOffline) {
    div.classList.add('offline');
  }

  const statusText = isOffline ? '离线' : (STATUS_TEXTS[status?.status] || '未知');
  const taskText = status?.currentTask || '暂无任务';
  const queueText = status?.queueLength > 0 ? `排队: ${status.queueLength}` : '';
  const progress = status?.progress || 0;
  const progressClass = isOffline ? 'offline' : (status?.status || 'idle');

  div.innerHTML = `
    <img class="agent-avatar" src="${agent.avatar}" alt="${agent.name}" onerror="this.style.display='none'">
    <div class="agent-info">
      <div class="agent-name">${agent.name}</div>
      <div class="agent-task">${escapeHtml(taskText)}</div>
      <div class="progress-container">
        <div class="progress-bar ${progressClass}" style="width: ${progress}%"></div>
      </div>
    </div>
    <div class="agent-status">
      <span class="status-badge ${isOffline ? 'error' : (status?.status || 'idle')}">${statusText}</span>
      <span class="queue-count">${queueText}</span>
    </div>
  `;

  // 点击Agent卡片自动填充@指令（使用中文名）
  div.addEventListener('click', () => {
    if (chatInput) {
      chatInput.value = `@${agent.name} `;
      chatInput.focus();
    }
  });

  return div;
}

function updateAgentStatusFromBoard(agents) {
  if (!agents || !Array.isArray(agents)) return;

  const statusData = {};
  agents.forEach(agent => {
    if (agent) {
      // 优先用 role 做键（与前端 AGENTS 映射一致），回退用 name
      const key = agent.role || agent.name;
      if (key) {
        statusData[key] = agent;
      }
    }
  });

  updateAgentStatus(statusData);
}

function updateAgentStatus(statusData) {
  for (const [name, agent] of Object.entries(AGENTS)) {
    const role = agent.role;  // 用role来匹配状态数据
    const status = statusData[role];
    const existingEl = document.querySelector(`[data-agent="${role}"]`);

    if (existingEl) {
      updateAgentElement(existingEl, name, status);
    } else {
      const agentEl = createAgentElement(role, agent, status);
      if (agentList) agentList.appendChild(agentEl);
    }
  }
}

function updateSingleAgent(update) {
  if (!update || !update.role) return;

  const { role, status, currentTask, queueLength, progress, online } = update;
  const name = Object.keys(AGENTS).find(key => AGENTS[key].role === role);
  let existingEl = document.querySelector(`[data-agent="${role}"]`);

  if (!existingEl && name) {
    const agentEl = createAgentElement(name, AGENTS[name], {
      status, currentTask, queueLength, progress, online
    });
    if (agentList) agentList.appendChild(agentEl);
  } else if (existingEl && name) {
    updateAgentElement(existingEl, name, {
      status, currentTask, queueLength, progress, online
    });
  }
}

function updateAgentElement(el, name, status) {
  if (!el) return;

  const newStatus = status?.status || 'error';
  const newTask = status?.currentTask || '暂无任务';
  const newQueueLength = status?.queueLength || 0;
  const newProgress = status?.progress || 0;
  const newOnline = status?.online !== false;

  // 获取缓存的状态
  const cached = agentStatusCache[name];
  const prevStatus = cached?.status;
  const prevTask = cached?.task;
  const prevQueueLength = cached?.queueLength;
  const prevProgress = cached?.progress;
  const prevOnline = cached?.online;

  // 比较是否有变化
  if (prevStatus === newStatus && prevTask === newTask &&
      prevQueueLength === newQueueLength && prevOnline === newOnline &&
      prevProgress === newProgress) {
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

  // 更新 DOM 元素
  const isOffline = !status || status.online === false;
  const statusBadge = el.querySelector('.status-badge');
  const taskText = el.querySelector('.agent-task');
  const queueCount = el.querySelector('.queue-count');
  const progressBar = el.querySelector('.progress-bar');

  if (statusBadge) {
    statusBadge.className = `status-badge ${isOffline ? 'error' : newStatus}`;
    statusBadge.textContent = isOffline ? '离线' : (STATUS_TEXTS[newStatus] || '未知');
  }

  if (taskText) {
    taskText.textContent = newTask;
  }

  if (queueCount) {
    queueCount.textContent = newQueueLength > 0 ? `排队: ${newQueueLength}` : '';
  }

  if (progressBar) {
    progressBar.className = `progress-bar ${isOffline ? 'offline' : newStatus}`;
    progressBar.style.width = `${newProgress}%`;
  }

  // 更新离线状态样式
  if (isOffline) {
    el.classList.add('offline');
  } else {
    el.classList.remove('offline');
  }
}

// ==================== 看板管理 ====================

function requestHistory() {
  if (!isConnected) {
    addSystemMessage('未连接服务器，无法加载历史记录');
    return;
  }
  ws.send(JSON.stringify({ type: 'get_history' }));
}

function requestClearHistory() {
  if (!isConnected) return;
  if (confirm('确定要清空所有聊天记录吗？此操作不可恢复。')) {
    ws.send(JSON.stringify({ type: 'clear_history' }));
  }
}

function requestClearAllLogs() {
  if (!isConnected) return;
  if (confirm('确定要清空所有日志文件吗？此操作不可恢复。')) {
    ws.send(JSON.stringify({ type: 'clear_all_logs' }));
  }
}

function requestLogList() {
  if (!isConnected) {
    addSystemMessage('未连接服务器，无法获取日志列表');
    return;
  }
  ws.send(JSON.stringify({ type: 'get_log_list' }));
}

function showLogModal(files) {
  if (!logModal || !logList) return;

  logList.innerHTML = '';

  if (!files || files.length === 0) {
    logList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">暂无日志文件</div>';
  } else {
    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'log-item';
      item.innerHTML = `
        <span class="log-name">${file.name}</span>
        <span class="log-size">${formatFileSize(file.size)}</span>
      `;
      item.addEventListener('click', () => {
        const agentName = file.name.replace('.log', '');
        if (confirm(`确定要清空 ${file.name} 吗？`)) {
          ws.send(JSON.stringify({ type: 'clear_log', agentName }));
        }
      });
      logList.appendChild(item);
    });
  }

  logModal.classList.add('active');
}

function closeLogModal() {
  if (logModal) {
    logModal.classList.remove('active');
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ==================== 工具函数 ====================

function getAgentRole(sender) {
  for (const [key, agent] of Object.entries(AGENTS)) {
    if (agent.name === sender || key === sender) {
      return agent.role;  // 返回role而不是key
    }
  }
  return '';
}

function getAgentAvatar(sender) {
  for (const [key, agent] of Object.entries(AGENTS)) {
    if (agent.name === sender || key === sender) {
      return agent.avatar;
    }
  }
  return DEFAULT_AVATAR;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatContent(content) {
  if (!content) return '';
  let escaped = escapeHtml(content);

  // 高亮 @指令
  escaped = escaped.replace(/@(\w+)/g, '<span class="at-mention">@$1</span>');

  // 保留换行
  escaped = escaped.replace(/\n/g, '<br>');

  return escaped;
}

function scrollToBottom() {
  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function updateConnectionStatus(connected) {
  if (connectionDot && connectionText) {
    if (connected) {
      connectionDot.classList.add('connected');
      connectionText.textContent = '已连接';
    } else {
      connectionDot.classList.remove('connected');
      connectionText.textContent = '已断开';
    }
  }
}
