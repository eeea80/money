import { request } from './http'

export const userApi = {
  login(data) {
    return request('/api/auth/login', { method: 'POST', body: data })
  },

  register(data) {
    return request('/api/auth/register', { method: 'POST', body: data })
  },

  logout() {
    return request('/api/auth/logout', { method: 'POST' })
  },

  getProfile() {
    return request('/api/users/me')
  },

  updateProfile(data) {
    return request('/api/users/me', { method: 'PUT', body: data })
  },

  changePassword(data) {
    return request('/api/users/me/password', { method: 'PUT', body: data })
  },
}
