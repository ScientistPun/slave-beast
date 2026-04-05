/**
 * PC端 JavaScript
 * 奴隶兽多Agent调度系统 - PC端界面
 */

// DOM 元素引用
let chatMessages, chatInput, sendBtn, agentList, loadHistoryBtn, clearHistoryBtn;
let clearAllLogsBtn, clearLogBtn, logModal, logList, cancelLogBtn;
let connectionDot, connectionText;

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
  initDOMReferences();
  initAgentList();
  initWebSocket(onConnected);
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
  clearHistoryBtn?.addEventListener('click', () => {
    showConfirmModal('确认清空', '确定要清空所有聊天记录吗？此操作不可恢复。', requestClearHistory);
  });
  clearAllLogsBtn?.addEventListener('click', requestClearAllLogs);
  clearLogBtn?.addEventListener('click', requestLogList);
  cancelLogBtn?.addEventListener('click', closeLogModal);
  document.getElementById('fileManagerBtn')?.addEventListener('click', () => {
    window.location.href = 'files.html';
  });

  // 点击弹窗背景关闭
  logModal?.addEventListener('click', (e) => {
    if (e.target === logModal) closeLogModal();
  });
}

function initAgentList() {
  if (!agentList) return;

  for (const [, agent] of Object.entries(AGENTS)) {
    const agentEl = createAgentElement(agent.role, agent, null);
    agentList.appendChild(agentEl);
  }
}

function onConnected() {
  addSystemMessage('已连接到服务器');
  requestHistory();
}
