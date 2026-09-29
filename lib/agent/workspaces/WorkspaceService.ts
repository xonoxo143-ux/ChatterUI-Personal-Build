import { requireCapability } from './policy'
import { termuxPRootRuntime } from './runtime/TermuxPRootRuntime'
import {
    Workspace,
    WorkspaceExecOptions,
    WorkspaceRuntime,
    WorkspaceRuntimeBackend,
} from './types'

const runtimes: Record<WorkspaceRuntimeBackend, WorkspaceRuntime> = {
    'termux-proot': termuxPRootRuntime,
}

const runtimeFor = (workspace: Workspace) => runtimes[workspace.runtime.backend]

export namespace WorkspaceService {
    export const getRuntime = (workspace: Workspace) => runtimeFor(workspace)

    export const probe = (workspace: Workspace) => runtimeFor(workspace).probe()

    // Explicit user action: never invoked implicitly by an agent.
    export const prepareHost = (workspace: Workspace) => runtimeFor(workspace).prepareHost()

    // Explicit user action: runtime creation is separate from the agent permission profile.
    export const provision = (workspace: Workspace) => runtimeFor(workspace).provision(workspace)

    export const status = (workspace: Workspace) => runtimeFor(workspace).status(workspace)

    export const readFile = (workspace: Workspace, path: string, maxBytes?: number) => {
        requireCapability(workspace, 'files.read')
        return runtimeFor(workspace).readFile(workspace, path, maxBytes)
    }

    export const writeFile = (workspace: Workspace, path: string, content: string) => {
        requireCapability(workspace, 'files.write')
        return runtimeFor(workspace).writeFile(workspace, path, content)
    }

    export const listFiles = (workspace: Workspace, path?: string) => {
        requireCapability(workspace, 'files.read')
        return runtimeFor(workspace).listFiles(workspace, path)
    }

    export const exec = (
        workspace: Workspace,
        options: WorkspaceExecOptions,
        userApproved = false
    ) => {
        requireCapability(workspace, 'shell.exec', userApproved)
        return runtimeFor(workspace).exec(workspace, options)
    }
}
