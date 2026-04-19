const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const progressEl = document.getElementById('progress');
const keywordsEl = document.getElementById('keywords');
const maxNotesEl = document.getElementById('maxNotes');

// Load saved settings
chrome.storage.local.get(['keywords', 'maxNotes', 'dateFilter'], (data) => {
  if (data.keywords) keywordsEl.value = data.keywords;
  if (data.maxNotes) maxNotesEl.value = data.maxNotes;
  if (data.dateFilter != null) {
    const el = document.querySelector(`input[name=dateFilter][value="${data.dateFilter}"]`);
    if (el) el.checked = true;
  }
});

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS_UPDATE') {
    progressEl.textContent = msg.text;
  }
  if (msg.type === 'TASK_DONE') {
    progressEl.textContent = msg.text;
    setRunning(false);
  }
});

function setRunning(running) {
  startBtn.disabled = running;
  startBtn.style.display = running ? 'none' : 'block';
  stopBtn.style.display = running ? 'block' : 'none';
}

startBtn.addEventListener('click', () => {
  const raw = keywordsEl.value.trim();
  if (!raw) { progressEl.textContent = '请输入关键词'; return; }

  const keywords = raw.split('\n').map(k => k.trim()).filter(Boolean);
  const maxNotes = Math.min(parseInt(maxNotesEl.value) || 20, 50);
  const dateFilter = parseInt(document.querySelector('input[name=dateFilter]:checked')?.value || '0');

  chrome.storage.local.set({ keywords: raw, maxNotes, dateFilter });
  chrome.runtime.sendMessage({ type: 'START_TASK', keywords, maxNotes, dateFilter });
  setRunning(true);
  progressEl.textContent = '任务已启动，正在初始化...';
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_TASK' });
  setRunning(false);
  progressEl.textContent = '已停止';
});

// Check if task is already running on popup open
chrome.storage.local.get(['taskRunning'], (data) => {
  if (data.taskRunning) setRunning(true);
});
