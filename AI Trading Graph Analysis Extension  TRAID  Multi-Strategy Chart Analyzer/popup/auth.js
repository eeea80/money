// Check for stored auth code in cookie (survives uninstall)
const checkStoredAuthCode = async () => {
    try {
        const response = await fetch('https://inventabot-proxy-backend.vercel.app/api/get-stored-auth', {
            method: 'GET',
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.authCode) {
                // Validate that the auth code starts with "traid" to ensure it's from this extension
                if (!data.authCode.startsWith('traid')) {
                    console.log('Auth code from cookie does not belong to Traid extension, ignoring:', data.authCode);
                    return null;
                }
                console.log('Found stored auth code from cookie:', data.authCode);
                return data.authCode;
            }
        }
        return null;
    } catch (error) {
        console.log('No stored auth code found in cookie:', error);
        return null;
    }
};

// Helper function to get unique installation ID with migration from local to sync storage
function getUniqueInstallationId() {
    return new Promise((resolve) => {
        // First check chrome.storage.sync (new persistent location)
        chrome.storage.sync.get('uniqueInstallationId', (syncData) => {
            if (syncData.uniqueInstallationId) {
                console.log('Found existing ID in sync storage:', syncData.uniqueInstallationId);
                resolve(syncData.uniqueInstallationId);
                return;
            }
            
            // If not in sync, check chrome.storage.local (old location)
            chrome.storage.local.get('uniqueInstallationId', (localData) => {
                if (localData.uniqueInstallationId) {
                    console.log('Migrating existing ID from local to sync storage:', localData.uniqueInstallationId);
                    // Migrate from local to sync storage
                    chrome.storage.sync.set({ uniqueInstallationId: localData.uniqueInstallationId }, () => {
                        // Optional: Clean up local storage after successful migration
                        chrome.storage.local.remove('uniqueInstallationId');
                        resolve(localData.uniqueInstallationId);
                    });
                } else {
                    // Generate new ID for new users
                    const timestamp = Date.now();
                    const random = Math.random().toString(36).substring(2, 15);
                    const newId = `traid_${timestamp}_${random}`;
                    chrome.storage.sync.set({ uniqueInstallationId: newId }, () => {
                        console.log('Generated new unique installation ID in sync storage:', newId);
                        resolve(newId);
                    });
                }
            });
        });
    });
}

