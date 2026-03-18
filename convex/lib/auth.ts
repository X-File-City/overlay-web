/**
 * Validates an opaque or JWT-format access token.
 * - Rejects blank / short tokens
 * - For JWT-shaped tokens (3 base64url parts), rejects expired ones
 * - Accepts all other non-empty strings as opaque tokens
 */
export function validateAccessToken(accessToken: string): boolean {
  if (!accessToken || typeof accessToken !== 'string') return false
  const trimmed = accessToken.trim()
  if (trimmed.length < 20) return false
  const parts = trimmed.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8')
      )
      if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
        return false
      }
    } catch {
      // Accept as opaque token
    }
  }
  return true
}
