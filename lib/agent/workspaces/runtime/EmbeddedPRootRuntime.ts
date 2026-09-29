import AgentWorkspaceRuntime from '../../../../modules/agent-workspace-runtime'

import {
    Workspace,
    WorkspaceExecOptions,
    WorkspaceExecResult,
    WorkspaceRuntime,
    WorkspaceRuntimeProbe,
    WorkspaceRuntimeStatus,
} from '../types'

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

export class EmbeddedPRootRuntime implements WorkspaceRuntime {
    readonly backend = 'embedded-proot' as const

    async probe(workspace: Workspace): Promise<WorkspaceRuntimeProbe> {
        const result = await AgentWorkspaceRuntime.probeWorkspace(workspace.id)
        return {
            backend: this.backend,
            available: result.available,
            runtimeBundled: result.runtimeBundled,
            rootfsReady: result.rootfsReady,
            message: result.message,
            details: result.details,
        }
    }

    async prepareHost(): Promise<WorkspaceExecResult> {
        return {
            ok: true,
            exitCode: 0,
            stdout: '',
            stderr: '',
            timedOut: false,
            message: 'The Linux runtime is built into this app; no separate host setup is required.',
        }
    }

    async provision(workspace: Workspace): Promise<WorkspaceExecResult> {
        return toExecResult(
            await AgentWorkspaceRuntime.provisionWorkspace(
                workspace.id,
                workspace.runtime.distroId
            )
        )
    }

    async status(workspace: Workspace): Promise<WorkspaceRuntimeStatus> {
        const probe = await this.probe(workspace)
        if (!probe.rootfsReady) {
            return {
                ready: false,
                running: false,
                message: probe.message,
                details: probe.details,
            }
        }

        const result = await this.exec(workspace, {
            command:
                'printf "workspace=ready\\n"; printf "pwd=%s\\n" "$PWD"; ' +
                'uname -a; printf "shell=%s\\n" "$SHELL"',
            timeoutSeconds: 30,
        })

        return {
            ready: result.ok,
            running: false,
            message: result.ok
                ? 'Workspace computer is ready.'
                : 'Workspace computer is unavailable.',
            details: [result.stdout, result.stderr, result.message].filter(Boolean).join('\n').trim(),
        }
    }

    async exec(workspace: Workspace, options: WorkspaceExecOptions): Promise<WorkspaceExecResult> {
        return toExecResult(
            await AgentWorkspaceRuntime.runWorkspaceCommand(
                workspace.id,
                workspace.name,
                options.command,
                options.timeoutSeconds ?? 120,
                options.stdin ?? null
            )
        )
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

        return this.exec(workspace, {
            command:
                'mkdir -p -- ' +
                shellQuote(guestParent(path)) +
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

export const embeddedPRootRuntime = new EmbeddedPRootRuntime()
