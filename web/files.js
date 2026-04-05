/**
 * 文件管理页面 JavaScript
 * 奴隶兽多Agent调度系统
 */

// ==================== 常量配置 ====================

/** 文件存储目录（相对于服务器根目录） */
const FILE_DIR = 'workspace/';

/** API 基础路径 */
const API_BASE = '';

/** 支持预览的文件类型 */
const PREVIEWABLE_TYPES = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image'
};

/** 文件类型图标 */
const FILE_ICONS = {
  image: '🖼️',
  other: '📝'
};

// ==================== 状态 ====================

/** 当前文件列表 */
let files = [];


// ==================== 初始化 ====================

/**
 * DOM 加载完成后初始化
 */
document.addEventListener('DOMContentLoaded', () => {
  initUploadArea();
  initEventListeners();
  loadFiles();
});

/**
 * 初始化上传区域
 */
function initUploadArea() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');

  if (!uploadArea || !fileInput) return;

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFiles(droppedFiles);
  });

  fileInput.addEventListener('change', () => {
    const selectedFiles = Array.from(fileInput.files);
    handleFiles(selectedFiles);
    fileInput.value = '';
  });
}

/**
 * 初始化事件监听器
 */
function initEventListeners() {
  // 点击预览背景关闭
  const previewModal = document.getElementById('previewModal');
  previewModal?.addEventListener('click', (e) => {
    if (e.target === previewModal) {
      closePreview();
    }
  });

  // ESC 键关闭预览/确认弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePreview();
      closeConfirm();
    }
  });
}

// ==================== 文件上传 ====================

/**
 * 处理文件上传
 * @param {File[]} filesToUpload - 要上传的文件数组
 */
async function handleFiles(filesToUpload) {
  for (const file of filesToUpload) {
    if (!isPreviewable(file)) {
      showToast('不支持的文件类型，仅支持图片和PDF', 'error');
      continue;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(API_BASE + '/upload', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        showToast(`${file.name} 上传成功`, 'success');
        loadFiles();
      } else {
        showToast(`${file.name} 上传失败`, 'error');
      }
    } catch (error) {
      console.error('上传错误:', error);
      showToast(`上传失败: ${error.message}`, 'error');
    }
  }
}

/**
 * 判断文件是否可预览（通过 MIME 类型）
 * @param {File} file - 文件对象
 * @returns {boolean}
 */
function isPreviewable(file) {
  return PREVIEWABLE_TYPES.hasOwnProperty(file.type);
}

/**
 * 判断文件是否可预览（通过文件名）
 * @param {string} filename - 文件名
 * @returns {boolean}
 */
function isPreviewableByName(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
}

/**
 * 获取文件类型
 * @param {string} filename - 文件名
 * @returns {'image'|'other'}
 */
function getFileType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  return 'other';
}

// ==================== 文件列表 ====================

/**
 * 加载文件列表
 */
async function loadFiles() {
  try {
    const response = await fetch(API_BASE + '/files');
    if (response.ok) {
      files = await response.json();
      renderFileList();
    } else {
      throw new Error('获取文件列表失败');
    }
  } catch (error) {
    console.error('加载文件列表错误:', error);
    // 如果 API 不可用，显示空状态
    const container = document.getElementById('fileListContent');
    const countEl = document.getElementById('fileCount');
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">📂</div>
          <p>暂无文件</p>
          <p style="font-size: 0.8rem; margin-top: 8px;">上传文件将显示在这里</p>
        </div>
      `;
    }
    if (countEl) countEl.textContent = '0';
  }
}

/**
 * 渲染文件列表
 */
function renderFileList() {
  const container = document.getElementById('fileListContent');
  const countEl = document.getElementById('fileCount');

  if (!container) return;

  if (countEl) countEl.textContent = files.length;

  if (files.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📂</div>
        <p>暂无文件</p>
        <p style="font-size: 0.8rem; margin-top: 8px;">上传文件将显示在这里</p>
      </div>
    `;
    return;
  }

  container.innerHTML = files.map(file => {
    const fileType = getFileType(file.name);
    const canPreview = isPreviewableByName(file.name);
    const fileIcon = FILE_ICONS[fileType];
    const size = formatFileSize(file.size);
    const time = new Date(file.mtime).toLocaleString('zh-CN');

    return `
      <div class="file-item">
        <div class="file-icon ${fileType}" onclick="handlePreviewClick('${file.name}', ${canPreview})">${fileIcon}</div>
        <div class="file-info" onclick="handlePreviewClick('${file.name}', ${canPreview})">
          <div class="file-name" title="${file.name}">${file.name}</div>
          <div class="file-meta">${size} · ${time}</div>
        </div>
        <div class="file-actions">
          <button class="action-btn download" onclick="downloadFile('${file.name}')" title="下载">下载</button>
          <button class="action-btn delete" onclick="showDeleteConfirm('${file.name}')" title="删除">删除</button>
        </div>
      </div>
    `;
  }).join('');
}

