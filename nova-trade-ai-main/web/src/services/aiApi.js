import { API_BASE_URL, ApiError, request } from './http'
import { clearSession, getToken } from './session'

function parseEventBlock(block) {
  const event = { type: 'message', data: null }
  const dataLines = []

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event.type = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (!dataLines.length) return null
  try {
    event.data = JSON.parse(dataLines.join('\n'))
  } catch {
    throw new ApiError('AI 服务返回了无法识别的数据', 500, 500)
  }
  return event
}

async function createResponseError(response) {
  let message = 'AI 服务请求失败，请稍后重试'
  let code = response.status
  try {
    const payload = await response.json()
    message = payload?.message || message
    code = payload?.code ?? code
  } catch {
    // 非 JSON 错误响应使用默认提示。
  }
  return new ApiError(message, response.status, code)
}

export const aiApi = {
  getConversations(limit = 20) {
    return request(`/api/ai/conversations?limit=${limit}`)
  },

  createConversation() {
    return request('/api/ai/conversations', { method: 'POST' })
  },

  deleteConversation(conversationId) {
    return request(`/api/ai/conversations/${conversationId}`, { method: 'DELETE' })
  },

  getConversationMessages(conversationId, limit = 100) {
    return request(`/api/ai/conversations/${conversationId}/messages?limit=${limit}`)
  },

  getHistory(limit = 100) {
    return request(`/api/ai/chat/history?limit=${limit}`)
  },

  clearHistory() {
    return request('/api/ai/chat/history', { method: 'DELETE' })
  },

  async streamChat(conversationId, message, { signal, onChunk } = {}) {
    const token = getToken()
    let response

    try {
      response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        signal,
        headers: {
          Accept: 'text/event-stream, application/json',
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conversationId, message }),
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new ApiError('网络连接失败，请检查服务是否已启动', 0, 0)
    }

    if (!response.ok) {
      if (response.status === 401 && token) {
        clearSession()
        window.location.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)
      }
      throw await createResponseError(response)
    }
    if (!response.body) {
      throw new ApiError('当前浏览器不支持流式响应', 500, 500)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const consume = (block) => {
      const event = parseEventBlock(block)
      if (!event) return
      if (event.type === 'message') {
        onChunk?.(event.data?.content || '')
      } else if (event.type === 'error') {
        throw new ApiError(event.data?.content || 'AI 回复失败', 503, 503)
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n')

        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          consume(buffer.slice(0, boundary))
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
        }

        if (done) {
          if (buffer.trim()) consume(buffer)
          break
        }
      }
    } finally {
      reader.releaseLock()
    }
  },
}
