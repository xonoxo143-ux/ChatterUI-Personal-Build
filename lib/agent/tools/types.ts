import { Workspace, WorkspaceCapability } from '@lib/agent/workspaces/types'

export type JsonSchema = Record<string, unknown>

export type AgentToolResult = {
    ok: boolean
    output: string
    metadata?: Record<string, unknown>
}

export type AgentToolContext = {
    workspace: Workspace
    approvedCapabilities?: WorkspaceCapability[]
}

export type AgentTool = {
    name: string
    description: string
    capability?: WorkspaceCapability
    parameters: JsonSchema
    invoke: (args: unknown, context: AgentToolContext) => Promise<AgentToolResult>
}

export type OpenAIToolDefinition = {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: JsonSchema
    }
}
