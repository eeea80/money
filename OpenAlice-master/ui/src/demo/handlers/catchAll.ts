import { http, HttpResponse } from 'msw'

// Last-resort 200 {} for any /api/* not explicitly mocked. RegExp literal is
// required: the glob form '/api/*' tickles a path-to-regexp v8 incompatibility
// inside MSW v2's matcher and breaks the whole handler chain.
export const catchAllHandlers = [
  http.all(/\/api\//, ({ request }) => {
    const url = new URL(request.url)
    console.warn('[demo] unmocked', request.method, url.pathname + url.search)
    return HttpResponse.json({})
  }),
]
