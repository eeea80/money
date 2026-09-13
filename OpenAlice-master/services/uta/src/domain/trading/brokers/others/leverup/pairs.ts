/**
 * LeverUp pair registry — static map of supported trading pairs.
 *
 * Sourced from https://developer-docs.leverup.xyz/guide/supported-pairs.html.
 * pairBase addresses are LeverUp's internal pair identifiers; each maps to a
 * Pyth Network price feed for oracle pricing.
 *
 * The 500BTC/500ETH pairs are special "high-leverage zero-fee" pairs with
 * placeholder pairBase addresses (0x...0003 / 0x...0004) — we keep them in
 * the table but flag them so the broker's capabilities can advertise them
 * separately.
 */

export interface LeverupPair {
  /** Display symbol, e.g. "BTC/USD". Used as nativeKey in aliceId. */
  symbol: string
  base: string
  quote: string
  /** LeverUp's pair contract address (passed as `pairBase` in OpenDataInput). */
  pairBase: `0x${string}`
  /** Pyth Network price feed ID — used for fetchTicker and pythUpdateData. */
  pythFeedId: `0x${string}`
  /** Whether this is one of the 500x high-leverage zero-fee pairs. */
  highLeverage?: boolean
  /** Asset class — drives guards and aggregation logic. */
  category: 'crypto' | 'forex' | 'stock' | 'commodity'
}

/**
 * Mainnet pair list. 20 of LeverUp's documented 23 pairs are captured here;
 * the remaining 3 stocks/indices not yet visible from the docs snippet —
 * extend this list when surfaced.
 */
export const MAINNET_PAIRS: LeverupPair[] = [
  // ---- Crypto ----
  { symbol: 'BTC/USD', base: 'BTC', quote: 'USD', pairBase: '0xcf5a6076cfa32686c0df13abada2b40dec133f1d', pythFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', category: 'crypto' },
  { symbol: 'ETH/USD', base: 'ETH', quote: 'USD', pairBase: '0xb5a30b0fdc5ea94a52fdc42e3e9760cb8449fb37', pythFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', category: 'crypto' },
  { symbol: 'SOL/USD', base: 'SOL', quote: 'USD', pairBase: '0x0a3ec4fc70eaf64faf6eeda4e9b2bd4742a78546', pythFeedId: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d', category: 'crypto' },
  { symbol: 'XRP/USD', base: 'XRP', quote: 'USD', pairBase: '0xaeb724422620edb430dcaf22aeeff2e9388a578c', pythFeedId: '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8', category: 'crypto' },
  { symbol: 'MON/USD', base: 'MON', quote: 'USD', pairBase: '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', pythFeedId: '0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1', category: 'crypto' },
  // ---- High-leverage zero-fee ----
  { symbol: '500BTC/USD', base: '500BTC', quote: 'USD', pairBase: '0x0000000000000000000000000000000000000003', pythFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', category: 'crypto', highLeverage: true },
  { symbol: '500ETH/USD', base: '500ETH', quote: 'USD', pairBase: '0x0000000000000000000000000000000000000004', pythFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', category: 'crypto', highLeverage: true },
  // ---- Forex ----
  { symbol: 'EUR/USD', base: 'EUR', quote: 'USD', pairBase: '0xa9226449042e36bf6865099eec57482aa55e3ad0', pythFeedId: '0xa995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b', category: 'forex' },
  { symbol: 'USD/JPY', base: 'USD', quote: 'JPY', pairBase: '0x35b8bafff3570683af968b8d36b91b1a19465141', pythFeedId: '0xef2c98c804ba503c6a707e38be4dfbb16683775f195b091252bf24693042fd52', category: 'forex' },
  // ---- Stocks ----
  { symbol: 'QQQ/USD', base: 'QQQ', quote: 'USD', pairBase: '0xb589511c51d1ffda5d943ac1c9733e112abeff7b', pythFeedId: '0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d', category: 'stock' },
  { symbol: 'SPY/USD', base: 'SPY', quote: 'USD', pairBase: '0xcb8900160bd4a86d3b80f5ad5a44ee15823b0592', pythFeedId: '0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5', category: 'stock' },
  { symbol: 'AAPL/USD', base: 'AAPL', quote: 'USD', pairBase: '0x3a54a9a690616fbc26cfc409bf11f89d51f1d57a', pythFeedId: '0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688', category: 'stock' },
  { symbol: 'AMZN/USD', base: 'AMZN', quote: 'USD', pairBase: '0x6c755094f1cdd95e2e4170549dc12e7555151536', pythFeedId: '0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a', category: 'stock' },
  { symbol: 'TSLA/USD', base: 'TSLA', quote: 'USD', pairBase: '0x0a8f1f385fed9c77a2e0daa363ccc865e971bdbe', pythFeedId: '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1', category: 'stock' },
  { symbol: 'NVDA/USD', base: 'NVDA', quote: 'USD', pairBase: '0xe108948b9667048232851f26a1427d3a908b22da', pythFeedId: '0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593', category: 'stock' },
  { symbol: 'META/USD', base: 'META', quote: 'USD', pairBase: '0x0057355892fab25ddc63a7482ec1696d6ada6703', pythFeedId: '0x78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe', category: 'stock' },
  { symbol: 'MSFT/USD', base: 'MSFT', quote: 'USD', pairBase: '0xb2023082f01404dd0ce6937cab03c4f5d6db9ba8', pythFeedId: '0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1', category: 'stock' },
  { symbol: 'GOOG/USD', base: 'GOOG', quote: 'USD', pairBase: '0x9a4f772de1a5f6df5913fa2c98dd7177eaa23dc2', pythFeedId: '0xe65ff435be42630439c96396653a342829e877e2aafaeaf1a10d0ee5fd2cf3f2', category: 'stock' },
  // ---- Commodities ----
  { symbol: 'XAU/USD', base: 'XAU', quote: 'USD', pairBase: '0x7c687a3207cd9c05b4b11d8dd7ac337919c22001', pythFeedId: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2', category: 'commodity' },
  { symbol: 'XAG/USD', base: 'XAG', quote: 'USD', pairBase: '0x5ccc5c04130d272bf07d6e066f4cae40cfc03136', pythFeedId: '0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e', category: 'commodity' },
]

/**
 * Testnet pair list. As of writing, LeverUp's testnet pair addresses are
 * undocumented. Until Monad team confirms, testnet defaults to mainnet pairs
 * — calls against testnet will fail at the relayer, surfacing the divergence
 * loud and early. (Compare to silently skipping unsupported pairs.)
 */
export const TESTNET_PAIRS: LeverupPair[] = MAINNET_PAIRS

export function getPairs(network: 'live' | 'testnet'): LeverupPair[] {
  return network === 'testnet' ? TESTNET_PAIRS : MAINNET_PAIRS
}

export function findPairBySymbol(network: 'live' | 'testnet', symbol: string): LeverupPair | undefined {
  return getPairs(network).find(p => p.symbol === symbol)
}

export function findPairByPairBase(network: 'live' | 'testnet', pairBase: string): LeverupPair | undefined {
  const lower = pairBase.toLowerCase()
  return getPairs(network).find(p => p.pairBase.toLowerCase() === lower)
}
