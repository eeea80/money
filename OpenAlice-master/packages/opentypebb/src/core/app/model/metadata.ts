/**
 * Request metadata for tracking query execution.
 * Maps to metadata attached in command_runner.py's _execute_func.
 */

export interface RequestMetadata {
  /** Route path (e.g., "/equity/price/historical"). */
  route: string
  /** Query arguments. */
  arguments: Record<string, unknown>
  /** Execution duration in milliseconds. */
  duration: number
  /** Timestamp of execution. */
  timestamp: string
}

/**
 * Create request metadata for a query execution.
 */
export function createMetadata(
  route: string,
  args: Record<string, unknown>,
  startTime: number,
): RequestMetadata {
  return {
    route,
    arguments: args,
    duration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  }
}
