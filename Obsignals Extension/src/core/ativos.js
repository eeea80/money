/**
 * The pairs the cataloguer can be asked about.
 *
 * Frozen here, like the broker names and for the same reason: they are proper
 * names, identical in every language, and they change for market reasons rather
 * than linguistic ones.
 *
 * The API has no endpoint that serves them — `/api/v2/assets`, `/pairs`,
 * `/cataloger/assets` and `/signals/assets` all answer 404 — so this is the same
 * list the Obtraders site carries, and the same place a new pair is added.
 *
 * OTC assets exist only on weekends, and the broker grid marks which brokers
 * list them at all.
 */

export const ATIVOS = {
  standard: [
    "AUDCAD", "AUDJPY", "AUDUSD", "CADCHF", "CADJPY", "CHFJPY",
    "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURJPY", "EURUSD",
    "GBPAUD", "GBPJPY", "GBPUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY",
  ],

  otc: [
    "AUDCAD-OTC", "EURGBP-OTC", "EURJPY-OTC", "EURUSD-OTC", "GBPJPY-OTC",
    "GBPUSD-OTC", "NZDUSD-OTC", "USDCAD-OTC", "USDCHF-OTC", "USDHKD-OTC",
    "USDINR-OTC", "USDJPY-OTC", "USDSGD-OTC",
  ],
};
