/**
 * Credentials management.
 * Maps to: openbb_core/app/model/credentials.py
 *
 * In Python, Credentials is dynamically generated from all provider requirements.
 * In TypeScript, we use a simple Record<string, string> since we don't need
 * Pydantic's SecretStr obfuscation — credentials are plain strings passed through.
 */

export type Credentials = Record<string, string>

/**
 * Build a credentials record from provider key mappings.
 * Similar to how open-alice's credential-map.ts works.
 *
 * @param providerKeys - Map of short key names to API key values.
 * @param keyMapping - Map of short names to full credential names.
 * @returns Full credentials record.
 */
export function buildCredentials(
  providerKeys: Record<string, string | undefined>,
  keyMapping: Record<string, string>,
): Credentials {
  const credentials: Credentials = {}
  for (const [shortName, fullName] of Object.entries(keyMapping)) {
    const value = providerKeys[shortName]
    if (value) {
      credentials[fullName] = value
    }
  }
  return credentials
}
