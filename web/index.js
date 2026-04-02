/**
 * 前端 JavaScript
 * Telegram 风格界面
 */

// 配置
const WS_URL = `ws://${window.location.host || 'localhost:8080'}`;

// 状态
let ws = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// Agent 配置
const AGENTS = {
  ceo: { name: '包工头', avatar: 'face/ceo.png' },
  cto: { name: '桥王', avatar: 'face/cto.png' },
  cro: { name: '天文台', avatar: 'face/cro.png' },
  coo: { name: '蛇头', avatar: 'face/coo.png' },
  pm: { name: '驴仔', avatar: 'face/pm.png' },
  qd: { name: '忍者神龟', avatar: 'face/qd.png' }
};

// 默认头像
const DEFAULT_AVATAR = 'face/boss.png';

// DOM 元素
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const agentList = document.getElementById('agentList');
const loadHistoryBtn = document.getElementById('loadHistoryBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const connectionDot = document.getElementById('connectionDot');
const connectionText = document.getElementById('connectionText');

/**
 * 初始化 WebSocket
 */
function initWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    isConnected = true;
    reconnectAttempts = 0;
    updateConnectionStatus(true);
  };

  ws.onclose = () => {
    isConnected = false;
    updateConnectionStatus(false);
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(initWebSocket, Math.min(1000 * reconnectAttempts, 10000));
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket 错误:', error);
  };

  ws.onmessage = (event) => {
    handleMessage(event.data);
  };
}

/**
 * 处理消息
 */
function handleMessage(data) {
  try {
    const message = JSON.parse(data);

    switch (message.type) {
      case 'system':
        addSystemMessage(message.content);
        break;
      case 'chat':
        {
          const msgId = message.timestamp + '_' + message.from;
          addChatMessage(message.from, message.content, message.timestamp, message.avatar, msgId);
        }
        break;
      case 'chat_history':
        loadChatHistory(message.data);
        break;
      case 'agent_status':
        updateAgentStatus(message.data);
        break;
      case 'agent_update':
        updateSingleAgent(message.data);
        break;
      case 'history_cleared':
        chatMessages.innerHTML = '';
        displayedMessages.clear();
        addSystemMessage('聊天记录已清空');
        break;
    }
  } catch (err) {
    console.error('解析消息错误:', err);
  }
}

/**
 * 发送消息
 */
function sendMessage(content) {
  if (!isConnected || !content.trim()) return;

  ws.send(JSON.stringify({
    type: 'chat',
    content: content.trim()
  }));

  chatInput.value = '';
  chatInput.focus();
}

// 记录已显示的消息 ID，防止重复显示
const displayedMessages = new Set();

/**
 * 添加聊天消息 - Telegram 风格
 */
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
  const senderHtml = isUser ? '':`<div class="sender" data-role="${role}">${escapeHtml(sender)}</div>`;

  const row = document.createElement('div');
  row.className = isUser ? 'message-row user' : 'message-row agent';

  const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  row.innerHTML = `
    <div class="avatar-wrapper">
      <img class="message-avatar" src="${avatarPath}" alt="${sender}" onerror="this.src='${DEFAULT_AVATAR}'">
    </div>
    <div class="message">
      ${senderHtml}
      <div class="message-bubble">
        <div class="content">${formatContent(content)}</div>
        <div class="time">${time}</div>
      </div>
    </div>
  `;

  chatMessages.appendChild(row);
  scrollToBottom();
}

/**
 * 获取 Agent 角色
 */
function getAgentRole(sender) {
  for (const [key, agent] of Object.entries(AGENTS)) {
    if (agent.name === sender) {
      return key;
    }
  }
  return '';
}

/**
 * 获取 Agent 头像
 */
function getAgentAvatar(sender) {
  for (const [key, agent] of Object.entries(AGENTS)) {
    if (agent.name === sender) {
      return agent.avatar;
    }
  }
  return DEFAULT_AVATAR;
}

/**
 * 格式化内容
 */
function formatContent(content) {
  if (!content) return '';
  const escaped = escapeHtml(content);
  return escaped.replace(/\n/g, '<br>');
}

/**
 * 添加系统消息
 */
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

/**
 * 加载聊天历史
 */
function loadChatHistory(history) {
  chatMessages.innerHTML = '';
  displayedMessages.clear();

  if (!history || history.length === 0) {
    addSystemMessage('暂无历史记录');
    return;
  }

  history.forEach(msg => {
    if (msg.type === 'user' || msg.type === 'agent') {
      const msgId = msg.timestamp + '_' + msg.from;
      addChatMessage(msg.from, msg.content, msg.timestamp, msg.avatar, msgId);
    }
  });

  scrollToBottom();
}

// Agent 状态缓存，用于比较是否有变化
const agentStatusCache = {};

/**
 * 更新 Agent 状态
 */
function updateAgentStatus(statusData) {
  for (const [role, agent] of Object.entries(AGENTS)) {
    const status = statusData[role];
    const existingEl = document.querySelector(`[data-agent="${role}"]`);

    if (existingEl) {
      // 更新现有元素（仅当状态变化时）
      updateAgentElement(existingEl, role, status);
    } else {
      // 创建新元素
      const agentEl = createAgentElement(role, agent, status);
      agentList.appendChild(agentEl);
    }
  }
}

