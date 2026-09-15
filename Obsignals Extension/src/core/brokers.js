/**
 * Brokers the signals are compatible with, and where to open an account.
 *
 * Kept out of the i18n files on purpose: these are proper names, identical in
 * every language, and they change for commercial reasons rather than
 * linguistic ones. Editing this list must never mean touching a translation.
 *
 * Each entry carries the whole address instead of a domain plus a parameter.
 * Composing it stopped being possible: PocketOption puts the code in the path
 * and Quotex moved to a domain the panel does not know. A complete URL also
 * costs nothing — it is what every affiliate program hands out.
 *
 * Order is display order, and it is deliberate rather than alphabetical: the
 * first five are a commercial decision, the rest follow access volume.
 *
 * When the panel serves these, this list is the first thing worth moving —
 * a link would change without publishing a new version to the Chrome Web Store.
 */

export const BROKERS = [
  {
    name: "Quotex",
    url: "https://broker-qx.pro/sign-up/?lid=192387",
    otc: false,
  },
  {
    name: "IqOption",
    url: "https://www.iqoption.com/pt?aff=140138",
    otc: true,
  },
  {
    name: "PocketOption",
    /* The code rides in the path here, not in the query. */
    url: "https://u3.shortink.io/smart/bAC2FB7mlcHtwv",
    otc: false,
  },
  {
    name: "Bullex",
    url: "https://trade.bull-ex.com/register?aff=383947&aff_model=revenue&afftrack=",
    otc: true,
  },
  {
    name: "Exnova",
    url: "https://exnova.com/lp/start-trading/?aff=140138&aff_model=revenue&afftrack=",
    otc: true,
  },
  {
    name: "Binomo",
    url: "https://binomo.com/?a=cbf288f25252&t=0",
    otc: false,
  },
  {
    name: "OlympTrade",
    url: "https://olymptrade.com/?affiliate_id=1573874&subid1=&subid2=",
    otc: false,
  },
  {
    name: "ExpertOption",
    url: "https://pt.expertoption.com/?prefid=1011778002&refid=getprofit&tr=1004865001&rlink=p&tsr=1787322338291&hsr=bc2847",
    otc: false,
  },
];

/** Weekends: only the brokers that actually list OTC assets. */
export const OTC_BROKERS = BROKERS.filter((broker) => broker.otc);

/**
 * Sponsored banner.
 *
 * The same partner link the grid uses for Quotex, so the two can never point at
 * different places — which is exactly what happened while the banner kept the
 * retired `qxbroker.com` address.
 */
/* So o que o JS usa. Os dois SVGs da marca sao mascaras, aplicadas pelo CSS em
   `.banner__logo` e `.banner__art` — os caminhos moravam aqui tambem, sem
   ninguem os ler, e duas verdades sobre o mesmo arquivo e como o `qxbroker.com`
   ficou para tras da ultima vez. */
export const BROKER_BANNER = {
  broker: "Quotex",
  url: BROKERS[0].url,
};
