// Background service worker — handles extension lifecycle events
chrome.runtime.onInstalled.addListener(() => {
  console.log('Avalisa Trading Strategy Tool installed');
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_TAB') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
  }
  return true;
});
