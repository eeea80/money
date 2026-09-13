import { http, HttpResponse } from 'msw'

export const agentStatusHandlers = [
  http.get('/api/agent-status', () =>
    HttpResponse.json({ entries: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }),
  ),
  http.get('/api/agent-status/recent', () => HttpResponse.json({ entries: [], lastSeq: 0 })),
]
