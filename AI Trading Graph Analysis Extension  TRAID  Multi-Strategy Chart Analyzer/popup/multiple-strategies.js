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

document.addEventListener('DOMContentLoaded', async () => {
    // Check if user recently extended license - if so, refresh license data first
    chrome.storage.local.get(['pendingLicenseRecheck', 'licenseExpiry'], (data) => {
        if (data.pendingLicenseRecheck) {
            // User clicked extend recently, perform fresh license check
            console.log('Pending license recheck detected on multi-strategy page, refreshing...');
            chrome.runtime.sendMessage({ action: 'checkLicense' }, (response) => {
                if (response && response.success) {
                    console.log('License refreshed successfully on multi-strategy page');
                    chrome.storage.local.remove('pendingLicenseRecheck');
                    // Continue with normal flow
                    checkLicenseAndShowPage();
                } else {
                    // License still not valid
                    checkLicenseAndShowPage();
                }
            });
        } else {
            // Normal flow - check existing license data
            checkLicenseAndShowPage();
        }
    });

    async function checkLicenseAndShowPage() {
        Trial.getStatus((state) => {
            // Multi-Strategy is free on scan 1, then becomes the Pro tease
            if (!state.licensed && !state.multiUnlocked && state.scansLeft > 0) {
                const wrap = document.createElement('div');
                wrap.style.padding = '16px';
                document.body.innerHTML = '';
                document.body.appendChild(wrap);
                Trial.renderMultiUpsell(wrap);
                return;
            }

            const expired = !state.licensed && state.scansLeft <= 0;
            if (expired) {
                const wrap = document.createElement('div');
                wrap.style.padding = '16px';
                document.body.innerHTML = '';
                document.body.appendChild(wrap);
                Trial.renderPaywall(wrap);
                const back = document.createElement('button');
                back.className = 'traid-btn secondary';
                back.textContent = '← Back to Single Strategy';
                back.addEventListener('click', () => { window.location.href = 'popup.html'; });
                wrap.appendChild(back);
                return;
            }
        });

        const strategyList = document.getElementById('strategy-list');
        const selectAllButton = document.getElementById('select-all');
        const selectFiveButton = document.getElementById('select-five');
        const resetSelectionButton = document.getElementById('reset-selection');
        const analyzeButton = document.getElementById('analyze');

        // Mode selector buttons
        const singleModeBtn = document.getElementById('single-mode-btn');
        const multiModeBtn = document.getElementById('multi-mode-btn');

        // Handle mode selector button clicks
        if (singleModeBtn) {
            singleModeBtn.addEventListener('click', () => {
                // Navigate back to single strategy page
                window.location.href = 'popup.html';
            });
        }

        if (multiModeBtn) {
            multiModeBtn.addEventListener('click', () => {
                // Already on multi-strategy page, just add visual feedback
                multiModeBtn.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    multiModeBtn.style.transform = '';
                }, 100);
            });
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
        const loadingContainer = document.getElementById('loading-container');
        const loadingBar = document.getElementById('loading-bar');
        const loadingText = document.getElementById('loading-text');
        const loadingPercentage = document.getElementById('loading-percentage');
        const analysisLoader = document.getElementById('analysis-loader');
        const consolidationLoader = document.getElementById('consolidation-loader');
        const scoreboard = document.getElementById('scoreboard');
        const shortScoreEl = document.getElementById('short-score');
        const longScoreEl = document.getElementById('long-score');
        const resultsContainer = document.getElementById('results');
        const copySignalsButton = document.getElementById('copy-signals');
        const conclusionButton = document.getElementById('conclusion');
        const aiSummary = document.getElementById('ai-summary');
        const licenseStatus = document.getElementById('license-status');

        // Show remaining free-trial scans for unlicensed users
        function updateTrialBanner() {
            Trial.getStatus((state) => Trial.renderBanner(licenseStatus, state));
        }
        updateTrialBanner();

        let strategies = [];
        let allSignalDetails = [];

        // Icon mapping for each strategy
        const strategyIcons = {
            'wyckoff': '../icons/wyckoff.jpg',
            'elliott-wave': '../icons/elliott.jpg',
            'support-resistance': '../icons/snr.jpg',
            'fibonacci': '../icons/fibonacci.jpg',
            'moving-averages': '../icons/ma.jpg',
            'price-action': '../icons/priceaction.jpg',
            'volume-profile': '../icons/vp.jpg',
            'ichimoku': '../icons/cloud.jpg',
            'harmonic-patterns': '../icons/harmonic.jpg',
            'market-structure': '../icons/ms.jpg'
        };

        try {
            const response = await fetch(chrome.runtime.getURL('strategies/trading-strategies.json'));
            const data = await response.json();
            strategies = Object.entries(data.strategies).map(([key, value]) => ({ key, ...value }));
            populateStrategyList();
        } catch (error) {
            console.error('Error loading strategies:', error);
            strategyList.innerHTML = '<p>Error loading strategies. Please try again later.</p>';
        }

        function populateStrategyList() {
            strategyList.innerHTML = '';
            strategies.forEach((strategy, index) => {
                const card = document.createElement('div');
                card.classList.add('strategy-card');
                card.dataset.strategyKey = strategy.key;
                card.dataset.strategyIndex = index;

                const icon = strategyIcons[strategy.key] || '../icons/logo.png';
                const shortDescription = strategy.shortDescription || 'Advanced trading';
                const fullDescription = strategy.description || 'Advanced trading analysis';

                card.innerHTML = `
                <img src="${icon}" alt="${strategy.name}" class="strategy-icon">
                <div class="strategy-info">
                    <span class="strategy-name">${strategy.name}</span>
                    <span class="strategy-desc">${shortDescription}</span>
                </div>
                <div class="strategy-check">✓</div>
            `;

                card.addEventListener('click', () => {
                    card.classList.toggle('selected');
                });

                // Add hover effect to change description text with smooth fade
                const descElement = card.querySelector('.strategy-desc');
                if (descElement) {
                    let hoverTimeout = null;

                    card.addEventListener('mouseenter', () => {
                        // Clear any existing timeout
                        if (hoverTimeout) clearTimeout(hoverTimeout);

                        // Fade out
                        descElement.style.opacity = '0';

                        // Wait for fade out, then change text and fade in
                        hoverTimeout = setTimeout(() => {
                            descElement.textContent = fullDescription;
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
                            descElement.textContent = shortDescription;
                            // Small delay before fading back in for smoother effect
                            setTimeout(() => {
                                descElement.style.opacity = '1';
                            }, 30);
                        }, 150); // Faster transition to avoid black text moment
                    });
                }

                strategyList.appendChild(card);
            });
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

        selectAllButton.addEventListener('click', () => {
            const cards = strategyList.querySelectorAll('.strategy-card');
            cards.forEach(card => card.classList.add('selected'));
        });

        selectFiveButton.addEventListener('click', () => {
            const cards = strategyList.querySelectorAll('.strategy-card');
            cards.forEach((card, index) => {
                if (index < 5) {
                    card.classList.add('selected');
                } else {
                    card.classList.remove('selected');
                }
            });
        });

        resetSelectionButton.addEventListener('click', () => {
            const cards = strategyList.querySelectorAll('.strategy-card');
            cards.forEach(card => card.classList.remove('selected'));
        });

        analyzeButton.addEventListener('click', () => {
            Trial.getStatus(function (response) {
                if (!response.licensed && response.scansLeft <= 0) {
                    Trial.renderPaywall(licenseStatus);
                    return;
                }
                if (!response.licensed && !response.multiUnlocked) {
                    Trial.renderMultiUpsell(licenseStatus);
                    return;
                }
                if (response.needsEmail) {
                    Trial.renderEmailGate(licenseStatus, () => analyzeButton.click());
                    return;
                }

                {
                    const selectedStrategies = getSelectedStrategies();
                    if (selectedStrategies.length === 0) {
                        alert('Please select at least one strategy.');
                        return;
                    }

                    // Disable analyze button and show analyzing state
                    analyzeButton.disabled = true;
                    analyzeButton.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Analyzing...</span>';
                    analyzeButton.classList.add('analyzing');

                    // Reset and show loading container
                    loadingBar.style.width = '0%';
                    loadingPercentage.textContent = '0%';
                    loadingContainer.style.display = 'block';
                    loadingText.textContent = 'Starting analysis...';

                    // Reset other containers
                    scoreboard.style.display = 'block';
                    resultsContainer.style.display = 'none';
                    conclusionButton.disabled = true;
                    aiSummary.innerHTML = '';
                    shortScoreEl.textContent = '0';
                    longScoreEl.textContent = '0';
                    allSignalDetails = [];

                    // Force a small delay to ensure DOM updates are visible
                    setTimeout(() => {
                        chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
                            if (chrome.runtime.lastError) {
                                console.error(chrome.runtime.lastError.message);
                                analyzeButton.disabled = false;
                                analyzeButton.innerHTML = '<span class="btn-icon">🔍</span><span class="btn-text">Analyze Chart</span>';
                                analyzeButton.classList.remove('analyzing');
                                return;
                            }

                            document.getElementById('screenshot').src = dataUrl;
                            analysisLoader.style.display = 'block';
                            loadingText.textContent = `Analyzing with ${selectedStrategies.length} strategies...`;

                            // Scroll to show the loading bar
                            setTimeout(() => {
                                loadingContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 100);

                            // Start progress at 0% and increment by 7% every second up to 93%
                            let currentProgress = 0;
                            const progressInterval = setInterval(() => {
                                if (currentProgress < 93) {
                                    currentProgress += 7;
                                    if (currentProgress > 93) currentProgress = 93; // Cap at 93%
                                    loadingPercentage.textContent = `${currentProgress}%`;
                                    loadingBar.style.width = `${currentProgress}%`;
                                }
                            }, 1000); // Every 1 second, increment by 7%

                            runAnalysis(selectedStrategies, progressInterval).then(() => {
                                clearInterval(progressInterval);
                                analysisLoader.style.display = 'none';
                                analyzeButton.disabled = false;
                                analyzeButton.innerHTML = '<span class="btn-icon">🔍</span><span class="btn-text">Analyze Chart</span>';
                                analyzeButton.classList.remove('analyzing');
                                // Refresh the free-trial counter after each scan
                                updateTrialBanner();
                            });
                        });
                    }, 100);
                }
            });
        });

        function runAnalysis(selectedStrategies, progressInterval) {
            return new Promise((resolve) => {
                loadingText.textContent = `Analyzing with ${selectedStrategies.length} strategies...`;

                let analysisComplete = false;
                let analysisData = null;

                // Make single consolidated API call
                chrome.runtime.sendMessage({
                    action: 'analyzeMultiStrategy',
                    selectedStrategies: selectedStrategies,
                    timeframe: selectedTimeframe
                }, (response) => {
                    analysisComplete = true;
                    analysisData = response;
                    console.log('API response received:', response);
                });

                // Wait for progress to reach at least 14% before processing results (2 seconds minimum)
                const checkCompletion = setInterval(() => {
                    const currentProgress = parseInt(loadingPercentage.textContent);

                    if (analysisComplete && currentProgress >= 14) {
                        clearInterval(checkCompletion);
                        clearInterval(progressInterval);

                        // Smoothly complete to 100%
                        loadingBar.style.width = '100%';
                        loadingPercentage.textContent = '100%';
                        loadingText.textContent = 'Analysis Complete!';

                        // Process the response
                        if (analysisData && !analysisData.error) {
                            try {
                                const consolidatedData = JSON.parse(analysisData.analysis);
                                console.log('Consolidated Analysis Data:', consolidatedData);

                                // Process individual strategy results
                                if (consolidatedData.strategies && Array.isArray(consolidatedData.strategies)) {
                                    consolidatedData.strategies.forEach(strategyResult => {
                                        const { "Strategy Name": strategyName, "Order Type": orderType, "Entry Point": entry,
                                            "Stop Loss": stop, "Take Profit": profit, "Confidence Level": confidence,
                                            "Coin Name": coin, "Explanation": explanation } = strategyResult;

                                        const entryPrice = parseFloat(entry.replace(/[^0-9.-]+/g, ""));
                                        const takeProfitPrice = parseFloat(profit.replace(/[^0-9.-]+/g, ""));
                                        const result = entryPrice < takeProfitPrice ? 'long' : 'short';

                                        const signalDetails = {
                                            method: strategyName,
                                            signal: result,
                                            coin,
                                            orderType,
                                            entry,
                                            stop,
                                            profit,
                                            confidence,
                                            explanation,
                                            details: JSON.stringify(strategyResult)
                                        };
                                        allSignalDetails.push(signalDetails);
                                    });
                                }

                                // Update scores from the API response
                                const longScore = consolidatedData["Long Score"] || 0;
                                const shortScore = consolidatedData["Short Score"] || 0;

                                shortScoreEl.textContent = shortScore;
                                longScoreEl.textContent = longScore;

                                scoreboard.scrollIntoView({ behavior: 'smooth' });

                                // Display final recommendation directly (no second AI call needed)
                                if (consolidatedData["Final Recommendation"]) {
                                    const finalRec = consolidatedData["Final Recommendation"];
                                    const { "Coin Name": coin, "Order Type": orderType, "Entry Point": entry,
                                        "Stop Loss": stop, "Take Profit": profit, "Confidence Level": confidence,
                                        "Recommendation": recommendation, "Explanation": explanation,
                                        dont_trade, reason } = finalRec;

                                    const entryPrice = parseFloat((entry || '0').replace(/[^0-9.-]+/g, ""));
                                    const takeProfitPrice = parseFloat((profit || '0').replace(/[^0-9.-]+/g, ""));
                                    const stars = confidence ? '⭐'.repeat(confidence) : '—';

                                    const isLimitOrder = orderType && orderType.toUpperCase().includes('LIMIT');
                                    const finalTradeType = entryPrice < takeProfitPrice ? 'LONG' : 'SHORT';
                                    const finalTradeClass = finalTradeType === 'LONG' ? 'trade-long' : 'trade-short';

                                    const signalDetailsHTML = `
                                        <div class="signal-details">
                                            <div class="signal-item"><span>Confidence</span><span>${stars}</span></div>
                                            <div class="signal-item"><span>Coin</span><span>${coin}</span></div>
                                            <div class="signal-item"><span>Order Type</span><span>${orderType}</span></div>
                                            <div class="signal-item"><span>Entry</span><span>${entry}</span></div>
                                            <div class="signal-item"><span>Stop Loss</span><span>${stop}</span></div>
                                            <div class="signal-item"><span>Take Profit</span><span>${profit}</span></div>
                                        </div>
                                        <div class="summary-text">
                                            <p><strong>Recommendation:</strong> ${recommendation}</p>
                                            <p><strong>Explanation:</strong> ${explanation}</p>
                                        </div>
                                    `;

                                    if (dont_trade === true) {
                                        const noTradeReason = reason || 'No high-probability setup identified at this time.';
                                        aiSummary.innerHTML = `
                                            <div class="trade-soon-card">
                                                <div class="trade-soon-badge">⏳ TRADE SOON</div>
                                                <p class="trade-soon-sub">No clean entry right now — wait for the setup to develop.</p>
                                                <p class="dont-trade-reason">${noTradeReason}</p>
                                                <button class="show-signal-btn" id="showFinalSignal">Show Me the Levels Anyway</button>
                                                <div id="hiddenFinalSignal" style="display:none;">
                                                    <div class="trade-signal ${finalTradeClass}">${finalTradeType}</div>
                                                    ${signalDetailsHTML}
                                                </div>
                                            </div>
                                        `;
                                        document.getElementById('showFinalSignal').addEventListener('click', () => {
                                            document.getElementById('hiddenFinalSignal').style.display = 'block';
                                            document.getElementById('showFinalSignal').style.display = 'none';
                                        });
                                    } else if (isLimitOrder) {
                                        aiSummary.innerHTML = `
                                            <div class="trade-soon-card">
                                                <div class="trade-soon-badge">⏳ TRADE SOON</div>
                                                <p class="trade-soon-sub">Price hasn't reached the entry zone yet — set your limit order and wait.</p>
                                                <div class="trade-signal ${finalTradeClass}" style="margin-top:14px;">${finalTradeType}</div>
                                                ${signalDetailsHTML}
                                            </div>
                                        `;
                                    } else {
                                        aiSummary.innerHTML = `
                                            <div class="trade-signal ${finalTradeClass}">${finalTradeType}</div>
                                            ${signalDetailsHTML}
                                        `;
                                    }

                                    conclusionButton.disabled = false;
                                    resultsContainer.style.display = 'block';

                                    setTimeout(() => {
                                        scoreboard.scrollIntoView({ behavior: 'smooth' });
                                    }, 100);
                                }

                            } catch (e) {
                                console.error("Parsing Error:", e, "Raw response:", analysisData.analysis);
                                aiSummary.innerHTML = `<p class="error">Failed to parse analysis results.</p><pre>${analysisData.analysis}</pre>`;
                                resultsContainer.style.display = 'block';
                            }
                        } else if (analysisData && analysisData.emailRequired) {
                            Trial.renderEmailGate(licenseStatus, () => analyzeButton.click());
                        } else if (analysisData && analysisData.trialEnded) {
                            Trial.renderPaywall(licenseStatus);
                        } else if (analysisData && analysisData.multiLocked) {
                            Trial.renderMultiUpsell(licenseStatus);
                        } else {
                            console.error('Error in multi-strategy analysis:', analysisData ? analysisData.error : 'No response');
                            const errorHtml = analysisData && analysisData.error ? displayError(analysisData.error, analysisData.isHTML) : '<p class="error">Analysis failed. Please try again.</p>';
                            aiSummary.innerHTML = errorHtml;
                            resultsContainer.style.display = 'block';
                        }

                        // Resolve the promise
                        resolve();
                    }
                }, 500); // Check every 500ms
            });
        }

        function getSelectedStrategies() {
            const selected = [];
            const selectedCards = strategyList.querySelectorAll('.strategy-card.selected');
            selectedCards.forEach(card => {
                const strategyKey = card.dataset.strategyKey;
                const strategy = strategies.find(s => s.key === strategyKey);
                if (strategy) {
                    selected.push(strategy);
                }
            });
            return selected;
        }

        function getAISummary(longScore, shortScore) {
            return new Promise(resolve => {
                chrome.runtime.sendMessage({
                    action: 'getMultiStrategySummary',
                    longScore,
                    shortScore,
                    allSignalDetails
                }, (response) => {
                    console.log('AI Summary Response:', response);
                    if (response && response.summary) {
                        try {
                            const summaryData = JSON.parse(response.summary);
                            console.log('Parsed AI Summary Data:', summaryData);
                            const { "Coin Name": coin, "Order Type": orderType, "Entry Point": entry, "Stop Loss": stop, "Take Profit": profit, "Confidence Level": confidence, "Recommendation": recommendation, "Explanation": explanation } = summaryData;

                            const entryPrice = parseFloat(entry.replace(/[^0-9.-]+/g, ""));
                            const takeProfitPrice = parseFloat(profit.replace(/[^0-9.-]+/g, ""));
                            const tradeType = entryPrice < takeProfitPrice ? 'LONG' : 'SHORT';
                            const tradeClass = tradeType === 'LONG' ? 'trade-long' : 'trade-short';
                            const stars = '⭐'.repeat(confidence);

                            aiSummary.innerHTML = `
                            <div class="trade-signal ${tradeClass}">${tradeType}</div>
                            <div class="signal-details">
                                <div class="signal-item"><span>Confidence</span><span>${stars}</span></div>
                                <div class="signal-item"><span>Coin</span><span>${coin}</span></div>
                                <div class="signal-item"><span>Order Type</span><span>${orderType}</span></div>
                                <div class="signal-item"><span>Entry</span><span>${entry}</span></div>
                            <div class="signal-item"><span>Stop Loss</span><span>${stop}</span></div>
                                <div class="signal-item"><span>Take Profit</span><span>${profit}</span></div>
                            </div>
                            <div class="summary-text">
                                <p><strong>Recommendation:</strong> ${recommendation}</p>
                                <p><strong>Explanation:</strong> ${explanation}</p>
                            </div>
                        `;
                        } catch (e) {
                            console.error("Parsing Error:", e, "Raw response:", response.summary);
                            aiSummary.innerHTML = `<pre>${response.summary}</pre>`;
                        }
                    } else if (response && response.error) {
                        console.error('Could not get AI summary. Response:', response);

                        // Use the new displayError function
                        aiSummary.innerHTML = displayError(response.error, response.isHTML);

                        // Add event listeners for buttons
                        const tutorialBtn = document.getElementById('tutorialButton');
                        if (tutorialBtn) {
                            tutorialBtn.addEventListener('click', () => {
                                window.open('https://www.solaitions.com/index.php?page=get-a-gemini-api-key', '_blank');
                            });
                        }

                        const goToSettingsBtn = document.getElementById('goToSettingsFromMulti');
                        if (goToSettingsBtn) {
                            goToSettingsBtn.addEventListener('click', () => {
                                window.location.href = 'settings.html';
                            });
                        }
                    } else {
                        console.error('Could not get AI summary. Response:', response);
                        aiSummary.innerHTML = '<p class="error">Could not get AI summary.</p>';
                    }
                    conclusionButton.disabled = false;
                    resolve();
                });
            });
        }

        copySignalsButton.addEventListener('click', () => {
            const signalText = allSignalDetails.map(s => {
                return `
Method: ${s.method}
Signal: ${s.signal}
Coin: ${s.coin}
Order Type: ${s.orderType}
Entry: ${s.entry}
Stop Loss: ${s.stop}
Take Profit: ${s.profit}
Confidence: ${s.confidence}
Explanation: ${s.explanation}
`;
            }).join('\n');
            navigator.clipboard.writeText(signalText.trim()).then(() => {
                alert('Signals copied to clipboard!');
            }, () => {
                alert('Failed to copy signals.');
            });
        });

        conclusionButton.addEventListener('click', () => {
            // Extract the recommendation and explanation from the AI summary
            const summaryElement = document.getElementById('ai-summary');
            const recommendationElement = summaryElement.querySelector('.summary-text p:nth-child(1)');
            const explanationElement = summaryElement.querySelector('.summary-text p:nth-child(2)');

            let conclusionText = '';

            if (recommendationElement && explanationElement) {
                // Get the text content without the bold labels
                const recommendation = recommendationElement.textContent.replace('Recommendation:', '').trim();
                const explanation = explanationElement.textContent.replace('Explanation:', '').trim();

                conclusionText = `Recommendation: ${recommendation}\n\nExplanation: ${explanation}`;
            } else {
                // Fallback to the entire text content if structure is different
                conclusionText = aiSummary.textContent;
            }

            navigator.clipboard.writeText(conclusionText).then(() => {
                // Change button text temporarily to show success
                const originalText = conclusionButton.textContent;
                conclusionButton.textContent = 'Copied!';
                setTimeout(() => {
                    conclusionButton.textContent = originalText;
                }, 2000);
            }, () => {
                alert('Failed to copy conclusion.');
            });
        });
    }
});
