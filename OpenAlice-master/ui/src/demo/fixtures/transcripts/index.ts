import type { Transcript } from '../../types'
import { DEMO_WORKSPACE_ID } from '../workspaces'
import { aaplResearchTranscript } from './welcome'

// Map workspace id → transcript. Demo terminal looks up the matching
// transcript for the active workspace; no entry → DemoTerminalStub.
export const transcriptsByWorkspace: Record<string, Transcript> = {
  [DEMO_WORKSPACE_ID]: aaplResearchTranscript,
}
