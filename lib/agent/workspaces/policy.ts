import {
    CapabilityDecision,
    Workspace,
    WorkspaceAccessProfile,
    WorkspaceCapability,
} from './types'

const ALL_CAPABILITIES: WorkspaceCapability[] = [
    'files.read',
    'files.write',
    'shell.exec',
    'network.access',
    'process.background',
    'git.write',
    'mount.external',
    'runtime.manage',
    'workspace.destroy',
]

const denyAll = (): Record<WorkspaceCapability, CapabilityDecision> =>
    Object.fromEntries(ALL_CAPABILITIES.map((capability) => [capability, 'deny'])) as Record<
        WorkspaceCapability,
        CapabilityDecision
    >

const planning = {
    ...denyAll(),
    'files.read': 'allow',
} satisfies Record<WorkspaceCapability, CapabilityDecision>

const readOnly = {
    ...denyAll(),
    'files.read': 'allow',
} satisfies Record<WorkspaceCapability, CapabilityDecision>

const fullAccess = {
    ...denyAll(),
    'files.read': 'allow',
    'files.write': 'allow',
    'shell.exec': 'allow',
    'network.access': 'allow',
    'process.background': 'ask',
    'git.write': 'ask',
    'mount.external': 'ask',
    'runtime.manage': 'ask',
    'workspace.destroy': 'ask',
} satisfies Record<WorkspaceCapability, CapabilityDecision>

export const WORKSPACE_ACCESS_PROFILES: Record<
    WorkspaceAccessProfile,
    Record<WorkspaceCapability, CapabilityDecision>
> = {
    planning,
    read_only: readOnly,
    full_access: fullAccess,
}

export const getCapabilityDecision = (
    workspace: Workspace,
    capability: WorkspaceCapability
): CapabilityDecision => WORKSPACE_ACCESS_PROFILES[workspace.accessProfile][capability]

export class WorkspacePermissionError extends Error {
    constructor(
        public readonly capability: WorkspaceCapability,
        public readonly decision: CapabilityDecision
    ) {
        super(
            decision === 'ask'
                ? 'Permission required for workspace capability: ' + capability
                : 'Workspace capability denied: ' + capability
        )
        this.name = 'WorkspacePermissionError'
    }
}

export const requireCapability = (
    workspace: Workspace,
    capability: WorkspaceCapability,
    allowAsk = false
) => {
    const decision = getCapabilityDecision(workspace, capability)
    if (decision === 'allow' || (decision === 'ask' && allowAsk)) return
    throw new WorkspacePermissionError(capability, decision)
}
