chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'displayAnalysis') {
    const analysis = request.analysis;

    const existingOverlay = document.getElementById('traid-analysis-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'traid-analysis-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '20px';
    overlay.style.right = '20px';
    overlay.style.backgroundColor = 'rgba(44, 44, 44, 0.9)';
    overlay.style.color = '#f1f1f1';
    overlay.style.padding = '20px';
    overlay.style.borderRadius = '8px';
    overlay.style.zIndex = '10000';
    overlay.style.maxWidth = '350px';
    overlay.style.fontFamily = 'Arial, sans-serif';
    overlay.style.fontSize = '14px';
    overlay.style.lineHeight = '1.6';

    const analysisText = document.createElement('div');
    analysisText.innerText = analysis;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '15px';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'space-between';

    const copyButton = document.createElement('button');
    copyButton.innerText = 'Copy';
    copyButton.style.backgroundColor = '#007bff';
    copyButton.style.color = 'white';
    copyButton.style.border = 'none';
    copyButton.style.padding = '8px 12px';
    copyButton.style.borderRadius = '4px';
    copyButton.style.cursor = 'pointer';

    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(analysis).then(() => {
        copyButton.innerText = 'Copied!';
        setTimeout(() => {
          copyButton.innerText = 'Copy';
        }, 2000);
      });
    });

    const closeButton = document.createElement('button');
    closeButton.innerText = 'Close';
    closeButton.style.backgroundColor = '#6c757d';
    closeButton.style.color = 'white';
    closeButton.style.border = 'none';
    closeButton.style.padding = '8px 12px';
    closeButton.style.borderRadius = '4px';
    closeButton.style.cursor = 'pointer';

    closeButton.addEventListener('click', () => {
      overlay.remove();
    });

    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(closeButton);
    overlay.appendChild(analysisText);
    overlay.appendChild(buttonContainer);
    document.body.appendChild(overlay);
  }
});
