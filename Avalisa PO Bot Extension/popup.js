/**
 * Avalisa PO Bot — toolbar popup.
 *
 * Information only: logo, mascot, what the extension does, official links and
 * the loaded build. Sign-in and all controls live in the on-page panel, which is
 * visible the moment Pocket Option loads — Board decision 2026-08-17, on the
 * grounds that a toolbar popup is an extra click most users never discover.
 */
const DASHBOARD_URL = 'https://avalisabot.vercel.app';

document.getElementById('dashboard-link').href = DASHBOARD_URL;
document.getElementById('site-link').href = DASHBOARD_URL;
document.getElementById('support-link').href = `${DASHBOARD_URL}/support`;
document.getElementById('version-line').textContent = `v${chrome.runtime.getManifest().version}`;

// Affiliate link is refreshed from the backend by the content script.
chrome.storage.local.get('affiliateLink', data => {
  document.getElementById('affiliate-link').href = data.affiliateLink || AFFILIATE_LINK;
});
