import { z } from 'zod'

import { requireCapability } from '@lib/agent/workspaces/policy'
import { WorkspaceService } from '@lib/agent/workspaces/WorkspaceService'

import { AgentTool, AgentToolContext, AgentToolResult, OpenAIToolDefinition } from './types'

const resultText = (result: {
    ok: boolean
    stdout?: string
    stderr?: string
    message?: string
    exitCode?: number | null
}): AgentToolResult => ({
    ok: result.ok,
    output: [result.stdout, result.stderr, result.message].filter(Boolean).join('\n').trim(),
    metadata: {
        exitCode: result.exitCode ?? null,
    },
})

const statusTool: AgentTool = {
    name: 'workspace_status',
    description:
        'Check whether the current workspace computer is ready and inspect basic runtime information.',
    capability: 'files.read',
    parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
    },
    invoke: async (_args, { workspace }) => {
        const result = await WorkspaceService.status(workspace)
        return {
            ok: result.ready,
            output: [result.message, result.details].filter(Boolean).join('\n'),
        }
    },
}

const listTool: AgentTool = {
    name: 'workspace_list',
    description: 'List files and directories inside the current workspace.',
    capability: 'files.read',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Workspace-relative directory. Use "." for the project root.',
            },
        },
        additionalProperties: false,
    },
    invoke: async (args, { workspace }) => {
        const parsed = z.object({ path: z.string().default('.') }).parse(args)
        return resultText(await WorkspaceService.listFiles(workspace, parsed.path))
    },
}

const readTool: AgentTool = {
    name: 'workspace_read',
    description: 'Read a UTF-8 text file from the current workspace.',
    capability: 'files.read',
    parameters: {
        type: 'object',
        required: ['path'],
        properties: {
            path: {
                type: 'string',
                description: 'Workspace-relative file path.',
            },
            max_bytes: {
                type: 'integer',
                minimum: 1,
                maximum: 2000000,
                description: 'Maximum number of bytes to return.',
            },
        },
        additionalProperties: false,
    },
    invoke: async (args, { workspace }) => {
        const parsed = z
            .object({
                path: z.string().min(1),
                max_bytes: z.number().int().min(1).max(2_000_000).optional(),
            })
            .parse(args)
        return resultText(
            await WorkspaceService.readFile(workspace, parsed.path, parsed.max_bytes)
        )
    },
}

const writeTool: AgentTool = {
    name: 'workspace_write',
    description:
        'Create or replace a UTF-8 text file inside the current workspace. Parent directories are created automatically.',
    capability: 'files.write',
    parameters: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
            path: {
                type: 'string',
                description: 'Workspace-relative file path.',
            },
            content: {
                type: 'string',
                description: 'Complete replacement contents.',
            },
        },
        additionalProperties: false,
    },
    invoke: async (args, { workspace }) => {
        const parsed = z
            .object({
                path: z.string().min(1),
                content: z.string(),
            })
            .parse(args)
        return resultText(
            await WorkspaceService.writeFile(workspace, parsed.path, parsed.content)
        )
    },
}

const shellTool: AgentTool = {
    name: 'shell_exec',
    description:
        'Run a shell command inside the current workspace computer. The command starts in /workspace.',
    capability: 'shell.exec',
    parameters: {
        type: 'object',
        required: ['command'],
        properties: {
            command: {
                type: 'string',
                description: 'Shell command to execute.',
            },
            timeout_seconds: {
                type: 'integer',
                minimum: 5,
                maximum: 1800,
                description: 'Command timeout in seconds.',
            },
        },
        additionalProperties: false,
    },
    invoke: async (args, context) => {
        const parsed = z
            .object({
                command: z.string().min(1),
                timeout_seconds: z.number().int().min(5).max(1800).optional(),
            })
            .parse(args)

        const approved =
            context.approvedCapabilities?.includes('shell.exec') ?? false

        return resultText(
            await WorkspaceService.exec(
                context.workspace,
                {
                    command: parsed.command,
                    timeoutSeconds: parsed.timeout_seconds,
                },
                approved
            )
        )
    },
}

const TOOLS: AgentTool[] = [statusTool, listTool, readTool, writeTool, shellTool]

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]))

export namespace WorkspaceToolRegistry {
    export const list = () => TOOLS

    export const definitions = (): OpenAIToolDefinition[] =>
        TOOLS.map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }))

    export const invoke = async (
        name: string,
        args: unknown,
        context: AgentToolContext
    ): Promise<AgentToolResult> => {
        const tool = byName.get(name)
        if (!tool) {
            return {
                ok: false,
                output: 'Unknown tool: ' + name,
            }
        }

        try {
            if (tool.capability) {
                const approved =
                    context.approvedCapabilities?.includes(tool.capability) ?? false
                requireCapability(context.workspace, tool.capability, approved)
            }
            return await tool.invoke(args, context)
        } catch (error) {
            return {
                ok: false,
                output: error instanceof Error ? error.message : String(error),
            }
        }
    }
}
