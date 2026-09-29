import { Platform } from 'react-native'

import AgentWorkspaceRuntime from '../../../../modules/agent-workspace-runtime'

import {
    Workspace,
    WorkspaceExecOptions,
    WorkspaceExecResult,
    WorkspaceRuntime,
    WorkspaceRuntimeProbe,
    WorkspaceRuntimeStatus,
} from '../types'

const TERMUX_HOME = '/data/data/com.termux/files/home'
const TERMUX_PREFIX = '/data/data/com.termux/files/usr'
const HOST_WORKSPACE_ROOT = TERMUX_HOME + '/.agentui/workspaces'
const GUEST_WORKSPACE_ROOT = '/workspace'

const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'"

const normalizeRelativePath = (path: string) => {
    const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalized || normalized === '.') return ''

    const parts = normalized.split('/').filter((part) => part && part !== '.')
    if (parts.some((part) => part === '..')) {
        throw new Error('Path escapes workspace: ' + path)
    }
    if (path.startsWith('/')) {
        throw new Error('Workspace paths must be relative: ' + path)
    }
    return parts.join('/')
}

const guestPath = (path: string) => {
    const relative = normalizeRelativePath(path)
    return relative ? GUEST_WORKSPACE_ROOT + '/' + relative : GUEST_WORKSPACE_ROOT
}

const guestParent = (path: string) => {
    const resolved = guestPath(path)
    const index = resolved.lastIndexOf('/')
    return index <= 0 ? GUEST_WORKSPACE_ROOT : resolved.slice(0, index)
}

const hostProjectPath = (workspace: Workspace) =>
    HOST_WORKSPACE_ROOT + '/' + workspace.id + '/project'

const toExecResult = (result: {
    ok: boolean
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
    message: string
}): WorkspaceExecResult => ({
    ok: result.ok,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    message: result.message,
})

const runHostCommand = async (
    command: string,
    timeoutSeconds = 120,
    stdin?: string
): Promise<WorkspaceExecResult> => {
    const result = await AgentWorkspaceRuntime.runTermuxCommand(
        command,
        TERMUX_HOME,
        timeoutSeconds,
        stdin ?? null
    )
    return toExecResult(result)
}

const buildGuestCommand = (workspace: Workspace, command: string) => {
    const project = hostProjectPath(workspace)
    const hostname = 'agent-' + workspace.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)

    return [
        'proot-distro login',
        shellQuote(workspace.runtime.containerName),
        '--isolated',
        '--bind',
        shellQuote(project + ':' + GUEST_WORKSPACE_ROOT),
        '--work-dir',
        shellQuote(GUEST_WORKSPACE_ROOT),
        '--hostname',
        shellQuote(hostname),
        '--env',
        shellQuote('AGENT_WORKSPACE_ID=' + workspace.id),
        '--env',
        shellQuote('AGENT_WORKSPACE_NAME=' + workspace.name),
        '--',
        '/bin/sh',
        '-lc',
        shellQuote(command),
    ].join(' ')
}

export class TermuxPRootRuntime implements WorkspaceRuntime {
    readonly backend = 'termux-proot' as const

    async probe(): Promise<WorkspaceRuntimeProbe> {
        if (Platform.OS !== 'android') {
            return {
                backend: this.backend,
                available: false,
                termuxInstalled: false,
                hostReady: false,
                message: 'The Termux + PRoot backend is Android-only.',
            }
        }

        const termuxInstalled = await AgentWorkspaceRuntime.isTermuxInstalled()
        if (!termuxInstalled) {
            return {
                backend: this.backend,
                available: false,
                termuxInstalled: false,
                hostReady: false,
                message: 'Termux is not installed.',
            }
        }

        const result = await runHostCommand(
            [
                'set -e',
                'printf "termux=ok\\n"',
                'if command -v proot-distro >/dev/null 2>&1; then',
                '  printf "proot_distro=ok\\n"',
                '  proot-distro --version 2>/dev/null || true',
                'else',
                '  printf "proot_distro=missing\\n"',
                '  exit 12',
                'fi',
            ].join('; '),
            30
        )

        return {
            backend: this.backend,
            available: result.ok,
            termuxInstalled: true,
            hostReady: result.ok,
            message: result.ok
                ? 'Termux and PRoot-Distro are ready.'
                : 'Termux is installed, but the workspace runtime is not ready.',
            details: [result.stdout, result.stderr, result.message].filter(Boolean).join('\n').trim(),
        }
    }