/**
 * 更新单个 Agent
 */
function updateSingleAgent(update) {
  const { role, status, currentTask, queueLength } = update;
  let existingEl = document.querySelector(`[data-agent="${role}"]`);

  // 如果元素不存在，先创建（Agent 从离线变为在线）
  if (!existingEl) {
    const agentEl = createAgentElement(role, AGENTS[role], { status, currentTask, queueLength });
    agentList.appendChild(agentEl);
    existingEl = agentEl;
  }

  updateAgentElement(existingEl, role, { status, currentTask, queueLength });
}

/**
 * 更新 Agent 元素的内部内容（仅当内容变化时）
 */
function updateAgentElement(el, role, status) {
  const newStatus = status?.status || 'error';
  const newTask = status?.currentTask || '暂无任务';
  const newQueueLength = status?.queueLength || 0;
  const newOnline = status?.online !== false;

  // 获取缓存的状态
  const cached = agentStatusCache[role];
  const prevStatus = cached?.status;
  const prevTask = cached?.task;
  const prevQueueLength = cached?.queueLength;
  const prevOnline = cached?.online;

  // 比较是否有变化
  if (prevStatus === newStatus && prevTask === newTask && prevQueueLength === newQueueLength && prevOnline === newOnline) {
    return; // 没有变化，不更新
  }

  // 更新缓存
  agentStatusCache[role] = {
    status: newStatus,
    task: newTask,
    queueLength: newQueueLength,
    online: newOnline
  };

  // 更新 DOM 元素
  const isOffline = !status || status.online === false;
  const statusBadge = el.querySelector('.status-badge');
  const taskText = el.querySelector('.agent-task');
  const queueCount = el.querySelector('.queue-count');

  if (statusBadge) {
    statusBadge.className = `status-badge ${newStatus}`;
    statusBadge.textContent = isOffline ? '离线' : getStatusText(newStatus);
  }

  if (taskText) {
    taskText.textContent = newTask;
  }

  if (queueCount) {
    queueCount.textContent = newQueueLength > 0 ? `排队: ${newQueueLength}` : '';
  }

  // 更新离线状态
  if (isOffline) {
    el.classList.add('offline');
  } else {
    el.classList.remove('offline');
  }
}

/**
 * 创建 Agent 元素
 */
function createAgentElement(role, agent, status) {
  const div = document.createElement('div');
  div.className = 'agent-item';
  div.dataset.agent = role;

  // 根据 online 字段判断是否离线
  const isOffline = !status || status.online === false;
  if (isOffline) {
    div.classList.add('offline');
  }

  const statusText = isOffline ? '离线' : getStatusText(status?.status);
  const taskText = status?.currentTask || '暂无任务';
  const queueText = status?.queueLength > 0 ? `排队: ${status.queueLength}` : '';

  div.innerHTML = `
    <img class="agent-avatar" src="${agent.avatar}" alt="${agent.name}" onerror="this.style.display='none'">
    <div class="agent-info">
      <div class="agent-name">${agent.name}</div>
      <div class="agent-task">${escapeHtml(taskText)}</div>
    </div>
    <div class="agent-status">
      <span class="status-badge ${status?.status || 'idle'}">${statusText}</span>
      <span class="queue-count">${queueText}</span>
    </div>
  `;

  div.addEventListener('click', () => {
    chatInput.value = `@${agent.name} `;
    chatInput.focus();
  });

  return div;
}

/**
 * 获取状态文本
 */
function getStatusText(status) {
  const texts = {
    idle: '空闲',
    processing: '执行中',
    busy: '执行中',
    queued: '排队中',
    finish: '已完成',
    reject: '已驳回',
    error: '错误'
  };
  return texts[status] || '未知';
}

/**
 * 更新连接状态
 */
function updateConnectionStatus(connected) {
  if (connected) {
    connectionDot.classList.add('connected');
    connectionText.textContent = '已连接';
  } else {
    connectionDot.classList.remove('connected');
    connectionText.textContent = '已断开';
  }
}

/**
 * 滚动到底部
 */
function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 请求历史
 */
function requestHistory() {
  if (!isConnected) return;
  ws.send(JSON.stringify({ type: 'get_history' }));
}

/**
 * 请求清空历史
 */
function requestClearHistory() {
  if (!isConnected) return;
  if (confirm('确定要清空所有聊天记录吗？此操作不可恢复。')) {
    ws.send(JSON.stringify({ type: 'clear_history' }));
  }
}

// 事件监听
sendBtn.addEventListener('click', () => sendMessage(chatInput.value));
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage(chatInput.value);
});
loadHistoryBtn.addEventListener('click', requestHistory);
clearHistoryBtn.addEventListener('click', requestClearHistory);

/**
 * 初始化 Agent 列表（全部显示为离线）
 */
function initAgentList() {
  agentList.innerHTML = '';
  for (const [role, agent] of Object.entries(AGENTS)) {
    const agentEl = createAgentElement(role, agent, { online: false });
    agentList.appendChild(agentEl);
    // 初始化缓存为离线状态
    agentStatusCache[role] = {
      status: 'error',
      task: '暂无任务',
      queueLength: 0,
      online: false
    };
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initAgentList(); // 初始化显示所有 Agent（离线状态）
  initWebSocket();
  chatInput.focus();
});
