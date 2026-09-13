import { fetchJson, headers } from './client'

export interface ToolInfo {
  name: string
  group: string
  description: string
}

export interface ToolsResponse {
  inventory: ToolInfo[]
  disabled: string[]
}

export interface ToolDetail {
  name: string
  group: string | null
  description: string
  inputSchema: Record<string, unknown>
}

export interface ExecuteResult {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

export const toolsApi = {
  async load(): Promise<ToolsResponse> {
    return fetchJson('/api/tools')
  },

  async update(disabled: string[]): Promise<{ disabled: string[] }> {
    return fetchJson('/api/tools', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ disabled }),
    })
  },

  async detail(name: string): Promise<ToolDetail> {
    return fetchJson(`/api/tools/${encodeURIComponent(name)}`)
  },

  async execute(name: string, input: Record<string, unknown>): Promise<ExecuteResult> {
    return fetchJson(`/api/tools/${encodeURIComponent(name)}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    })
  },
}
