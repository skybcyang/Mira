import { validateToolPolicy, type ToolConfiguration, type ToolDefinition, type ToolPolicy, type ToolReview } from '../../domain/toolPolicy.js'

export interface ToolDraft extends Omit<ToolConfiguration, 'arguments' | 'urls'> { argumentsText: string; urlsText: string }
export const toolSourceLabels = { builtin: '内置', mcp: 'MCP', python: 'Python' }
export const toolDrafts = (policy?: ToolPolicy): ToolDraft[] => (policy?.tools || []).map(({ arguments: args, urls, ...item }) => ({ ...item, argumentsText: JSON.stringify(args, null, 2), urlsText: urls?.join('\n') || '' }))
export function draftToolPolicy(drafts: ToolDraft[], allowTemporaryPython: boolean): ToolPolicy {
  const policy = { allowTemporaryPython, tools: drafts.map(({ argumentsText, urlsText, ...item }) => {
    let args: unknown
    try { args = JSON.parse(argumentsText) } catch { throw new Error(`${item.tool.title}：请填写有效的参数 JSON。`) }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(`${item.tool.title}：参数须为 JSON 对象。`)
    const urls = urlsText.split('\n').map(url => url.trim()).filter(Boolean)
    return { ...item, arguments: args as Record<string, unknown>, ...(urls.length ? { urls } : {}) }
  }) }
  validateToolPolicy(policy)
  return policy
}
export const availableToolCatalog = (result: { builtins: ToolDefinition[]; settings: { tools: ToolDefinition[]; enabled: string[] } }) => [...result.builtins, ...result.settings.tools.filter(tool => result.settings.enabled.includes(tool.id))]
export const missingRequiredTools = (required: string[] = [], policy?: ToolPolicy) => required.filter(id => !policy?.tools.some(item => item.tool.id === id && !item.tool.requiresBinding))
export const reviewIdentity = (runId: string, review: ToolReview) => `${runId}:${review.requestId}:${review.digest}`
export const toolCatalogKey = (tool: ToolDefinition) => `${tool.id}@${tool.version}`
