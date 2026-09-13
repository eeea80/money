import { useEffect, useState } from 'react'

/**
 * Track whether the viewport is at desktop width (Tailwind's `md` = 768px).
 * Returns false on mobile/tablet portrait. SSR-safe: defaults to true.
 */
export function useIsDesktop(): boolean {
  const query = '(min-width: 768px)'
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = (): void => setMatches(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return matches
}
