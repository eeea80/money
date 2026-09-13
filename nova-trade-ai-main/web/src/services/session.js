const TOKEN_KEY = 'nova_trade_token'
const USER_KEY = 'nova_trade_user'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''
}

export function saveSession(loginResult, persistent = true) {
  clearSession()
  const storage = persistent ? localStorage : sessionStorage
  storage.setItem(TOKEN_KEY, loginResult.tokenValue)
  cacheUser(loginResult.user)
}

export function cacheUser(user) {
  if (user) {
    const storage = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage
    storage.setItem(USER_KEY, JSON.stringify(user))
  }
}

export function getCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY))
  } catch {
    return null
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
}
