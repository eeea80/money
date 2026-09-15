/**
 * External destinations.
 *
 * Gathered in one file so a changed URL never means hunting through
 * components.
 *
 * The legal pages live on **obsignals.com**, the same domain the manifest
 * declares for the API and for authentication. A reviewer who opens the manifest
 * sees `.com`, and the policy being there closes the link without them having to
 * take our word for it — which is the whole point of the field. The `.com.br`
 * copies these pages pointed to before are a separate, older site.
 */

const EXTENSION_ID = "amkbjfeoamfehgknhbnpggkkcmelkebb";

export const LINKS = {
  terms: "https://obsignals.com/terms",
  privacy: "https://obsignals.com/privacy-policy",
  rate: `https://chromewebstore.google.com/detail/obsignals/${EXTENSION_ID}/reviews`,
};
