import { Analytics } from '@vercel/analytics/react'
import type { ReactElement } from 'react'

// Mounts Vercel Web Analytics. SDK no-ops if not running on Vercel
// (e.g. local dev, electron, self-hosted) — page views are only sent
// when the deploy is the openalice-demo.vercel.app site.
export function DemoAnalytics(): ReactElement {
  return <Analytics />
}