document.addEventListener('DOMContentLoaded', async function() {
    const getLicenseButton = document.getElementById('getLicense');
    const checkLicenseLink = document.getElementById('checkLicenseLink');
    const backToHomeButton = document.getElementById('back-to-home');
    const emailInput = document.getElementById('email');
    const authStatus = document.getElementById('auth-status');

    // FIRST: Check if there's a stored auth code in the cookie (survives uninstall)
    const storedAuthCode = await checkStoredAuthCode();
    
    if (storedAuthCode) {
        console.log('Attempting to auto-authenticate from stored cookie');
        authStatus.textContent = 'Restoring your account...';
        
        // Store the auth code in both local and sync storage
        await new Promise((resolve) => {
            chrome.storage.local.set({ uniqueInstallationId: storedAuthCode }, resolve);
        });
        
        await new Promise((resolve) => {
            chrome.storage.sync.set({ uniqueInstallationId: storedAuthCode }, resolve);
        });
        
        console.log('Auto-authentication successful from cookie');
    }

    // Load email and firstName from storage and pre-fill the inputs
    chrome.storage.local.get(['email', 'firstName'], (data) => {
        if (data.email) {
            emailInput.value = data.email;
        }
        if (data.firstName) {
            document.getElementById('firstName').value = data.firstName;
        }
    });

    console.log("auth.js loaded. Attaching listeners.");

    getLicenseButton.addEventListener('click', async function() {
        console.log("Get License button clicked.");
        const email = emailInput.value;
        const firstName = document.getElementById('firstName').value;

        if (!email || !email.includes('@')) {
            authStatus.textContent = 'Please enter a valid email address.';
            return;
        }

        // Show loading state
        getLicenseButton.disabled = true;
        getLicenseButton.classList.add('btn-loading');
        getLicenseButton.innerHTML = '<span class="btn-spinner"></span>Setting things up...';

        // Save the email and firstName to storage
        chrome.storage.local.set({ email: email, firstName: firstName }, () => {
            console.log('Email and first name saved to storage.');
        });

        function openLicensePage(url) {
            window.open(url, '_blank');
            getLicenseButton.innerHTML = 'Check your new browser tab ✓';
            getLicenseButton.style.background = 'var(--accent-green)';
        }

        // FIRST: Check if there's a stored auth code in the cookie (survives uninstall)
        const cookieAuthCode = await checkStoredAuthCode();
        if (cookieAuthCode) {
            authStatus.textContent = 'Existing account found. Continuing with your saved access.';

            chrome.storage.local.set({ uniqueInstallationId: cookieAuthCode }, () => {
                chrome.storage.sync.set({ uniqueInstallationId: cookieAuthCode }, () => {
                    const licenseUrl = `https://inventabot.com/software/traid?auth=${cookieAuthCode}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(firstName)}`;
                    openLicensePage(licenseUrl);
                });
            });
            return;
        }

        // SECOND: Check if this Chrome profile already has an existing auth code in sync storage
        chrome.storage.sync.get(['uniqueInstallationId'], async (syncResult) => {
            if (syncResult.uniqueInstallationId) {
                authStatus.textContent = 'Account detected. Opening your access portal...';

                const existingAuthCode = syncResult.uniqueInstallationId;

                // Set the cookie to ensure it persists
                try {
                    await fetch('https://inventabot-proxy-backend.vercel.app/api/auth', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        credentials: 'include',
                        body: JSON.stringify({ authCode: existingAuthCode })
                    });
                    console.log('Cookie set for existing auth code:', existingAuthCode);
                } catch (error) {
                    console.error('Failed to set cookie:', error);
                }

                chrome.storage.local.set({ uniqueInstallationId: existingAuthCode }, () => {
                    const licenseUrl = `https://inventabot.com/software/traid?auth=${existingAuthCode}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(firstName)}`;
                    openLicensePage(licenseUrl);
                });
                return;
            }

            // THIRD: No existing auth code found anywhere, create new one
            getUniqueInstallationId().then(async extensionId => {
                // Set the cookie in the backend before opening signup page
                try {
                    await fetch('https://inventabot-proxy-backend.vercel.app/api/auth', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        credentials: 'include',
                        body: JSON.stringify({ authCode: extensionId })
                    });
                    console.log('Cookie set for new auth code:', extensionId);
                } catch (error) {
                    console.error('Failed to set cookie:', error);
                }

                const licenseUrl = `https://inventabot.com/software/traid?auth=${extensionId}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(firstName)}`;
                openLicensePage(licenseUrl);
            });
        });
    });

    checkLicenseLink.addEventListener('click', function() {
        console.log("Check My License button clicked.");
        authStatus.textContent = 'Checking license...';
        checkLicense();
    });

    backToHomeButton.addEventListener('click', function() {
        window.location.href = 'popup.html';
    });

    // Automatically check the license when the auth page loads
    checkLicense();

    function checkLicense() {
        console.log("Sending 'checkLicense' message to background script.");
        chrome.runtime.sendMessage({ action: 'checkLicense' }, function(response) {
            if (chrome.runtime.lastError) {
                console.error("Error sending message:", chrome.runtime.lastError.message);
                authStatus.textContent = `Error: ${chrome.runtime.lastError.message}`;
                document.getElementById('back-to-home').style.display = 'block';
                return;
            }
            
            console.log("Received response from background script:", response);
            if (response && response.success && response.status === 'trial') {
                // Free trial active — let the user straight into the app
                hideWelcomeSection();
                const left = response.freeScansLeft;
                authStatus.textContent = `🎁 Free trial active — ${left} free scan${left === 1 ? '' : 's'} left. Taking you in...`;
                setTimeout(() => {
                    window.location.href = 'popup.html';
                }, 1500);
            } else if (response && response.success) {
                // Hide welcome section for valid license
                hideWelcomeSection();

                authStatus.textContent = 'License valid!';
                document.getElementById('settings-link').style.display = 'block';
                document.getElementById('getLicense').style.display = 'none';
                document.getElementById('back-to-home').style.display = 'block';
                chrome.storage.local.get('licenseExpiry', (data) => {
                    if (data.licenseExpiry) {
                        const expiryDate = new Date(data.licenseExpiry);
                        const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
                        document.getElementById('license-expiry').textContent = `Your license is valid for another ${daysLeft} days.`;
                    }
                });
                setTimeout(() => {
                    window.location.href = 'popup.html';
                }, 2000);
            } else if (response && response.status === 'expired') {
                // Out of free scans — sell using their own scan history, not generic copy
                hideWelcomeSection();
                authStatus.innerHTML = '';
                document.getElementById('getLicense').style.display = 'none';
                document.getElementById('back-to-home').style.display = 'none';

                let paywallHost = document.getElementById('paywall-host');
                if (!paywallHost) {
                    paywallHost = document.createElement('div');
                    paywallHost.id = 'paywall-host';
                    authStatus.parentNode.insertBefore(paywallHost, authStatus);
                }
                Trial.renderPaywall(paywallHost);
            } else if (response && response.status === 'error') {
                authStatus.textContent = 'An error occurred while checking your license. Please try again.';
                document.getElementById('back-to-home').style.display = 'block';
            } else {
                authStatus.textContent = 'You don\'t have an active license.';
                document.getElementById('getLicense').style.display = 'block';
                document.getElementById('back-to-home').style.display = 'block';
            }
        });
    }
    
    function hideWelcomeSection() {
        // Hide all welcome section elements
        const heroTitle = document.querySelector('.hero-title');
        const heroSubtitle = document.querySelector('.hero-subtitle');
        const firstNameInput = document.getElementById('firstName');
        const emailInput = document.getElementById('email');
        const getLicenseBtn = document.getElementById('getLicense');
        const secureText = document.querySelector('.secure-text');
        const activateLink = document.querySelector('.activate-link');
        
        if (heroTitle) heroTitle.style.display = 'none';
        if (heroSubtitle) heroSubtitle.style.display = 'none';
        if (firstNameInput) firstNameInput.style.display = 'none';
        if (emailInput) emailInput.style.display = 'none';
        if (getLicenseBtn) getLicenseBtn.style.display = 'none';
        if (secureText) secureText.style.display = 'none';
        if (activateLink) activateLink.style.display = 'none';
    }
});
