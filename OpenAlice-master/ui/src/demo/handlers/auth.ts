import { http, HttpResponse } from 'msw'
import { demoAuthStatus } from '../fixtures/auth'

export const authHandlers = [
  http.get('/api/auth/status', () => HttpResponse.json(demoAuthStatus)),
  http.post('/api/auth/login', () => HttpResponse.json({ ok: true })),
  http.post('/api/auth/logout', () => HttpResponse.json({ ok: true })),
]
