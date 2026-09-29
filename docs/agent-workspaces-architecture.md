# Agent Workspaces V2

This branch keeps the useful architecture from the first Termux-backed spike but removes the
separate-Termux requirement.

## Product model

A workspace is a persistent place where an agent works. It is not a chat and it is not the Linux
rootfs itself.

A workspace owns:

- identity and instructions
- durable project files
- an attached default execution runtime
- permissions
- links to agents/characters and chats
- later: tasks, runs, events, memory and checkpoints

The Linux computer is replaceable. Rebuilding the computer must not imply deleting the project.

## Persistence

Durable workspace metadata now uses ChatterUI's existing SQLite/Drizzle database:

- `workspaces`
- `workspace_runtimes`
- `workspace_permissions`
- `workspace_characters`
- `workspace_chats`

MMKV only remembers lightweight UI state such as the currently selected workspace.

Project files are real files, not SQLite blobs.

## On-device layout

```text
app private storage/
  agent-workspaces/
    <workspace UUID>/
      project/             <- durable project data
      computer/
        rootfs/            <- this workspace's Linux environment
        downloads/         <- verified install payloads while provisioning
```

Inside Linux, `project/` is mounted at:

```text
/workspace
```

Tools and agents always begin there.

## Embedded runtime

The first real backend is `embedded-proot`.

```text
ChatterUI / Agent tools
        |
        v
WorkspaceService + capability policy
        |
        v
WorkspaceRuntime interface
        |
        v
EmbeddedPRootRuntime
        |
        v
local Expo Android module
        |
        +-- packaged PRoot executable
        +-- packaged PRoot loader
        +-- packaged GNU tar
        +-- verified Linux rootfs download
```

There is no dependency on the separate Termux application.

The runtime design borrows proven Android mechanics from uDroid and packaging ideas from Conduit,
while keeping our own small interface so the backend can still be replaced later.

## Modern Android execution

Recent Android versions restrict directly executing arbitrary ELF files written into normal
app-private writable storage.

The embedded backend therefore:

1. packages PRoot's helper loader as an APK native library;
2. copies the PRoot executable from a trusted APK asset into app-private runtime storage;
3. invokes the PRoot executable through Android's system linker on Android 10+;
4. sets `PROOT_LOADER` to the loader extracted by Android into the native-library directory.

This is the important uDroid lesson that prevents us from discovering Android's execution
restrictions after the rest of the agent system is built.

## Runtime payload

The branch contains reproducible build scripts for arm64:

- `tools/embedded-runtime/build-proot-assets.sh`
- `tools/embedded-runtime/build-gnu-tar-assets.sh`

GitHub Actions builds the payload from pinned upstream sources and commits:

- PRoot
- the PRoot static loader
- GNU tar
- SHA-256 records for the generated binaries

The initial personal build targets `arm64-v8a`, matching the target phone. Other ABIs can be
added later.

## Linux images

Linux is downloaded on first install rather than making the base APK enormous.

V2 currently recognizes pinned, checksum-verified images for:

- Debian 13 (Trixie)
- Alpine Linux 3.22

Provisioning follows this shape:

```text
download/resume
    -> SHA-256 verify
    -> mark installation in progress
    -> extract
    -> apply Android/PRoot compatibility setup
    -> run a real command inside Linux
    -> mark ready only if health check passes
```

Interrupted installs are distinguishable from ready installs.

## Android exposure

The Linux guest does not automatically receive Android shared storage.

It gets the Android system mounts PRoot needs plus one explicit project bind:

```text
host: <workspace>/project
guest: /workspace
```

Additional phone storage should become explicit user-approved mounts later.

## Runtime abstraction

Agents do not know about PRoot.

`WorkspaceRuntime` exposes the useful concepts:

- probe
- provision
- status
- execute command
- read file
- write file
- list files

That allows later backends such as a stronger local sandbox, SSH or a remote machine without
rewriting the Agent or Workspace model.

## Permissions

Agent-facing operations pass through capability policy:

- files.read
- files.write
- shell.exec
- network.access
- process.background
- git.write
- mount.external
- runtime.manage
- workspace.destroy

Each can resolve to `allow`, `ask` or `deny`.

The current UI is still a development surface; human approval flows for `ask` capabilities come
later.

## Security wording

PRoot is rootless process/filesystem virtualization and useful accident containment. It is not a
VM or a hardened boundary for deliberately malicious native code. We should describe it as a
workspace computer/environment, not promise hostile-code isolation that it does not provide.

## Next layers

Once device execution is proven, the next product layers are:

1. link normal ChatterUI sessions to workspaces;
2. add durable AgentRun / Task / Event history;
3. connect the existing model inference loop to the workspace tool registry;
4. add background process/PTY handles;
5. add Git checkpoints and diffs;
6. add workspace memory/context sources;
7. consider rootfs cloning/shared-base optimizations if per-workspace Linux storage becomes costly.
