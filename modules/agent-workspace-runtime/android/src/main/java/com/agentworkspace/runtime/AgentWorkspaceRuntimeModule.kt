package com.agentworkspace.runtime

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AgentWorkspaceRuntimeModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("AgentWorkspaceRuntime")

        AsyncFunction("isTermuxInstalled") {
            TermuxCommandBroker.isInstalled(context)
        }

        AsyncFunction("runTermuxCommand") Coroutine {
                command: String,
                workdir: String?,
                timeoutSeconds: Int?,
                stdin: String? ->
            TermuxCommandBroker.run(
                context = context,
                command = command,
                workdir = workdir,
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
