/**
 * Wire-shape broker error returned by every UTA HTTP endpoint on failure.
 *
 * Translation of the in-process `BrokerError` class (which lives in UTA's
 * domain/trading and is never visible to Alice). All four fields are
 * round-trip-lossless: AI tools on the Alice side rebuild the same hint /
 * transient signal from this wire shape that they used to receive from the
 * class directly.
 */
export interface WireBrokerError {
  /** Stable error code, e.g. `RATE_LIMIT`, `INVALID_SYMBOL`, `UTA_OFFLINE`. */
  code: string
  /** Human-readable description. Surfaced to LLM in tool result. */
  message: string
  /** Whether retrying may succeed. Permanent errors should not auto-retry. */
  transient: boolean
  /** Short hint shown to the LLM about how to respond. */
  hint?: string
}
