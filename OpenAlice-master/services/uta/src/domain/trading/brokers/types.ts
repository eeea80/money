/**
 * Compat shim — the canonical broker types now live in
 * `@traderalice/uta-protocol`. Re-export so existing relative imports
 * inside `src/domain/trading/**` keep working until the directory is
 * physically moved into `services/uta/src/domain/trading/`.
 */
export * from '@traderalice/uta-protocol'
