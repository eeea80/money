/**
 * Zod schemas — one Request/Response pair per UTA HTTP endpoint.
 *
 * Single source of truth: Alice's client SDK uses these to parse responses;
 * UTA's Hono handlers use the same schemas with `zValidator` on inputs.
 * Schemas are populated incrementally as Step 2 of the UTA-split rollout
 * lifts each route.
 */

export {}

