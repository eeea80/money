// ===== ERROR MODAL =====
async function showErrorModal(message) {
    const modal    = document.getElementById('errorModal');
    const textEl   = document.getElementById('errorModalText');
    const copyBtn  = document.getElementById('errorCopyBtn');
    const copyLabel = document.getElementById('errorCopyLabel');
    const supportBtn = document.getElementById('errorSupportBtn');
    const closeBtn = document.getElementById('errorModalClose');

    // Build a detailed error string with timestamp + auth for support context
    const authCode = await getUniqueInstallationId().catch(() => 'unknown');
    const timestamp = new Date().toISOString();
    const errorText = `Error: ${message}\nTime: ${timestamp}\nAuth: ${authCode}`;

    textEl.textContent = errorText;

    // Support URL with auth pre-filled
    supportBtn.href = `https://inventabot.com/embedemail/traid?auth=${authCode}`;

    // Copy button
    copyBtn.onclick = () => {
        navigator.clipboard.writeText(errorText).then(() => {
            copyLabel.textContent = '✓ Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyLabel.textContent = '📋 Copy Error';
                copyBtn.classList.remove('copied');
            }, 2000);
        });
    };

    // Close handlers
    closeBtn.onclick = () => modal.classList.remove('active');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('active'); };

    modal.classList.add('active');
}

// Helper function to make URLs in text clickable
function makeLinksClickable(text) {
    // Regular expression to match URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" style="color: var(--accent-green); text-decoration: underline;">$1</a>');
}

// Helper function to display error with clickable links
function displayError(errorText, isHTML = false) {
    const processedError = isHTML ? errorText : makeLinksClickable(errorText);
    
    if (isHTML) {
        return `<div class="error html-error">${processedError}</div>`;
    } else {
        return `<p class="error">${processedError}</p>`;
    }
}

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

// Strategy display names mapping
const strategyDisplayNames = {
    'wyckoff': 'Wyckoff',
    'elliott-wave': 'Elliott Wave',
    'support-resistance': 'Support & Resistance',
    'fibonacci': 'Fibonacci',
    'moving-averages': 'Moving Averages',
    'price-action': 'Price Action',
    'volume-profile': 'Volume Profile',
    'ichimoku': 'Ichimoku',
    'harmonic-patterns': 'Harmonic',
    'market-structure': 'Market Structure'
};

