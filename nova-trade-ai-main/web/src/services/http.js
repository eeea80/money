import { clearSession, getToken } from './session'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export async function request(path, options = {}) {
  const token = getToken()
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError('网络连接失败，请检查服务是否已启动', 0, 0)
  }

  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiError('服务器返回了无法识别的数据', response.status, 500)
    }
  }

  if (!response.ok || (payload && payload.code !== 0)) {
    if (response.status === 401 && token) {
      clearSession()
      if (!window.location.pathname.startsWith('/login')) {
        window.location.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)
      }
    }
    throw new ApiError(payload?.message || '请求失败，请稍后重试', response.status, payload?.code)
  }

  return payload?.data
}
