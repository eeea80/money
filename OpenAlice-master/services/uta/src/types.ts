/**
 * UTA-side runtime context.
 *
 * Separate from Alice's `EngineContext` (`@/core/types.js`) by design —
 * Alice holds the HTTP SDK adapter `UTAManagerSDK` (`resolve()` returns
 * Promise), while UTA holds the in-process `UTAManager` (`resolve()` is
 * synchronous). Sharing the type name caused tsc errors to flow into
 * the wrong process: see ANG-65 for the original four findings.
 *
 * Only three fields are exposed because that's all the UTA HTTP route
 * handlers actually read (verified by grep). If a new route needs
 * anything else off ctx, add it here — not via casting back to Alice's
 * `EngineContext`.
 */

import type { UTAManager } from './domain/trading/uta-manager.js'
import type { FxService } from './domain/trading/fx-service.js'
import type { SnapshotService } from './domain/trading/snapshot/index.js'

export interface UTAEngineContext {
  utaManager: UTAManager
  fxService: FxService
  /**
   * Optional because tests stub it out — when running for real it is
   * always set (see `services/uta/src/main.ts`). Routes that depend on
   * snapshots guard with `if (!ctx.snapshotService) ...` and return
   * gracefully.
   */
  snapshotService?: SnapshotService
}
