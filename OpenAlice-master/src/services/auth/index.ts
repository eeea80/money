/**
 * Auth services — admin token + session lifecycle.
 *
 * See:
 *   - token-store.ts   — single admin token, scrypt-hashed at rest
 *   - session-store.ts — opaque session IDs, file-as-truth
 *   - safe/AGENT_BRIEF.md — the red-team brief that drives this design
 */

export {
  bootstrapToken,
  generateToken,
  verifyToken,
  getTokenInfo,
  clearToken,
  type TokenInfo,
} from './token-store.js'

export {
  createSession,
  validateAndTouch,
  revokeSession,
  revokeAllSessions,
  listSessions,
  type SessionRecord,
} from './session-store.js'
