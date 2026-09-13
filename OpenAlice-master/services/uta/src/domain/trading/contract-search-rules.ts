/**
 * Compat shim — canonical search-rules helpers live in
 * `@traderalice/uta-protocol`. Re-export so internal callers in
 * `domain/trading/**` keep their relative `./contract-search-rules.js`
 * imports working after the directory moves into `services/uta/`.
 */
export * from '@traderalice/uta-protocol'
