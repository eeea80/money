let panelDollarTrialCheckoutInFlight = false;

function getDollarTrialCheckoutSource(gateType, fallbackSource) {
  if (fallbackSource) return fallbackSource;
  return (
    {
      "monthly-hard": "extension_hard_gate",
      "monthly-soft": "extension_soft_gate",
      "daily-hard": "extension_daily_gate",
      "value-nudge": "extension_value_nudge",
      "follow-up-gate": "extension_follow_up_gate",
    }[gateType] || "extension_hard_gate"
  );
}

function trackDollarTrialOfferShownFromPanel(source) {
  if (!isDollarTrialTreatmentOffer()) return;
  if (!state.dollarTrialOfferSurfacesShown) {
    state.dollarTrialOfferSurfacesShown = new Set();
  }
  if (state.dollarTrialOfferSurfacesShown.has(source)) return;
  state.dollarTrialOfferSurfacesShown.add(source);
  void trackPanelEvent("dollar_trial_offer_shown", { surface: source });
}

async function startDollarTrialCheckoutFromPanel(options = {}) {
  const button = options.button || null;
  const fallbackUrl = options.fallbackUrl || LIMIT_GATE_PRICING_URL;
  const source = getDollarTrialCheckoutSource(
    options.gateType,
    options.source,
  );

  if (!isDollarTrialTreatmentOffer()) {
    window.open(fallbackUrl, "_blank");
    return;
  }
  if (panelDollarTrialCheckoutInFlight) return;

  panelDollarTrialCheckoutInFlight = true;
  const previousText = button?.textContent || "Start 7-Day Pro for $1";
  if (button) {
    button.disabled = true;
    button.textContent = "Opening secure checkout…";
  }

  try {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "startDollarTrialCheckout", data: { source } },
        () => {
          // The background worker opens Stripe or the safe website fallback.
          void chrome.runtime.lastError;
          resolve();
        },
      );
    });
  } finally {
    panelDollarTrialCheckoutInFlight = false;
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}
