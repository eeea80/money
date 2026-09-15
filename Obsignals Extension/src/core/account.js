import { getSession, isVerified } from "./auth.js";
import { isOtc } from "./signal.js";

/**
 * Account state.
 *
 * The one place that answers "who is this and what did they pay for". Screens
 * read from here and never from the session directly, so how an account is
 * proved stays a detail of `auth.js`.
 */

export const PLAN = /** @type {const} */ ({
  FREE: "free",
  PREMIUM: "premium",
});

/**
 * @typedef {object} Account
 * @property {boolean} signedIn
 * @property {boolean} verified  the address has been confirmed by code
 * @property {string|null} email
 * @property {"free"|"premium"} plan
 */

/** @returns {Account} */
export function getAccount() {
  const session = getSession();

  if (!session) {
    return { signedIn: false, verified: false, email: null, plan: PLAN.FREE };
  }

  return {
    signedIn: true,
    // Signed in and reachable are different questions, and the gate asks both.
    verified: isVerified(session),
    email: session.email,
    plan: toPlan(session.plan),
  };
}

/**
 * The API stores whichever plan was bought, or null for nobody. Anything named
 * is a paid plan — the panel only cares whether the signals are unlocked, and
 * treating an unrecognised plan as premium is the safe way to be wrong: a
 * paying customer never gets locked out because a plan was renamed in Stripe.
 */
function toPlan(plan) {
  return plan ? PLAN.PREMIUM : PLAN.FREE;
}

export function isPremium() {
  return getAccount().plan === PLAN.PREMIUM;
}

/**
 * Whether this account is allowed to see this signal.
 *
 * OTC is the paid half. It is what runs when the real market is shut, which is
 * most of the week — so this is not a slice of the product held back, it is the
 * hours a free account does not get.
 *
 * The rule lives here rather than in the table because the table is not the
 * only thing that has to obey it: a tab badge counting signals the reader
 * cannot open is a promise the panel does not keep.
 *
 * @param {import("./signal.js").Signal} signal
 */
export function canSee(signal) {
  return !isOtc(signal) || isPremium();
}
