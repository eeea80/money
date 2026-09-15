const DOLLAR_TRIAL_EXTENSION_SOURCES = new Set([
  "extension_paywall_overlay",
  "extension_hard_gate",
  "extension_soft_gate",
  "extension_daily_gate",
  "extension_value_nudge",
  "extension_follow_up_gate",
]);

let dollarTrialCheckoutInFlight = null;

function normalizeDollarTrialExtensionSource(value) {
  return DOLLAR_TRIAL_EXTENSION_SOURCES.has(value)
    ? value
    : "extension_hard_gate";
}

function getDollarTrialWebsiteFallback(source, requiresAuth) {
  const base = requiresAuth
    ? "https://chartmentor.io/auth"
    : "https://chartmentor.io/";
  const params = new URLSearchParams({
    plan: "pro",
    billing: "monthly",
    source: requiresAuth ? "auth_resume" : source,
  });
  if (requiresAuth) {
    params.set("offer", "dollar_trial_1");
    params.set("signup_context", "extension_checkout");
  }
  const suffix = requiresAuth ? "" : "#pricing";
  return `${base}?${params.toString()}${suffix}`;
}

function isTrustedStripeCheckoutUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "checkout.stripe.com" ||
        url.hostname.endsWith(".checkout.stripe.com"))
    );
  } catch {
    return false;
  }
}

async function openCheckoutFallback(source, requiresAuth) {
  await chrome.tabs.create({
    url: getDollarTrialWebsiteFallback(source, requiresAuth),
  });
}

async function performDollarTrialCheckout(source) {
  const response = await apiRequest("/create-checkout-session", {
    method: "POST",
    body: JSON.stringify({
      planTier: "pro",
      billingCycle: "monthly",
      offer: "dollar_trial_1",
      checkoutSource: source,
    }),
  });

  if (!response?.success) {
    const requiresAuth = ["invalid_token", "session_expired"].includes(
      response?.code,
    );
    await openCheckoutFallback(source, requiresAuth);
    return {
      success: false,
      code: response?.code || "checkout_failed",
      error: response?.error || "Checkout could not be started.",
      fallbackOpened: true,
      requiresAuth,
    };
  }

  const checkoutUrl = response.data?.url;
  if (!isTrustedStripeCheckoutUrl(checkoutUrl)) {
    await openCheckoutFallback(source, false);
    return {
      success: false,
      code: "invalid_checkout_url",
      error: "Checkout returned an invalid destination.",
      fallbackOpened: true,
      requiresAuth: false,
    };
  }

  await chrome.tabs.create({ url: checkoutUrl });
  return { success: true, opened: true };
}

async function startDollarTrialCheckout(data = {}) {
  if (dollarTrialCheckoutInFlight) return dollarTrialCheckoutInFlight;
  const source = normalizeDollarTrialExtensionSource(data.source);
  dollarTrialCheckoutInFlight = performDollarTrialCheckout(source).finally(
    () => {
      dollarTrialCheckoutInFlight = null;
    },
  );
  return dollarTrialCheckoutInFlight;
}
