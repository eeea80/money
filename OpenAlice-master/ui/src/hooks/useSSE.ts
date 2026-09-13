import { useEffect, useRef } from 'react'

interface UseSSEOptions {
  url: string
  onMessage: (data: any) => void
  enabled?: boolean
}

/**
 * SSE hook with automatic reconnection and exponential backoff.
 * onMessage is ref-stable — changing it won't tear down the connection.
 */
export function useSSE({ url, onMessage, enabled = true }: UseSSEOptions) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    if (!enabled) return

    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout>
    let backoff = 1000
    let disposed = false

    const connect = () => {
      if (disposed) return
      es = new EventSource(url)

      es.onopen = () => {
        backoff = 1000
      }

      es.onmessage = (event) => {
        try {
          onMessageRef.current(JSON.parse(event.data))
        } catch { /* ignore parse errors */ }
      }

      es.onerror = () => {
        es?.close()
        es = null
        if (!disposed) {
          timer = setTimeout(connect, backoff)
          backoff = Math.min(backoff * 2, 30_000)
        }
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(timer)
      es?.close()
    }
  }, [url, enabled])
}
