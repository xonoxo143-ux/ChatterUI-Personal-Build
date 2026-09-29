import { requireNativeModule } from 'expo'

export type NativeWorkspaceRuntimeResult = {
    ok: boolean
    started: boolean
    timedOut: boolean
    exitCode: number | null
    stdout: string
    stderr: string
    message: string
}

export type NativeWorkspaceRuntimeProbe = {
    available: boolean
    runtimeBundled: boolean
    rootfsReady: boolean
    message: string
    details: string
}

type AgentWorkspaceRuntimeModule = {
    probeWorkspace(workspaceId: string): Promise<NativeWorkspaceRuntimeProbe>
    provisionWorkspace(
        workspaceId: string,
        distroId: string
    ): Promise<NativeWorkspaceRuntimeResult>
    runWorkspaceCommand(
        workspaceId: string,
        workspaceName: string,
        command: string,
        timeoutSeconds?: number | null,
        stdin?: string | null
    ): Promise<NativeWorkspaceRuntimeResult>
}

export default requireNativeModule<AgentWorkspaceRuntimeModule>('AgentWorkspaceRuntime')