    async prepareHost(): Promise<WorkspaceExecResult> {
        return runHostCommand('pkg install -y proot-distro', 1800)
    }

    async provision(workspace: Workspace): Promise<WorkspaceExecResult> {
        const project = hostProjectPath(workspace)
        const container = workspace.runtime.containerName
        const image = workspace.runtime.image
        const currentRoot =
            TERMUX_PREFIX + '/var/lib/proot-distro/containers/' + container + '/rootfs'
        const legacyRoot =
            TERMUX_PREFIX + '/var/lib/proot-distro/installed-rootfs/' + container

        const command = [
            'set -e',
            'mkdir -p ' + shellQuote(project),
            'if [ -d ' + shellQuote(currentRoot) + ' ] || [ -d ' + shellQuote(legacyRoot) + ' ]; then',
            '  printf "Workspace computer already exists: %s\\n" ' + shellQuote(container),
            'else',
            '  proot-distro install ' + shellQuote(image) + ' --name ' + shellQuote(container),
            'fi',
            'printf "Project directory: %s\\n" ' + shellQuote(project),
        ].join('; ')

        return runHostCommand(command, 1800)
    }

    async status(workspace: Workspace): Promise<WorkspaceRuntimeStatus> {
        const result = await this.exec(workspace, {
            command:
                'printf "workspace=ready\\n"; printf "pwd=%s\\n" "$PWD"; uname -a; ' +
                'printf "shell=%s\\n" "$SHELL"',
            timeoutSeconds: 30,
        })

        return {
            ready: result.ok,
            running: false,
            message: result.ok ? 'Workspace computer is ready.' : 'Workspace computer is unavailable.',
            details: [result.stdout, result.stderr, result.message].filter(Boolean).join('\n').trim(),
        }
    }

    async exec(workspace: Workspace, options: WorkspaceExecOptions): Promise<WorkspaceExecResult> {
        const command = buildGuestCommand(workspace, options.command)
        return runHostCommand(command, options.timeoutSeconds ?? 120, options.stdin)
    }

    async readFile(
        workspace: Workspace,
        path: string,
        maxBytes = 256_000
    ): Promise<WorkspaceExecResult> {
        const resolved = guestPath(path)
        const boundedBytes = Math.max(1, Math.min(maxBytes, 2_000_000))
        return this.exec(workspace, {
            command: 'head -c ' + boundedBytes + ' -- ' + shellQuote(resolved),
            timeoutSeconds: 30,
        })
    }

    async writeFile(
        workspace: Workspace,
        path: string,
        content: string
    ): Promise<WorkspaceExecResult> {
        const resolved = guestPath(path)
        if (resolved === GUEST_WORKSPACE_ROOT) {
            throw new Error('Cannot write to the workspace root as a file.')
        }

        const parent = guestParent(path)
        return this.exec(workspace, {
            command:
                'mkdir -p -- ' +
                shellQuote(parent) +
                ' && cat > ' +
                shellQuote(resolved),
            timeoutSeconds: 60,
            stdin: content,
        })
    }

    async listFiles(workspace: Workspace, path = '.'): Promise<WorkspaceExecResult> {
        const resolved = guestPath(path)
        const command = [
            'target=' + shellQuote(resolved),
            'if [ ! -d "$target" ]; then echo "Not a directory: $target" >&2; exit 2; fi',
            'for f in "$target"/* "$target"/.[!.]* "$target"/..?*; do',
            '  [ -e "$f" ] || continue',
            '  if [ -d "$f" ]; then kind=d; size=0; else kind=f; size=$(wc -c < "$f" 2>/dev/null || echo 0); fi',
            '  name=${f##*/}',
            '  printf "%s\\t%s\\t%s\\n" "$kind" "$size" "$name"',
            'done',
        ].join('; ')

        return this.exec(workspace, { command, timeoutSeconds: 30 })
    }
}

export const termuxPRootRuntime = new TermuxPRootRuntime()