// ==================== 文件预览 ====================

/**
 * 处理文件项点击预览
 * @param {string} filename - 文件名
 * @param {boolean} canPreview - 是否可预览
 */
function handlePreviewClick(filename, canPreview) {
  if (canPreview) {
    previewFile(filename);
  } else {
    showToast('该文件格式不支持预览', 'error');
  }
}

/**
 * 预览文件
 * @param {string} filename - 文件名
 */
function previewFile(filename) {
  const fileType = getFileType(filename);
  const previewContent = document.getElementById('previewContent');
  const previewFilename = document.getElementById('previewFilename');
  const fileUrl = API_BASE + '/' + FILE_DIR + encodeURIComponent(filename);

  if (!previewContent || !previewFilename) return;

  previewFilename.textContent = filename;

  if (fileType === 'image') {
    previewContent.innerHTML = `<img src="${fileUrl}" alt="${filename}">`;
  }

  const previewModal = document.getElementById('previewModal');
  if (previewModal) {
    previewModal.classList.add('active');
  }
}

/**
 * 关闭预览
 */
function closePreview() {
  const previewModal = document.getElementById('previewModal');
  const previewContent = document.getElementById('previewContent');

  if (previewModal) previewModal.classList.remove('active');
  if (previewContent) previewContent.innerHTML = '';
}

// ==================== 文件下载 ====================

/**
 * 下载文件
 * @param {string} filename - 文件名
 */
function downloadFile(filename) {
  const fileUrl = API_BASE + '/' + FILE_DIR + encodeURIComponent(filename);
  console.log(fileUrl);
  const a = document.createElement('a');
  a.href = fileUrl;
  a.download = filename;
  a.click();
  showToast('开始下载...', 'success');
}

// ==================== 文件删除 ====================

/** 当前要删除的文件名 */
let deleteFilename = '';

/**
 * 显示删除确认弹窗
 * @param {string} filename - 文件名
 */
function showDeleteConfirm(filename) {
  deleteFilename = filename;
  const messageEl = document.getElementById('confirmMessage');
  const modal = document.getElementById('confirmModal');
  const deleteBtn = document.getElementById('confirmDeleteBtn');

  if (messageEl) {
    messageEl.textContent = `确定要删除 "${filename}" 吗？此操作不可恢复。`;
  }
  if (modal) modal.classList.add('active');
  if (deleteBtn) {
    deleteBtn.onclick = () => deleteFile(filename);
  }
}

/**
 * 关闭确认弹窗
 */
function closeConfirm() {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.classList.remove('active');
  deleteFilename = '';
}

/**
 * 删除文件
 * @param {string} filename - 文件名
 */
async function deleteFile(filename) {
  closeConfirm();

  try {
    const response = await fetch(API_BASE + '/files/' + encodeURIComponent(filename), {
      method: 'DELETE'
    });

    if (response.ok) {
      showToast('删除成功', 'success');
      loadFiles();
    } else {
      const data = await response.json();
      showToast(data.message || '删除失败', 'error');
    }
  } catch (error) {
    console.error('删除错误:', error);
    showToast('删除失败: ' + error.message, 'error');
  }
}

// ==================== 工具函数 ====================

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * 显示 Toast 提示
 * @param {string} message - 消息内容
 * @param {string} [type=''] - 类型：success, error
 */
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className = 'toast show ' + type;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ==================== 返回按钮 ====================

/**
 * 根据设备类型返回对应页面
 */
function goBack() {
  // 判断是否为移动端：屏幕宽度 < 768px 或 User-Agent 包含移动设备关键字
  const isMobile = window.innerWidth < 768 ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile) {
    location.href = 'mobile.html';
  } else {
    location.href = 'index.html';
  }
}
