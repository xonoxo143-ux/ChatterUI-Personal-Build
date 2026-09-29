export type WorkspaceRuntimeBackend = 'termux-proot'

export type WorkspaceAccessProfile = 'planning' | 'read_only' | 'full_access'

export type WorkspaceCapability =
    | 'files.read'
    | 'files.write'
    | 'shell.exec'
    | 'network.access'
    | 'process.background'
    | 'git.write'
    | 'mount.external'
    | 'runtime.manage'
    | 'workspace.destroy'

export type CapabilityDecision = 'allow' | 'ask' | 'deny'

export type WorkspaceRuntimeConfig = {
    backend: WorkspaceRuntimeBackend
    containerName: string
    image: string
}

export type Workspace = {
    id: string
    name: string
    description: string
    instructions: string
    createdAt: number
    updatedAt: number
    accessProfile: WorkspaceAccessProfile
    runtime: WorkspaceRuntimeConfig
}

export type WorkspaceCreateInput = {
    name: string
    description?: string
    instructions?: string
    image?: string
    accessProfile?: WorkspaceAccessProfile
}

export type WorkspaceRuntimeProbe = {
    backend: WorkspaceRuntimeBackend
    available: boolean
    termuxInstalled: boolean
    hostReady: boolean
    message: string
    details?: string
}

export type WorkspaceRuntimeStatus = {
    ready: boolean
    running: boolean
    message: string
    details?: string
}

export type WorkspaceExecOptions = {
    command: string
    timeoutSeconds?: number
    stdin?: string
}

export type WorkspaceExecResult = {
    ok: boolean
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
    message: string
}

export interface WorkspaceRuntime {
    readonly backend: WorkspaceRuntimeBackend
    probe(): Promise<WorkspaceRuntimeProbe>
    prepareHost(): Promise<WorkspaceExecResult>
    provision(workspace: Workspace): Promise<WorkspaceExecResult>
    status(workspace: Workspace): Promise<WorkspaceRuntimeStatus>
    exec(workspace: Workspace, options: WorkspaceExecOptions): Promise<WorkspaceExecResult>
    readFile(workspace: Workspace, path: string, maxBytes?: number): Promise<WorkspaceExecResult>
    writeFile(workspace: Workspace, path: string, content: string): Promise<WorkspaceExecResult>
    listFiles(workspace: Workspace, path?: string): Promise<WorkspaceExecResult>
}
