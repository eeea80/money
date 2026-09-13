import { request } from './http'

export const stockAnalysisApi = {
  analyze(stockName) {
    return request('/api/ai/stocks/canslim', {
      method: 'POST',
      body: { stockName },
    })
  },
}
