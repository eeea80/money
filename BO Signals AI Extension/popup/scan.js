const captureBtn = document.getElementById('capture');
const analyzeBtn = document.getElementById('analyze');
const preview = document.getElementById('preview');
const previewContainer = document.getElementById('previewContainer');
const scanOverlay = document.getElementById('scanOverlay');
const result = document.getElementById('result');
const meta = document.getElementById('meta');
const progress = document.getElementById('progress');

let lastDataUrl = null;

function setStatus(text) {
  if (result) {
    result.innerHTML = `<p>${text}</p>`;
  }
}

captureBtn?.addEventListener('click', async () => {
  try {
    setStatus('Capturing visible tab...');
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png', quality: 90 });
    lastDataUrl = dataUrl;
    if (preview) {
      preview.src = dataUrl;
    }
    if (previewContainer) {
      previewContainer.style.display = 'block';
    }
    if (scanOverlay) {
      scanOverlay.classList.add('hidden');
    }
    setStatus('Screenshot captured. You can press Analyze.');
    if (meta) meta.textContent = '';
    await updateLimitDisplay();
  } catch (e) {
    setStatus('Failed to capture: ' + (e?.message || e));
  }
});

async function checkLimit() {
  try {
    const resp = await send({ type: 'CHECK_SCAN_LIMIT' });
    return resp?.limit || { allowed: true, remaining: 10, resetAt: Date.now() };
  } catch (_) {
    return { allowed: true, remaining: 10, resetAt: Date.now() };
  }
}

async function updateLimitDisplay() {
  const limit = await checkLimit();
  if (analyzeBtn) {
    if (!limit.allowed) {
      analyzeBtn.disabled = true;
      const resetTime = new Date(limit.resetAt).toLocaleTimeString();
      analyzeBtn.textContent = `Limit reached (resets at ${resetTime})`;
    } else {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = limit.remaining > 0 ? `🤖 Analyze (${limit.remaining} left)` : '🤖 Analyze';
    }
  }
}

analyzeBtn?.addEventListener('click', async () => {
  if (!lastDataUrl) {
    setStatus('Please capture a screenshot first.');
    return;
  }
  const limit = await checkLimit();
  if (!limit.allowed) {
    const resetTime = new Date(limit.resetAt).toLocaleTimeString();
    setStatus(`Daily limit reached (10 scans per 24h). Resets at ${resetTime}.`);
    return;
  }
  setStatus('Analyzing with AI...');
  startProgress();
  if (scanOverlay) scanOverlay.classList.remove('hidden');
  try {
    const resp = await send({ type: 'SCAN_ANALYZE', dataUrl: lastDataUrl });
    if (!resp?.ok) {
      if (resp?.error === 'LIMIT_EXCEEDED') {
        const resetTime = new Date(resp.resetAt).toLocaleTimeString();
        throw new Error(`Daily limit reached. Resets at ${resetTime}.`);
      }
      throw new Error(resp?.error || 'Unknown error');
    }
    const out = resp.data;
    const pair = out.pair || 'N/A';
    if (meta) meta.textContent = `Pair: ${pair}`;
    setStatus(`<strong>Pair:</strong> ${pair}<br/><strong>Direction:</strong> ${out.direction || '—'} <br/><strong>Confidence:</strong> ${Math.round((out.confidence||0)*100)}% <br/><strong>Suggested TF:</strong> ${out.timeframe || '1m'} <br/><pre style="white-space:pre-wrap">${out.summary || ''}</pre>`);
    await updateLimitDisplay();
  } catch (e) {
    setStatus('Analyze failed: ' + (e?.message || e));
  }
  stopProgress();
  if (scanOverlay) scanOverlay.classList.add('hidden');
});

// Check limit on load
updateLimitDisplay();

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      return resolve(resp);
    });
  });
}

function startProgress() {
  if (!progress) return;
  progress.classList.remove('hidden');
  const bar = progress.querySelector('span');
  if (!bar) return;
  let w = 0;
  bar.style.width = '0%';
  const id = setInterval(() => {
    w = Math.min(98, w + Math.random()*8 + 2);
    bar.style.width = `${w}%`;
  }, 180);
  progress._id = id;
}

function stopProgress() {
  if (!progress) return;
  const bar = progress.querySelector('span');
  if (bar) bar.style.width = '100%';
  if (progress._id) clearInterval(progress._id);
  setTimeout(() => progress.classList.add('hidden'), 350);
}


