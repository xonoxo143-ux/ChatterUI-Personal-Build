import { requireNativeModule } from 'expo'

export type NativeTermuxCommandResult = {
    ok: boolean
    started: boolean
    timedOut: boolean
    exitCode: number | null
    stdout: string
    stderr: string
    message: string
}

type AgentWorkspaceRuntimeModule = {
    isTermuxInstalled(): Promise<boolean>
    runTermuxCommand(
        command: string,
        workdir?: string | null,
        timeoutSeconds?: number | null,
        stdin?: string | null
    ): Promise<NativeTermuxCommandResult>
}

export default requireNativeModule<AgentWorkspaceRuntimeModule>('AgentWorkspaceRuntime')
