import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import type { UTAConfig, ReconnectResult } from '../api/types'

export interface UseTradingConfigResult {
  utas: UTAConfig[]
  loading: boolean
  error: string | null

  /** Create a new UTA — server derives id from preset + presetConfig. */
  createUTA: (a: Omit<UTAConfig, 'id'>) => Promise<UTAConfig>
  /** Edit an existing UTA. Will fail with 422 if the id doesn't exist. */
  saveUTA: (a: UTAConfig) => Promise<void>
  deleteUTA: (id: string) => Promise<void>
  reconnectUTA: (id: string) => Promise<ReconnectResult>
  refresh: () => Promise<void>
}

export function useTradingConfig(): UseTradingConfigResult {
  const [utas, setUTAs] = useState<UTAConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.trading.loadTradingConfig()
      setUTAs(data.utas)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const createUTA = useCallback(async (a: Omit<UTAConfig, 'id'>): Promise<UTAConfig> => {
    const created = await api.trading.createUTA(a)
    setUTAs((prev) => [...prev, created])
    return created
  }, [])

  const saveUTA = useCallback(async (a: UTAConfig) => {
    await api.trading.upsertUTA(a)
    setUTAs((prev) => {
      const idx = prev.findIndex((x) => x.id === a.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = a
        return next
      }
      return [...prev, a]
    })
  }, [])

  const deleteUTA = useCallback(async (id: string) => {
    await api.trading.deleteUTA(id)
    setUTAs((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const reconnectUTA = useCallback(async (id: string): Promise<ReconnectResult> => {
    return api.trading.reconnectUTA(id)
  }, [])

  return {
    utas, loading, error,
    createUTA, saveUTA, deleteUTA,
    reconnectUTA, refresh: load,
  }
}
