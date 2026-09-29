import { WORKSPACE_ACCESS_PROFILES } from './policy'
import { Workspace } from './types'

export const buildWorkspaceContext = (workspace: Workspace) => {
    const permissions = WORKSPACE_ACCESS_PROFILES[workspace.accessProfile]
    const allowed = Object.entries(permissions)
        .filter(([, decision]) => decision === 'allow')
        .map(([capability]) => capability)
        .join(', ')
    const ask = Object.entries(permissions)
        .filter(([, decision]) => decision === 'ask')
        .map(([capability]) => capability)
        .join(', ')

    const lines = [
        'WORKSPACE COMPUTER',
        'Name: ' + workspace.name,
        'Workspace ID: ' + workspace.id,
        'Working directory: /workspace',
        'Runtime: ' + workspace.runtime.backend,
        'Runtime image: ' + workspace.runtime.image,
        'Access profile: ' + workspace.accessProfile,
        'Allowed capabilities: ' + (allowed || 'none'),
        'Capabilities requiring approval: ' + (ask || 'none'),
        '',
        'Operating rules:',
        '- Treat /workspace as the project root.',
        '- Do not assume access to Android storage or other workspaces.',
        '- Keep project files in /workspace; installed packages belong to this workspace computer.',
        '- Prefer inspecting current state before mutating it.',
        '- Use tool results as ground truth and report failures rather than inventing success.',
    ]

    if (workspace.instructions.trim()) {
        lines.push('', 'Workspace instructions:', workspace.instructions.trim())
    }

    return lines.join('\n')
}
