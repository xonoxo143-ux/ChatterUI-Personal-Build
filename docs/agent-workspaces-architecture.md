# Agent Workspaces: architecture audit and V1 decisions

This branch turns ChatterUI's future "workspace" into a persistent **workspace computer**, not just a folder.

## Projects reviewed

The implementation was informed by these open-source projects and by ChatterUI's existing architecture:

- **ChatterUI** — keep its model manager, llama.cpp bridge, chat/session plumbing, data-source pipeline and theme system instead of rewriting mature code.
- **TermuXagent** (MIT) — good examples of a model-independent tool registry, streamed tool lifecycle events, bounded agent iterations and workspace-relative path handling.
- **AndroidAssistant / Linodx** (MIT) — demonstrated a practical Android bridge to Termux's `RUN_COMMAND` service and simple access profiles.
- **termux/proot-distro** — provides named PRoot containers, OCI/Docker image installation, explicit bind mounts, clean guest environments, process tracking, backup/restore and `--isolated` / `--minimal` modes.
- **termux-sandbox** — useful model for keeping rootfs, project workdir and Android shared-storage exposure separate.
- **uDroid** (MIT app code; third-party runtime components retain their own licenses) — important reference for modern Android executable restrictions, stable rootfs paths, rootfs install pipelines and supervisor-owned process lifecycle.
- **Conduit** (Apache-2.0 app code) — useful reference for embedding a local PRoot shell, persistent terminal sessions and responsible third-party runtime redistribution.
- **libtermux-android** (Apache-2.0) — promising future embedded backend with bootstrap, PTY/session and distro support, but its own README currently marks it experimental.
- **termagent** (MIT) — useful example of how small a coding-agent harness can be when shell/files are already available.

No dependency on those applications is required by the TypeScript workspace API. V1 uses Termux + PRoot-Distro as the first execution backend because it is the fastest way to get a real Linux computer working on-device while keeping the backend replaceable.

## The key decision

A workspace has two separate durable things:

1. **Project data** — files the user/agent is actually working on.
2. **Computer state** — rootfs, installed packages, HOME/config and processes.

For the Termux backend:

```text
Termux $HOME/.agentui/workspaces/<workspace-id>/
    project/                     <- durable project data

PRoot-Distro
    container: agentws-<id>      <- workspace computer/rootfs
        /workspace               <- explicit bind to project/
```

Project data is deliberately **outside** the Linux rootfs. Rebuilding or replacing the workspace computer must not imply deleting the project.

## Runtime boundary

Agents do not know about Termux directly. They use `WorkspaceRuntime`:

```text
Agent / Tool Registry
        |
        v
WorkspaceService + capability policy
        |
        v
WorkspaceRuntime
        |
        +-- TermuxPRootRuntime       (V1)
        +-- EmbeddedPRootRuntime     (future)
        +-- SSHRuntime               (future)
        +-- RemoteRuntime            (future)
```

This prevents the first working backend from becoming permanent architecture.

## Workspace identity

Workspace IDs are immutable UUIDs. Runtime/container names are derived from the UUID, not the display name.

Renaming a workspace therefore does not rename its filesystem or rootfs behind the agent's back.

Inside the guest, the runtime injects:

- `AGENT_WORKSPACE_ID`
- `AGENT_WORKSPACE_NAME`

and always starts tools in `/workspace`.

## Host exposure

The V1 guest starts with PRoot-Distro `--isolated` and only adds the project directory as an explicit bind.

We do **not** bind Android shared storage by default.

Future mounts should be explicit capabilities with clear modes such as:

- none
- scoped
- broader user-approved mount

## Permissions

The internal permission model is capability based, even if the UI later exposes friendly presets.

Current capabilities include:

- `files.read`
- `files.write`
- `shell.exec`
- `network.access`
- `process.background`
- `git.write`
- `mount.external`
- `runtime.manage`
- `workspace.destroy`

Each capability resolves to `allow`, `ask` or `deny`.

This is intentionally more expressive than one global "full access" toggle and lets us add human approval at the exact action boundary later.

## Agent-facing context

A workspace can generate a compact system-context block describing:

- workspace name and ID
- `/workspace` working directory
- runtime/image
- active access profile
- allowed / approval-required capabilities
- user-authored workspace instructions

That context is independent of chat history. A fresh session can know where it is without replaying an entire old conversation.

## Tool layer

The first registry exposes a small boring set:

- `workspace_status`
- `workspace_list`
- `workspace_read`
- `workspace_write`
- `shell_exec`

Tools are typed, schema-described and model-independent. This lets a future agent loop use native function calling where supported or a structured-text protocol where it is not.

## Important security boundary

PRoot is useful isolation and excellent accident containment, but it is **not a VM or hardened hostile-code sandbox**. It does not provide independent kernels, cgroups, seccomp or full namespace isolation.

V1 should be described as a rootless workspace computer/container, not as a security boundary for deliberately malicious binaries.

If hostile-code execution becomes a product goal, that requires a stronger backend.

## Android-native bridge

The local Expo module `agent-workspace-runtime` intentionally exposes a very narrow Android contract:

- detect Termux
- run one Termux command
- collect stdout/stderr/exit code
- timeout

Everything about PRoot, images, workspace paths and policy lives above that bridge.

This makes replacing external Termux with an embedded runtime practical later.

## V1 lifecycle

```text
Create workspace metadata
        |
Check host
        |
Prepare host (explicit user action)
        |
Provision named PRoot computer
        |
Bind durable project -> /workspace
        |
Agent tools operate inside workspace
```

Provisioning and host package installation are explicit user actions. An agent cannot silently install the host runtime.

## Next architectural steps

1. Verify the native module and debug APK on real Android hardware.
2. Add runtime lifecycle/state persistence and long-running process handles.
3. Add agent runs + event journal (tool calls, results, file mutations, checkpoints).
4. Link ChatterUI sessions to workspace IDs.
5. Inject workspace context and tool definitions into the model orchestration loop.
6. Add Git-aware checkpoints/diffs before destructive autonomous work.
7. Prototype an embedded PRoot backend using the uDroid/libtermux lessons, without changing the Agent or Workspace APIs.