document.addEventListener('DOMContentLoaded', async () => {
    const analyzeButton = document.getElementById('analyze');
    const resultDiv = document.getElementById('result');
    const strategyGrid = document.getElementById('strategyGrid');
    const strategyCards = document.querySelectorAll('.strategy-card');
    const selectedStrategyName = document.getElementById('selectedStrategyName');
    
    // Mode selector buttons
    const singleModeBtn = document.getElementById('single-mode-btn');
    const multiModeBtn = document.getElementById('multi-mode-btn');

    const trialBanner = document.getElementById('trial-banner');
    const trialGate = document.getElementById('trial-gate');
    const demoButton = document.getElementById('demo-scan');
    let trialStatus = null;

    // Pull trial state from the background script (single source of truth) and reflect it in the UI
    function refreshTrial(callback) {
        Trial.getStatus((status) => {
            trialStatus = status;
            Trial.renderBanner(trialBanner, status);

            // Scan 1 includes Multi-Strategy — advertise that instead of greying it out
            if (multiModeBtn) {
                const badge = multiModeBtn.querySelector('.mode-btn-badge');
                if (status.multiUnlocked && !status.licensed && status.scansUsed === 0) {
                    if (badge) {
                        badge.textContent = '🎁 FREE 1ST';
                        badge.classList.add('free-badge');
                    }
                    multiModeBtn.style.opacity = '';
                    multiModeBtn.style.cursor = '';
                } else if (!status.licensed && !status.multiUnlocked) {
                    if (badge) {
                        badge.textContent = '🔒 PRO';
                        badge.classList.remove('free-badge');
                    }
                }
            }
            if (callback) callback(status);
        });
    }

    refreshTrial();
    
    // Handle mode selector button clicks
    if (singleModeBtn) {
        singleModeBtn.addEventListener('click', () => {
            // Already on single strategy page, just add visual feedback
            singleModeBtn.style.transform = 'scale(0.95)';
            setTimeout(() => {
                singleModeBtn.style.transform = '';
            }, 100);
        });
    }
    
    if (multiModeBtn) {
        multiModeBtn.addEventListener('click', () => {
            // Check if user recently extended license - if so, refresh license data first
            chrome.storage.local.get(['pendingLicenseRecheck', 'licenseExpiry'], (data) => {
                if (data.pendingLicenseRecheck) {
                    // User clicked extend recently, perform fresh license check
                    console.log('Pending license recheck detected, refreshing license status...');
                    chrome.runtime.sendMessage({ action: 'checkLicense' }, (response) => {
                        if (response && response.success) {
                            console.log('License refreshed successfully');
                            chrome.storage.local.remove('pendingLicenseRecheck');
                            // Now check again with fresh data
                            checkAndNavigateToMultiStrategy();
                        } else {
                            // License still not valid
                            checkAndNavigateToMultiStrategy();
                        }
                    });
                } else {
                    // Normal flow - check existing license data
                    checkAndNavigateToMultiStrategy();
                }
            });
        });
    }
    
    // The multi-strategy page decides for itself whether to run, tease or sell —
    // so we always navigate and let it render the right state.
    function checkAndNavigateToMultiStrategy() {
        window.location.href = 'multiple-strategies.html';
    }
    
    // Check if user clicked "Extend License" and needs a license recheck
    chrome.storage.local.get('pendingLicenseRecheck', (data) => {
        if (data.pendingLicenseRecheck) {
            console.log('Pending license recheck detected, updating license...');
            chrome.runtime.sendMessage({ action: 'checkLicense' }, (response) => {
                if (response && response.success) {
                    console.log('License updated successfully after extension');
                }
                // Remove the flag after check
                chrome.storage.local.remove('pendingLicenseRecheck');
            });
        }
    });
    
    // FIRST: Check if there's a stored auth code in the cookie (survives uninstall)
    const storedAuthCode = await checkStoredAuthCode();
    
    if (storedAuthCode) {
        console.log('Attempting to auto-authenticate from stored cookie');
        
        // Store the auth code in both local and sync storage
        await new Promise((resolve) => {
            chrome.storage.local.set({ uniqueInstallationId: storedAuthCode }, resolve);
        });
        
        await new Promise((resolve) => {
            chrome.storage.sync.set({ uniqueInstallationId: storedAuthCode }, resolve);
        });
        
        console.log('Auto-authentication successful from cookie');
    }
    
    let strategies = {};
    let selectedStrategy = 'wyckoff';
    
    // Load strategies from JSON file
    fetch(chrome.runtime.getURL('strategies/trading-strategies.json'))
        .then(response => response.json())
        .then(data => {
            strategies = data.strategies;
            // Load saved strategy or default to wyckoff
            chrome.storage.local.get(['selectedStrategy'], (result) => {
                const savedStrategy = result.selectedStrategy || 'wyckoff';
                selectStrategy(savedStrategy);
            });
        })
        .catch(error => {
            console.error('Error loading strategies:', error);
        });
    
    // Function to select a strategy
    function selectStrategy(strategyKey) {
        selectedStrategy = strategyKey;
        
        // Update visual selection
        strategyCards.forEach(card => {
            if (card.dataset.strategy === strategyKey) {
                card.classList.add('selected');
            } else {
                card.classList.remove('selected');
            }
        });
        
        // Update the analyze button text
        if (selectedStrategyName) {
            selectedStrategyName.textContent = strategyDisplayNames[strategyKey] || strategyKey;
        }
        
        // Save selection
        chrome.storage.local.set({ selectedStrategy: strategyKey });
        
        // Scroll to the Analyze button after strategy selection
        setTimeout(() => {
            analyzeButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
    
    // Timeframe selector logic
    const timeframeBtns = document.querySelectorAll('.timeframe-btn');
    const timeframeDesc = document.getElementById('timeframe-desc');
    let selectedTimeframe = 'Scalp'; // default
    
    const timeframeDescriptions = {
        'Swing': 'Long-term trades spanning days or weeks',
        'Intraday': 'Day trading within a single trading session',
        'Scalp': 'Fast-paced trades capturing small price movements'
    };
    
    function selectTimeframe(timeframe) {
        selectedTimeframe = timeframe;
        timeframeBtns.forEach(btn => {
            if (btn.dataset.timeframe === timeframe) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        if (timeframeDesc) {
            timeframeDesc.textContent = timeframeDescriptions[timeframe];
        }
        chrome.storage.local.set({ selectedTimeframe: timeframe });
    }
    
    // Load saved timeframe
    chrome.storage.local.get(['selectedTimeframe'], (result) => {
        if (result.selectedTimeframe) {
            selectTimeframe(result.selectedTimeframe);
        } else {
            selectTimeframe('Scalp'); // Default to Scalp
        }
    });
    
    timeframeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            selectTimeframe(btn.dataset.timeframe);
        });
    });

    // Handle strategy card clicks
    strategyCards.forEach(card => {
        card.addEventListener('click', () => {
            const strategyKey = card.dataset.strategy;
            selectStrategy(strategyKey);
            
            // Add a subtle animation feedback
            card.style.transform = 'scale(0.95)';
            setTimeout(() => {
                card.style.transform = '';
            }, 100);
        });
        
        // Add hover effect to change description text with smooth fade
        const descElement = card.querySelector('.strategy-desc');
        const shortDesc = card.dataset.shortDesc;
        const fullDesc = card.dataset.fullDesc;
        
        if (descElement && shortDesc && fullDesc) {
            let hoverTimeout = null;
            
            card.addEventListener('mouseenter', () => {
                // Clear any existing timeout
                if (hoverTimeout) clearTimeout(hoverTimeout);
                
                // Fade out
                descElement.style.opacity = '0';
                
                // Wait for fade out, then change text and fade in
                hoverTimeout = setTimeout(() => {
                    descElement.textContent = fullDesc;
                    // Small delay before fading back in for smoother effect
                    setTimeout(() => {
                        descElement.style.opacity = '1';
                    }, 30);
                }, 150); // Faster transition to avoid black text moment
            });
            
            card.addEventListener('mouseleave', () => {
                // Clear any existing timeout
                if (hoverTimeout) clearTimeout(hoverTimeout);
                
                // Fade out
                descElement.style.opacity = '0';
                
                // Wait for fade out, then change text and fade in
                hoverTimeout = setTimeout(() => {
                    descElement.textContent = shortDesc;
                    // Small delay before fading back in for smoother effect
                    setTimeout(() => {
                        descElement.style.opacity = '1';
                    }, 30);
                }, 150); // Faster transition to avoid black text moment
            });
        }
    });


    // Gate the real scan on trial state, then run. Demo scans skip the gate entirely.
    analyzeButton.addEventListener('click', () => {
        Trial.getStatus((status) => {
            trialStatus = status;

            if (!status.licensed && status.scansLeft <= 0) {
                Trial.renderPaywall(trialGate);
                setTimeout(() => trialGate.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                return;
            }

            if (status.needsEmail) {
                // They've seen a result already — now it's a fair moment to ask
                Trial.renderEmailGate(trialGate, () => {
                    refreshTrial();
                    startAnalysis({});
                });
                setTimeout(() => trialGate.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                return;
            }

            startAnalysis({});
        });
    });

    if (demoButton) {
        demoButton.addEventListener('click', () => {
            demoButton.disabled = true;
            demoButton.innerHTML = '⏳ Running example analysis...';
            startAnalysis({ isDemo: true, imageData: TraidDemoChart.render() });
        });
    }

    function startAnalysis(options) {
        const isDemo = !!options.isDemo;
        const demoImage = options.imageData || null;
        trialGate.innerHTML = '';

                // --- Start Animation ---
                resultDiv.style.display = 'block';
                analyzeButton.classList.add('analyzing');

                let captureCompleted = false;
                let analyzeCompleted = false;

                // Scroll to bottom of popup
                setTimeout(() => {
                    document.body.scrollTop = document.body.scrollHeight;
                    document.documentElement.scrollTop = document.documentElement.scrollHeight;
                }, 100);

                const showPreview = (dataUrl) => {
                    // Don't overwrite if analyze already completed with error
                    if (!analyzeCompleted) {
                        resultDiv.innerHTML = `
                            ${isDemo ? '<div class="demo-result-tag">👀 Example chart — this is a live AI analysis of sample data</div>' : ''}
                            <div class="analysis-loader">
                              <img src="${dataUrl}" style="width:100%;">
                              <div class="scanner"></div>
                            </div>
                        `;

                        // Scroll to bottom again after image loads
                        setTimeout(() => {
                            document.body.scrollTop = document.body.scrollHeight;
                            document.documentElement.scrollTop = document.documentElement.scrollHeight;
                        }, 150);
                    }
                    captureCompleted = true;
                };

                if (isDemo) {
                    showPreview(demoImage);
                } else {
                    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
                        if (chrome.runtime.lastError) {
                            const msg = chrome.runtime.lastError.message;
                            analyzeButton.classList.remove('analyzing');
                            showErrorModal(`Screenshot capture failed: ${msg}`);
                            return;
                        }
                        showPreview(dataUrl);
                    });
                }
                // --- End Animation ---

                chrome.runtime.sendMessage({
                    action: 'analyze',
                    strategy: selectedStrategy,
                    timeframe: selectedTimeframe,
                    isDemo: isDemo,
                    imageData: demoImage
                }, (analyzeResponse) => {
                    console.log('Analyze response received:', analyzeResponse);
                    analyzeCompleted = true;
                    analyzeButton.classList.remove('analyzing');
                    if (demoButton) {
                        demoButton.disabled = false;
                        demoButton.innerHTML = '👀 See a live example <span class="demo-scan-sub">free — doesn\'t use a scan</span>';
                    }
                    // Refresh the free-trial counter after each scan
                    refreshTrial();

                    // Trial gates raised by the background script
                    if (analyzeResponse && analyzeResponse.emailRequired) {
                        resultDiv.innerHTML = '';
                        Trial.renderEmailGate(trialGate, () => {
                            refreshTrial();
                            startAnalysis({ isDemo: isDemo, imageData: demoImage });
                        });
                        return;
                    }
                    if (analyzeResponse && analyzeResponse.trialEnded) {
                        resultDiv.innerHTML = '';
                        Trial.renderPaywall(trialGate);
                        setTimeout(() => trialGate.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                        return;
                    }

                    // Check if response exists and has error
                    if (!analyzeResponse) {
                        console.log('No response received');
                        showErrorModal('No response received from the analysis engine. Please try again.');
                        return;
                    }

                    if (analyzeResponse.error) {
                        console.log('Error detected:', analyzeResponse.error);
                        showErrorModal(analyzeResponse.error);
                    } else if (analyzeResponse.analysis) {
                        // This parsing logic is from a previous version of the file, re-adding it.
                        try {
                          const analysisData = JSON.parse(analyzeResponse.analysis);
                          console.log('Parsed analysis data:', analysisData);
                          
                          const { "Coin Name": coin, "Order Type": orderType, "Entry Point": entry, "Stop Loss": stop, "Take Profit": profit, "Confidence Level": confidence, Explanation: explanation, dont_trade, reason } = analysisData;

                          // Check if AI decided this is a no-trade situation
                          if (dont_trade === true) {
                            const noTradeReason = reason || 'No high-probability setup identified at this time.';
                            const entryPrice = parseFloat((entry || '0').replace(/[^0-9.-]+/g,""));
                            const takeProfitPrice = parseFloat((profit || '0').replace(/[^0-9.-]+/g,""));
                            const tradeType = entryPrice < takeProfitPrice ? 'LONG' : 'SHORT';
                            const tradeClass = tradeType === 'LONG' ? 'trade-long' : 'trade-short';
                            const stars = confidence ? '⭐'.repeat(confidence) : '—';
                            const signalText = `Confidence: ${confidence}-Star Trade\nCoin name: ${coin}\nOrder Type: ${orderType}\nEntry: ${entry}\nStop Loss: ${stop}\nTake Profit: ${profit}`;
                            const fullText = `${signalText}\n\nExplanation:\n${explanation}`;

                            resultDiv.innerHTML = `
                              <div class="trade-soon-card">
                                <div class="trade-soon-badge">⏳ TRADE SOON</div>
                                <p class="trade-soon-sub">No clean entry right now — wait for the setup to develop.</p>
                                <p class="dont-trade-reason">${noTradeReason}</p>
                                <button class="show-signal-btn" id="showSignalAnyway">Show Me the Levels Anyway</button>
                                <div id="hiddenSignalWrapper" style="display:none;">
                                  <div class="trade-signal ${tradeClass}">${tradeType}</div>
                                  <div class="signal-details">
                                    <div class="signal-item"><span>Confidence</span><span>${stars}</span></div>
                                    <div class="signal-item"><span>Coin</span><span>${coin}</span></div>
                                    <div class="signal-item"><span>Order Type</span><span>${orderType}</span></div>
                                    <div class="signal-item"><span>Entry</span><span>${entry}</span></div>
                                    <div class="signal-item"><span>Stop Loss</span><span>${stop}</span></div>
                                    <div class="signal-item"><span>Take Profit</span><span>${profit}</span></div>
                                  </div>
                                  <div class="button-group">
                                    <button id="copySignal">Copy Signal</button>
                                    <button id="copyFull">Copy All</button>
                                  </div>
                                  <button id="toggleExplanation">ℹ️ Show Explanation</button>
                                  <div id="explanation" class="explanation-text" style="display: none;"><p>${explanation}</p></div>
                                </div>
                              </div>
                            `;

                            document.getElementById('showSignalAnyway').addEventListener('click', () => {
                              document.getElementById('hiddenSignalWrapper').style.display = 'block';
                              document.getElementById('showSignalAnyway').style.display = 'none';
                              document.getElementById('copySignal').addEventListener('click', () => navigator.clipboard.writeText(signalText));
                              document.getElementById('copyFull').addEventListener('click', () => navigator.clipboard.writeText(fullText));
                              document.getElementById('toggleExplanation').addEventListener('click', (e) => {
                                const explanationDiv = document.getElementById('explanation');
                                const isHidden = explanationDiv.style.display === 'none';
                                explanationDiv.style.display = isHidden ? 'block' : 'none';
                                e.target.innerHTML = isHidden ? 'ℹ️ Hide Explanation' : 'ℹ️ Show Explanation';
                              });
                            });

                            setTimeout(() => { resultDiv.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, 100);
                            return;
                          }

                          // Check if analysis cannot be performed (confidence is 0 or key fields are N/A)
                          if (confidence === 0 || entry === "N/A" || stop === "N/A" || profit === "N/A") {
                            resultDiv.innerHTML = `
                              <div class="trade-signal" style="background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);">⚠️ ANALYSIS NOT AVAILABLE</div>
                              <div class="summary-text">
                                <p><strong>Coin:</strong> ${coin || 'Unknown'}</p>
                                <p><strong>Issue:</strong> ${explanation || 'The selected strategy cannot analyze this chart with the current indicators visible.'}</p>
                                <p style="margin-top: 15px;"><strong>Tip:</strong> Try selecting a different strategy, or ensure your chart has the necessary indicators visible for the selected strategy.</p>
                              </div>
                            `;
                            return;
                          }

                          // Check which fields are missing
                          const missingFields = [];
                          if (!coin) missingFields.push('Coin Name');
                          if (!orderType) missingFields.push('Order Type');
                          if (!entry) missingFields.push('Entry Point');
                          if (!stop) missingFields.push('Stop Loss');
                          if (!profit) missingFields.push('Take Profit');
                          if (confidence === undefined || confidence === null) missingFields.push('Confidence Level');
                          if (!explanation) missingFields.push('Explanation');

                          if (missingFields.length > 0) {
                            console.error('Missing fields:', missingFields);
                            console.error('Received data:', analysisData);
                            showErrorModal(`Incomplete analysis response.\nMissing fields: ${missingFields.join(', ')}\n\nRaw response:\n${JSON.stringify(analysisData, null, 2)}`);
                          } else {
                            const entryPrice = parseFloat(entry.replace(/[^0-9.-]+/g,""));
                            const takeProfitPrice = parseFloat(profit.replace(/[^0-9.-]+/g,""));
                            const isLimitOrder = orderType && orderType.toUpperCase().includes('LIMIT');
                            const tradeType = entryPrice < takeProfitPrice ? 'LONG' : 'SHORT';
                            const tradeClass = tradeType === 'LONG' ? 'trade-long' : 'trade-short';
                            const stars = '⭐'.repeat(confidence);

                            const signalDetailsHTML = `
                              <div class="signal-details">
                                <div class="signal-item"><span>Confidence</span><span>${stars}</span></div>
                                <div class="signal-item"><span>Coin</span><span>${coin}</span></div>
                                <div class="signal-item"><span>Order Type</span><span>${orderType}</span></div>
                                <div class="signal-item"><span>Entry</span><span>${entry}</span></div>
                                <div class="signal-item"><span>Stop Loss</span><span>${stop}</span></div>
                                <div class="signal-item"><span>Take Profit</span><span>${profit}</span></div>
                              </div>
                              <div class="button-group">
                                <button id="copySignal">Copy Signal</button>
                                <button id="copyFull">Copy All</button>
                              </div>
                              <button id="toggleExplanation">ℹ️ Show Explanation</button>
                              <div id="explanation" class="explanation-text" style="display: none;"><p>${explanation}</p></div>
                            `;

                            if (isLimitOrder) {
                              resultDiv.innerHTML = `
                                <div class="trade-soon-card">
                                  <div class="trade-soon-badge">⏳ TRADE SOON</div>
                                  <p class="trade-soon-sub">Price hasn't reached the entry zone yet — set your limit order and wait.</p>
                                  <div class="trade-signal ${tradeClass}" style="margin-top:14px;">${tradeType}</div>
                                  ${signalDetailsHTML}
                                </div>
                              `;
                            } else {
                              resultDiv.innerHTML = `
                                <div class="trade-signal ${tradeClass}">${tradeType}</div>
                                ${signalDetailsHTML}
                              `;
                            }

                            const signalText = `Confidence: ${confidence}-Star Trade\nCoin name: ${coin}\nOrder Type: ${orderType}\nEntry: ${entry}\nStop Loss: ${stop}\nTake Profit: ${profit}`;
                            const fullText = `${signalText}\n\nExplanation:\n${explanation}`;

                            document.getElementById('copySignal').addEventListener('click', () => navigator.clipboard.writeText(signalText));
                            document.getElementById('copyFull').addEventListener('click', () => navigator.clipboard.writeText(fullText));
                            document.getElementById('toggleExplanation').addEventListener('click', (e) => {
                              const explanationDiv = document.getElementById('explanation');
                              const isHidden = explanationDiv.style.display === 'none';
                              explanationDiv.style.display = isHidden ? 'block' : 'none';
                              e.target.innerHTML = isHidden ? 'ℹ️ Hide Explanation' : 'ℹ️ Show Explanation';
                            });
                            
                            // Scroll to show the entire result
                            setTimeout(() => {
                              resultDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
                            }, 100);
                          }
                        } catch (e) {
                          console.error("Parsing Error:", e, "Raw response:", analyzeResponse.analysis);
                          showErrorModal(`Failed to parse API response.\n\nParse error: ${e.message}\n\nRaw response:\n${analyzeResponse.analysis}`);
                        }
                    } else {
                        showErrorModal('Unexpected response format received from the analysis engine. Please try again.');
                    }
                });
    }
});
