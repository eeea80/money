/**
 * Subscription plans.
 *
 * Prices live here, not in the locale files: they are the same number in every
 * language and change for commercial reasons. Stripe remains the source of
 * truth at checkout — these values only drive what the panel shows, so a price
 * edited in Stripe must be mirrored here (or, better, served by the API later).
 */

export const PLANS = [
  {
    id: "monthly",
    price: 10,
    currency: "USD",
    /**
     * The Stripe price, not a Payment Link.
     *
     * A link is a fixed URL that does not know who clicked it, which leaves the
     * webhook guessing the customer from the email they happened to type. The
     * server creates the session instead, and ties it to the signed-in account
     * from the first click.
     */
    priceId: "price_1POG5e02KOXCZtfZUxH8Dj3E",
  },
  {
    id: "yearly",
    /** Headline figure — what the yearly plan costs per month: 84 / 12. */
    price: 7,
    currency: "USD",
    /** 30% off twelve months at the monthly price: 10 × 12 × 0.7. */
    billedAnnually: 84,
    savingPercent: 30,
    priceId: "price_1U57Do02KOXCZtfZhHHoJ7LB",
  },
];

export const DEFAULT_PLAN = "monthly";

/** Features listed above the plan picker, resolved through i18n by key. */
export const PREMIUM_FEATURES = [
  "signals247",
  "standardMarket",
  "otcMarket",
  "timeframe1m",
  "timeframe5m",
  "cataloguer",
  "checklist",
];

/** "$10" — currency shown the way the plans are priced, in USD. */
export function formatPrice(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
