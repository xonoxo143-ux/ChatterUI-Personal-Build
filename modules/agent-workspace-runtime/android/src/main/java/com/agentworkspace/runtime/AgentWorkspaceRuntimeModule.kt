package com.agentworkspace.runtime

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AgentWorkspaceRuntimeModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("AgentWorkspaceRuntime")

        AsyncFunction("probeWorkspace") Coroutine { workspaceId: String ->
            EmbeddedWorkspaceRuntime.probe(context, workspaceId).toMap()
        }

        AsyncFunction("provisionWorkspace") Coroutine { workspaceId: String, distroId: String ->
            EmbeddedWorkspaceRuntime.provision(context, workspaceId, distroId).toMap()
        }

        AsyncFunction("runWorkspaceCommand") Coroutine {
                workspaceId: String,
                workspaceName: String,
                command: String,
                timeoutSeconds: Int?,
                stdin: String? ->
            EmbeddedWorkspaceRuntime.run(
                context = context,
                workspaceId = workspaceId,
                workspaceName = workspaceName,
                command = command,
                timeoutSeconds = timeoutSeconds ?: 120,
                stdin = stdin,
            ).toMap()
        }
    }

    private val context
        get() = requireNotNull(appContext.reactContext) {
            "React application context is unavailable"
        }
}
