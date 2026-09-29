package com.agentworkspace.runtime

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

data class TermuxCommandResult(
    val ok: Boolean,
    val started: Boolean,
    val timedOut: Boolean,
    val exitCode: Int?,
    val stdout: String,
    val stderr: String,
    val message: String,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "ok" to ok,
        "started" to started,
        "timedOut" to timedOut,
        "exitCode" to exitCode,
        "stdout" to stdout,
        "stderr" to stderr,
        "message" to message,
    )
}

/**
 * Small Android bridge to Termux RUN_COMMAND.
 *
 * The workspace layer intentionally depends on this narrow contract instead of
 * on Termux internals. That keeps the JS WorkspaceRuntime swappable for an
 * embedded PRoot runtime later.
 */
object TermuxCommandBroker {
    private const val TERMUX_PACKAGE = "com.termux"
    private const val RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService"
    private const val ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND"
    private const val TERMUX_HOME = "/data/data/com.termux/files/home"
    private const val TERMUX_BASH = "/data/data/com.termux/files/usr/bin/bash"

    private const val EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH"
    private const val EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS"
    private const val EXTRA_STDIN = "com.termux.RUN_COMMAND_STDIN"
    private const val EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR"
    private const val EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND"
    private const val EXTRA_COMMAND_LABEL = "com.termux.RUN_COMMAND_COMMAND_LABEL"
    private const val EXTRA_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT"

    const val EXTRA_PLUGIN_RESULT_BUNDLE = "result"

    private const val RESULT_KEY_STDOUT = "stdout"
    private const val RESULT_KEY_STDERR = "stderr"
    private const val RESULT_KEY_EXIT_CODE = "exitCode"
    private const val RESULT_KEY_ERR = "err"
    private const val RESULT_KEY_ERRMSG = "errmsg"
    private const val TERMUX_RESULT_OK = -1

    private val nextRequestCode = AtomicInteger(20_000)
    private val pending = ConcurrentHashMap<Int, CompletableDeferred<TermuxCommandResult>>()

    fun isInstalled(context: Context): Boolean =
        runCatching {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
        }.isSuccess

    suspend fun run(
        context: Context,
        command: String,
        workdir: String?,
        timeoutSeconds: Int,
        stdin: String?,
    ): TermuxCommandResult = withContext(Dispatchers.IO) {
        if (!isInstalled(context)) {
            return@withContext TermuxCommandResult(
                ok = false,
                started = false,
                timedOut = false,
                exitCode = null,
                stdout = "",
                stderr = "",
                message = "Termux is not installed.",
            )
        }

        val requestCode = nextRequestCode.incrementAndGet()
        val deferred = CompletableDeferred<TermuxCommandResult>()
        pending[requestCode] = deferred

        val resultIntent = Intent(context, TermuxResultService::class.java)
            .putExtra(TermuxResultService.EXTRA_REQUEST_CODE, requestCode)

        val pendingIntent = PendingIntent.getService(
            context,
            requestCode,
            resultIntent,
            PendingIntent.FLAG_ONE_SHOT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_MUTABLE
            } else {
                0
            },
        )

        val intent = Intent(ACTION_RUN_COMMAND)
            .setClassName(TERMUX_PACKAGE, RUN_COMMAND_SERVICE)
            .putExtra(EXTRA_COMMAND_PATH, TERMUX_BASH)
            .putExtra(EXTRA_ARGUMENTS, arrayOf("-lc", command))
            .putExtra(EXTRA_WORKDIR, workdir?.ifBlank { TERMUX_HOME } ?: TERMUX_HOME)
            .putExtra(EXTRA_BACKGROUND, true)
            .putExtra(EXTRA_COMMAND_LABEL, "Agent Workspace")
            .putExtra(EXTRA_PENDING_INTENT, pendingIntent)
            .apply {
                if (stdin != null) {
                    putExtra(EXTRA_STDIN, stdin)
                }
            }

        runCatching { context.startService(intent) }.onFailure { throwable ->
            pending.remove(requestCode)
            return@withContext TermuxCommandResult(
                ok = false,
                started = false,
                timedOut = false,
                exitCode = null,
                stdout = "",
                stderr = "",
                message = buildString {
                    append("Unable to start Termux RUN_COMMAND")
                    throwable.message?.let { append(": ").append(it) }
                    append(". Make sure Termux allows commands from external apps.")
                },
            )
        }

        val timeoutMillis = timeoutSeconds.coerceIn(5, 1800) * 1000L
        try {
            withTimeout(timeoutMillis) {
                deferred.await()
            }
        } catch (_: TimeoutCancellationException) {
            pending.remove(requestCode)
            TermuxCommandResult(
                ok = false,
                started = true,
                timedOut = true,
                exitCode = null,
                stdout = "",
                stderr = "",
                message = "Command did not return within " + (timeoutMillis / 1000) + " seconds.",
            )
        }
    }

    fun complete(requestCode: Int, bundle: Bundle?) {
        pending.remove(requestCode)?.complete(resultFromBundle(bundle))
    }

    private fun resultFromBundle(bundle: Bundle?): TermuxCommandResult {
        if (bundle == null) {
            return TermuxCommandResult(
                ok = false,
                started = true,
                timedOut = false,
                exitCode = null,
                stdout = "",
                stderr = "",
                message = "Termux returned no result bundle.",
            )
        }

        val exitCode = bundle.getInt(RESULT_KEY_EXIT_CODE, Int.MIN_VALUE)
            .takeIf { it != Int.MIN_VALUE }
        val err = bundle.getInt(RESULT_KEY_ERR, TERMUX_RESULT_OK)
        val stdout = bundle.getString(RESULT_KEY_STDOUT).orEmpty()
        val stderr = bundle.getString(RESULT_KEY_STDERR).orEmpty()
        val errorMessage = bundle.getString(RESULT_KEY_ERRMSG).orEmpty()
        val ok = err == TERMUX_RESULT_OK && (exitCode == null || exitCode == 0)

        return TermuxCommandResult(
            ok = ok,
            started = true,
            timedOut = false,
            exitCode = exitCode,
            stdout = stdout,
            stderr = stderr,
            message = if (ok) "Command completed." else errorMessage.ifBlank { "Command failed." },
        )
    }
}
