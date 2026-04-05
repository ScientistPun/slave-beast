/**
 * ============================================
 * 移动端 JavaScript - 奴隶兽多Agent调度系统
 * ============================================
 *
 * 本文件包含移动端特有的初始化和事件处理逻辑
 * 通用功能（如WebSocket通信、消息显示）由 common.js 提供
 */

// ==================== DOM元素引用 ====================

/** 聊天消息显示区域 */
let chatArea, chatInput, sendBtn;

/** 功能按钮（展开/历史/清空等） */
let expandBtn, loadHistoryBtn, clearHistoryBtn;
let clearAllLogsBtn, clearLogBtn, logModal, logList, cancelLogBtn;

/** Agent信息相关元素 */
let agentInfoBtn, agentInfoModal, agentInfoList, closeAgentInfoBtn;

/** 连接状态显示元素 */
let connectionDot, connectionText;

/** 功能按钮容器（可展开/收起） */
let actionBar;

// ==================== 页面加载初始化 ====================

/**
 * 页面加载完成后初始化
 * DOMContentLoaded 事件确保DOM元素已加载
 */
document.addEventListener('DOMContentLoaded', () => {
  initDOMReferences();           // 初始化DOM引用并绑定事件
  initWebSocket(onConnected);   // 连接WebSocket服务器
  chatInput?.focus();          // 自动聚焦输入框
});

/**
 * 初始化DOM元素引用并绑定事件
 * 获取页面元素并注册点击/输入事件处理
 */
function initDOMReferences() {
  // 获取聊天区域元素
  chatArea = document.getElementById('chatArea');
  chatInput = document.getElementById('chatInput');
  sendBtn = document.getElementById('sendBtn');
  expandBtn = document.getElementById('expandBtn');
  loadHistoryBtn = document.getElementById('loadHistoryBtn');
  clearHistoryBtn = document.getElementById('clearHistoryBtn');
  clearAllLogsBtn = document.getElementById('clearAllLogsBtn');
  clearLogBtn = document.getElementById('clearLogBtn');
  logModal = document.getElementById('logModal');
  logList = document.getElementById('logList');
  cancelLogBtn = document.getElementById('cancelLogBtn');
  connectionDot = document.getElementById('connectionDot');
  connectionText = document.getElementById('connectionText');
  actionBar = document.querySelector('.action-bar');

  // Agent信息弹窗元素
  agentInfoBtn = document.getElementById('agentInfoBtn');
  agentInfoModal = document.getElementById('agentInfoModal');
  agentInfoList = document.getElementById('agentInfoList');
  closeAgentInfoBtn = document.getElementById('closeAgentInfoBtn');

  // ==================== 发送消息事件 ====================

  /** 发送按钮点击 */
  sendBtn?.addEventListener('click', () => {
    const message = chatInput?.value;
    if (message) {
      chatInput.value = '';
      sendMessage(message, chatArea);
    }
  });

  /** 输入框回车发送 */
  chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const message = chatInput?.value;
      if (message) {
        chatInput.value = '';
        sendMessage(message, chatArea);
      }
    }
  });

  // ==================== 功能按钮事件 ====================

  /** 展开/收起功能按钮面板 */
  expandBtn?.addEventListener('click', () => {
    expandBtn.classList.toggle('active');
    actionBar?.classList.toggle('show');
  });

  /** 加载历史记录 */
  loadHistoryBtn?.addEventListener('click', () => {
    requestHistory();
    closeExpandMenu();
  });

  /** 清空聊天记录 */
  clearHistoryBtn?.addEventListener('click', () => {
    showConfirmModal('确认清空', '确定要清空所有聊天记录吗？此操作不可恢复。', () => {
      requestClearHistory();
      closeExpandMenu();
    });
  });

  /** 清空所有日志 */
  clearAllLogsBtn?.addEventListener('click', () => {
    requestClearAllLogs();
    closeExpandMenu();
  });

  /** 查看/选择日志 */
  clearLogBtn?.addEventListener('click', () => {
    requestLogList();
    closeExpandMenu();
  });

  /** 关闭日志弹窗 */
  cancelLogBtn?.addEventListener('click', closeLogModal);

  /** 点击弹窗背景关闭弹窗 */
  logModal?.addEventListener('click', (e) => {
    if (e.target === logModal) closeLogModal();
  });

  // ==================== Agent信息弹窗事件 ====================

  /** 显示Agent信息弹窗 */
  agentInfoBtn?.addEventListener('click', showAgentInfoModal);

  /** 关闭Agent信息弹窗 */
  closeAgentInfoBtn?.addEventListener('click', closeAgentInfoModal);

  /** 点击Agent信息弹窗背景关闭 */
  agentInfoModal?.addEventListener('click', (e) => {
    if (e.target === agentInfoModal) closeAgentInfoModal();
  });

  /** 文件管理按钮 */
  document.getElementById('fileManagerBtn')?.addEventListener('click', () => {
    window.location.href = 'files.html';
  });
}

/**
 * 收起功能按钮面板
 */
function closeExpandMenu() {
  expandBtn?.classList.remove('active');
  actionBar?.classList.remove('show');
}

/**
 * WebSocket连接成功后的回调
 * 显示连接成功消息并加载历史记录
 */
function onConnected() {
  addSystemMessage('已连接到服务器', chatArea);
  requestHistory();
}

// ==================== Agent信息弹窗 ====================

/**
 * 显示Agent信息弹窗
 * 从当前缓存的Agent状态中读取数据并展示
 */
function showAgentInfoModal() {
  if (!agentInfoList) return;

  agentInfoList.innerHTML = '';

  // 遍历所有Agent，生成信息卡片
  for (const [name, agent] of Object.entries(AGENTS)) {
    const cached = agentStatusCache[name];
    const isOnline = cached ? cached.online !== false : false;
    const status = cached?.status || 'idle';
    const task = cached?.task || '暂无任务';

    const item = document.createElement('div');
    item.className = 'agent-info-item' + (isOnline ? '' : ' offline');

    // 点击Agent项，自动填充@指令并关闭弹窗
    item.addEventListener('click', () => {
      if (chatInput) {
        chatInput.value = '@' + agent.name + ' ';
        chatInput.focus();
      }
      closeAgentInfoModal();
    });

    item.innerHTML =
      '<img class="agent-info-avatar" src="' + agent.avatar + '" alt="' + agent.name + '" onerror="this.src=\'' + DEFAULT_AVATAR + '\'">' +
      '<div class="agent-info-content">' +
        '<div class="agent-info-name">' + agent.name + '</div>' +
        '<div class="agent-info-task">' + escapeHtml(task) + '</div>' +
      '</div>' +
      '<span class="agent-info-status ' + (isOnline ? status : 'offline') + '">' +
        (isOnline ? (STATUS_TEXTS[status] || status) : '离线') +
      '</span>';

    agentInfoList.appendChild(item);
  }

  agentInfoModal?.classList.add('active');
}

/**
 * 关闭Agent信息弹窗
 */
function closeAgentInfoModal() {
  agentInfoModal?.classList.remove('active');
}
