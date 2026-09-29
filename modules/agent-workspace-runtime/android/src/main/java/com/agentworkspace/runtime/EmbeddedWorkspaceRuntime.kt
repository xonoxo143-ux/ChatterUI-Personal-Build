package com.agentworkspace.runtime

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.tukaani.xz.XZInputStream
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

data class EmbeddedRuntimeResult(
    val ok: Boolean,
    val started: Boolean = false,
    val timedOut: Boolean = false,
    val exitCode: Int? = null,
    val stdout: String = "",
    val stderr: String = "",
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

data class EmbeddedRuntimeProbe(
    val available: Boolean,
    val runtimeBundled: Boolean,
    val rootfsReady: Boolean,
    val message: String,
    val details: String = "",
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "available" to available,
        "runtimeBundled" to runtimeBundled,
        "rootfsReady" to rootfsReady,
        "message" to message,
        "details" to details,
    )
}

private data class DistroManifest(
    val id: String,
    val version: String,
    val archiveUrl: String,
    val sha256: String,
)

private data class RuntimePayload(
    val proot: File,
    val tar: File,
    val loader: File,
)

private data class WorkspacePaths(
    val workspaceRoot: File,
    val project: File,
    val computer: File,
    val rootfs: File,
    val downloads: File,
    val archive: File,
) {
    val readyMarker: File get() = File(rootfs, ".agentui-ready")
    val installingMarker: File get() = File(rootfs, ".agentui-installing")
}

object EmbeddedWorkspaceRuntime {
    private const val RUNTIME_VERSION = "proot-5.1.107.86"
    private const val MAX_CAPTURE_BYTES = 2 * 1024 * 1024
    private val SAFE_WORKSPACE_ID = Regex("[A-Za-z0-9][A-Za-z0-9-]{0,63}")

    private val distros = mapOf(
        "debian" to DistroManifest(
            id = "debian",
            version = "debian-13-trixie-pd-v4.29.0",
            archiveUrl = "https://github.com/termux/proot-distro/releases/download/v4.29.0/debian-trixie-aarch64-pd-v4.29.0.tar.xz",
            sha256 = "3834a11cbc6496935760bdc20cca7e2c25724d0cd8f5e4926da8fd5ca1857918",
        ),
        "alpine" to DistroManifest(
            id = "alpine",
            version = "alpine-3.22-pd-v4.30.1",
            archiveUrl = "https://github.com/termux/proot-distro/releases/download/v4.30.1/alpine-aarch64-pd-v4.30.1.tar.xz",
            sha256 = "bb23e51cd5b5ae56bf946a34992876902de1bb2ecc0f639d59c702c6371adc62",
        ),
    )

    suspend fun probe(context: Context, workspaceId: String): EmbeddedRuntimeProbe =
        withContext(Dispatchers.IO) {
            try {
                requireWorkspaceId(workspaceId)
                val payload = installRuntimePayload(context)
                val paths = workspacePaths(context, workspaceId)
                val ready = paths.readyMarker.isFile
                EmbeddedRuntimeProbe(
                    available = true,
                    runtimeBundled = payload.proot.isFile && payload.tar.isFile && payload.loader.isFile,
                    rootfsReady = ready,
                    message = if (ready) {
                        "Embedded Linux workspace is ready."
                    } else {
                        "Embedded runtime is bundled; this workspace Linux image is not installed yet."
                    },
                    details = buildString {
                        appendLine("abi=${selectedAbi()}")
                        appendLine("runtime=$RUNTIME_VERSION")
                        appendLine("rootfs=${paths.rootfs.absolutePath}")
                        append("project=${paths.project.absolutePath}")
                    },
                )
            } catch (error: Throwable) {
                EmbeddedRuntimeProbe(
                    available = false,
                    runtimeBundled = false,
                    rootfsReady = false,
                    message = error.message ?: error.javaClass.simpleName,
                )
            }
        }

    suspend fun provision(
        context: Context,
        workspaceId: String,
        distroId: String,
    ): EmbeddedRuntimeResult = withContext(Dispatchers.IO) {
        try {
            requireWorkspaceId(workspaceId)
            val manifest = distros[distroId]
                ?: return@withContext EmbeddedRuntimeResult(
                    ok = false,
                    message = "Unsupported Linux image: $distroId",
                )
            val payload = installRuntimePayload(context)
            val paths = workspacePaths(context, workspaceId)
            ensureDirectory(paths.project)
            ensureDirectory(paths.computer)
            ensureDirectory(paths.downloads)

            if (paths.readyMarker.isFile) {
                return@withContext EmbeddedRuntimeResult(
                    ok = true,
                    message = "Workspace Linux image is already ready.",
                    stdout = "distro=${manifest.version}\n",
                )
            }

            clearInterruptedInstall(paths)
            if (paths.rootfs.exists()) {
                return@withContext EmbeddedRuntimeResult(
                    ok = false,
                    message = "Workspace has an unrecognized incomplete Linux image; refusing to overwrite it.",
                )
            }

            downloadVerified(manifest, paths.archive)
            check(paths.rootfs.mkdirs()) { "Could not create workspace rootfs." }
            writeMarker(paths.installingMarker, "distro=${manifest.version}\nruntime=$RUNTIME_VERSION\n")

            try {
                extractRootfs(context, payload, paths.archive, paths.rootfs)
                configureRootfs(paths.rootfs)

                val health = runGuest(
                    context = context,
                    payload = payload,
                    paths = paths,
                    workspaceId = workspaceId,
                    workspaceName = workspaceId,
                    command = "test -x /bin/sh && test -r /etc/os-release && printf 'health=ok\\n' && uname -m",
                    timeoutSeconds = 60,
                    stdin = null,
                    requireReady = false,
                )
                check(health.ok) {
                    "Linux image health check failed: " +
                        listOf(health.stderr, health.message)
                            .filter(String::isNotBlank)
                            .joinToString("\n")
                }

                writeMarker(
                    paths.readyMarker,
                    "distro=${manifest.version}\nruntime=$RUNTIME_VERSION\n",
                )
                paths.installingMarker.delete()
                paths.archive.delete()

                EmbeddedRuntimeResult(
                    ok = true,
                    started = true,
                    exitCode = 0,
                    stdout = health.stdout,
                    message = "Workspace Linux image installed and verified.",
                )
            } catch (error: Throwable) {
                if (paths.installingMarker.isFile) paths.rootfs.deleteRecursively()
                throw error
            }
        } catch (error: Throwable) {
            EmbeddedRuntimeResult(
                ok = false,
                started = true,
                message = error.message ?: error.javaClass.simpleName,
            )
        }
    }

    suspend fun run(
        context: Context,
        workspaceId: String,
        workspaceName: String,
        command: String,
        timeoutSeconds: Int,
        stdin: String?,
    ): EmbeddedRuntimeResult = withContext(Dispatchers.IO) {
        try {
            requireWorkspaceId(workspaceId)
            require(command.isNotBlank()) { "Command must not be blank." }
            runGuest(
                context = context,
                payload = installRuntimePayload(context),
                paths = workspacePaths(context, workspaceId),
                workspaceId = workspaceId,
                workspaceName = workspaceName,
                command = command,
                timeoutSeconds = timeoutSeconds,
                stdin = stdin,
                requireReady = true,
            )
        } catch (error: Throwable) {
            EmbeddedRuntimeResult(
                ok = false,
                message = error.message ?: error.javaClass.simpleName,
            )
        }
    }

    private fun selectedAbi(): String {
        val supported = setOf("arm64-v8a")
        return Build.SUPPORTED_ABIS.firstOrNull { it in supported }
            ?: error("This build currently includes the embedded runtime only for arm64-v8a.")
    }

    private fun installRuntimePayload(context: Context): RuntimePayload {
        val abi = selectedAbi()
        val runtimeDir = File(context.filesDir, "runtime/$RUNTIME_VERSION-$abi")
        ensureDirectory(runtimeDir)

        val proot = File(runtimeDir, "proot")
        val tar = File(runtimeDir, "tar")
        installAssetExecutable(context, "runtime/$abi/proot", proot, "PRoot")
        installAssetExecutable(context, "runtime/$abi/tar", tar, "GNU tar")

        val loader = File(context.applicationInfo.nativeLibraryDir, "libproot_loader.so")
        check(loader.isFile && loader.canExecute()) {
            "Embedded PRoot loader is missing from the APK."
        }
        return RuntimePayload(proot = proot, tar = tar, loader = loader)
    }

    private fun installAssetExecutable(
        context: Context,
        assetPath: String,
        destination: File,
        label: String,
    ) {
        if (destination.isFile && destination.canExecute()) return
        ensureDirectory(requireNotNull(destination.parentFile))
        val staging = File(destination.parentFile, destination.name + ".staging")
        staging.delete()

        try {
            context.assets.open(assetPath).use { input ->
                FileOutputStream(staging).use { output ->
                    input.copyTo(output)
                    output.fd.sync()
                }
            }
        } catch (error: Throwable) {
            staging.delete()
            throw IllegalStateException(
                "$label runtime asset is not bundled for ${selectedAbi()}.",
                error,
            )
        }

        check(staging.setReadable(true, true)) { "Could not make $label readable." }
        check(staging.setWritable(true, true)) { "Could not make $label writable." }
        check(staging.setExecutable(true, true)) { "Could not make $label executable." }
        if (destination.exists()) check(destination.delete()) { "Could not replace old $label." }
        check(staging.renameTo(destination)) { "Could not activate $label." }
    }

    private fun workspacePaths(context: Context, workspaceId: String): WorkspacePaths {
        requireWorkspaceId(workspaceId)
        val workspaceRoot = File(context.filesDir, "agent-workspaces/$workspaceId")
        val computer = File(workspaceRoot, "computer")
        return WorkspacePaths(
            workspaceRoot = workspaceRoot,
            project = File(workspaceRoot, "project"),
            computer = computer,
            rootfs = File(computer, "rootfs"),
            downloads = File(computer, "downloads"),
            archive = File(computer, "downloads/rootfs.tar.xz"),
        )
    }

    private fun requireWorkspaceId(workspaceId: String) {
        require(SAFE_WORKSPACE_ID.matches(workspaceId)) { "Unsafe workspace ID." }
    }

    private fun clearInterruptedInstall(paths: WorkspacePaths) {
        if (!paths.installingMarker.isFile) return
        check(paths.rootfs.deleteRecursively()) {
            "Could not clear interrupted workspace Linux installation."
        }
    }

    private fun downloadVerified(manifest: DistroManifest, destination: File) {
        ensureDirectory(requireNotNull(destination.parentFile))
        val partial = File(destination.parentFile, destination.name + ".part")

        if (destination.isFile && sha256(destination) == manifest.sha256) return
        destination.delete()

        var existing = if (partial.isFile) partial.length() else 0L
        val connection = URL(manifest.archiveUrl).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = true
        connection.connectTimeout = 30_000
        connection.readTimeout = 60_000
        connection.setRequestProperty("User-Agent", "AgentUI-EmbeddedRuntime/1")
        if (existing > 0L) connection.setRequestProperty("Range", "bytes=$existing-")
        connection.connect()

        val response = connection.responseCode
        val resuming = response == HttpURLConnection.HTTP_PARTIAL
        check(response == HttpURLConnection.HTTP_OK || resuming) {
            "Linux image download failed with HTTP $response."
        }
        if (!resuming) {
            partial.delete()
            existing = 0L
        }

        FileOutputStream(partial, resuming).use { output ->
            connection.inputStream.use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
            }
            output.fd.sync()
        }
        connection.disconnect()

        val digest = sha256(partial)
        check(digest == manifest.sha256) {
            partial.delete()
            "Downloaded Linux image failed SHA-256 verification."
        }
        check(partial.renameTo(destination)) {
            "Could not activate verified Linux image archive."
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun extractRootfs(
        context: Context,
        payload: RuntimePayload,
        archive: File,
        rootfs: File,
    ) {
        ensureDirectory(File(rootfs, "linkerconfig"))
        val runtimeMount = File(rootfs, ".agentui-extract")
        ensureDirectory(runtimeMount)
        val tarMount = File(runtimeMount, "tar")
        if (!tarMount.exists()) check(tarMount.createNewFile()) {
            "Could not create tar mount target."
        }

        val args = mutableListOf(
            "--link2symlink",
            "--rootfs=${stableRootfsPath(context, rootfs)}",
        )
        addAndroidMounts(args)
        args += listOf(
            "-b",
            "${payload.tar.absolutePath}:/${runtimeMount.name}/${tarMount.name}",
            "--cwd=/",
            "/${runtimeMount.name}/${tarMount.name}",
            "--warning=no-unknown-keyword",
            "--delay-directory-restore",
            "--preserve-permissions",
            "--strip-components=1",
            "-xf",
            "-",
            "-C",
            "/",
        )
        defaultAndroidMountSources().forEach { source ->
            args += "--exclude=${source.removePrefix("/")}"
        }
        args += "--exclude=${runtimeMount.name}"

        val process = ProcessBuilder(androidExecutableCommand(payload.proot, args))
            .directory(context.filesDir)
            .redirectErrorStream(false)
            .apply { applyHostEnvironment(environment(), context, payload) }
            .start()

        val stderr = StringBuilder()
        val errorThread = thread(name = "agentui-rootfs-stderr", isDaemon = true) {
            BufferedReader(InputStreamReader(process.errorStream)).useLines { lines ->
                lines.forEach { line ->
                    if (stderr.length < 64_000) stderr.appendLine(line)
                }
            }
        }

        try {
            archive.inputStream().buffered().use { compressed ->
                XZInputStream(compressed).use { xz ->
                    process.outputStream.buffered().use { output ->
                        xz.copyTo(output, 64 * 1024)
                    }
                }
            }
            val exit = process.waitFor()
            errorThread.join(1_000)
            check(exit == 0) {
                "Linux image extraction failed ($exit): ${stderr.toString().trim().takeLast(4000)}"
            }
        } catch (error: Throwable) {
            process.destroy()
            if (!process.waitFor(1, TimeUnit.SECONDS)) process.destroyForcibly()
            throw error
        } finally {
            tarMount.delete()
            runtimeMount.delete()
        }
    }

    private fun configureRootfs(rootfs: File) {
        listOf(
            "dev", "dev/pts", "dev/shm", "proc", "sys", "tmp", "root",
            "workspace", "etc", "linkerconfig",
        ).forEach { ensureDirectory(File(rootfs, it)) }

        writeTextFile(
            File(rootfs, "etc/hosts"),
            "127.0.0.1 localhost\n::1 localhost ip6-localhost ip6-loopback\n",
        )
        writeTextFile(
            File(rootfs, "etc/resolv.conf"),
            "nameserver 1.1.1.1\nnameserver 8.8.8.8\n",
        )
    }

    private fun writeMarker(file: File, body: String) {
        ensureDirectory(requireNotNull(file.parentFile))
        FileOutputStream(file).use { output ->
            output.write(body.toByteArray(Charsets.UTF_8))
            output.fd.sync()
        }
    }

    private fun writeTextFile(file: File, content: String) {
        ensureDirectory(requireNotNull(file.parentFile))
        FileOutputStream(file).use { output ->
            output.write(content.toByteArray(Charsets.UTF_8))
            output.fd.sync()
        }
    }

    private fun runGuest(
        context: Context,
        payload: RuntimePayload,
        paths: WorkspacePaths,
        workspaceId: String,
        workspaceName: String,
        command: String,
        timeoutSeconds: Int,
        stdin: String?,
        requireReady: Boolean,
    ): EmbeddedRuntimeResult {
        if (requireReady && !paths.readyMarker.isFile) {
            return EmbeddedRuntimeResult(
                ok = false,
                message = "Workspace Linux image is not installed yet.",
            )
        }

        ensureDirectory(paths.project)
        ensureDirectory(File(paths.rootfs, "workspace"))

        val args = mutableListOf(
            "--link2symlink",
            "--kill-on-exit",
            "--root-id",
            "--rootfs=${stableRootfsPath(context, paths.rootfs)}",
        )
        addAndroidMounts(args)
        args += listOf(
            "-b",
            "${paths.project.absolutePath}:/workspace",
            "--cwd=/workspace",
            "/usr/bin/env",
            "-i",
            "HOME=/root",
            "USER=root",
            "LOGNAME=root",
            "TERM=xterm-256color",
            "LANG=C.UTF-8",
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "AGENT_WORKSPACE_ID=$workspaceId",
            "AGENT_WORKSPACE_NAME=$workspaceName",
            "/bin/sh",
            "-lc",
            command,
        )

        val process = ProcessBuilder(androidExecutableCommand(payload.proot, args))
            .directory(context.filesDir)
            .redirectErrorStream(false)
            .apply { applyHostEnvironment(environment(), context, payload) }
            .start()

        stdin?.let {
            process.outputStream.bufferedWriter().use { writer -> writer.write(it) }
        } ?: process.outputStream.close()

        val stdoutBytes = ByteArrayOutputStream()
        val stderrBytes = ByteArrayOutputStream()
        val outThread = thread(name = "agentui-workspace-stdout", isDaemon = true) {
            copyLimited(process.inputStream, stdoutBytes)
        }
        val errThread = thread(name = "agentui-workspace-stderr", isDaemon = true) {
            copyLimited(process.errorStream, stderrBytes)
        }

        val timeout = timeoutSeconds.coerceIn(5, 1800)
        val finished = process.waitFor(timeout.toLong(), TimeUnit.SECONDS)
        if (!finished) {
            process.destroy()
            if (!process.waitFor(1, TimeUnit.SECONDS)) process.destroyForcibly()
        }
        outThread.join(2_000)
        errThread.join(2_000)

        val stdout = stdoutBytes.toString(Charsets.UTF_8.name())
        val stderr = stderrBytes.toString(Charsets.UTF_8.name())

        if (!finished) {
            return EmbeddedRuntimeResult(
                ok = false,
                started = true,
                timedOut = true,
                stdout = stdout,
                stderr = stderr,
                message = "Command timed out after $timeout seconds.",
            )
        }

        val exit = process.exitValue()
        return EmbeddedRuntimeResult(
            ok = exit == 0,
            started = true,
            exitCode = exit,
            stdout = stdout,
            stderr = stderr,
            message = if (exit == 0) {
                "Command completed."
            } else {
                "Command failed with exit code $exit."
            },
        )
    }

    private fun copyLimited(input: InputStream, output: ByteArrayOutputStream) {
        input.use { source ->
            val buffer = ByteArray(16 * 1024)
            var captured = 0
            while (true) {
                val count = source.read(buffer)
                if (count < 0) break
                if (captured < MAX_CAPTURE_BYTES) {
                    val writable = minOf(count, MAX_CAPTURE_BYTES - captured)
                    output.write(buffer, 0, writable)
                    captured += writable
                }
            }
        }
    }

    private fun defaultAndroidMountSources(): List<String> =
        listOf(
            "/system",
            "/apex",
            "/dev",
            "/proc",
            "/sys",
            "/linkerconfig/ld.config.txt",
        ).filter { File(it).exists() }

    private fun addAndroidMounts(args: MutableList<String>) {
        defaultAndroidMountSources().forEach { source ->
            args += "-b"
            args += source
        }
    }

    private fun applyHostEnvironment(
        environment: MutableMap<String, String>,
        context: Context,
        payload: RuntimePayload,
    ) {
        val temporaryDirectory = File(context.cacheDir, "proot")
        ensureDirectory(temporaryDirectory)
        environment.remove("LD_PRELOAD")
        environment["ANDROID_DATA"] = "/data"
        environment["ANDROID_ROOT"] = "/system"
        environment["ANDROID_RUNTIME_ROOT"] = "/apex/com.android.runtime"
        environment["ANDROID_TZDATA_ROOT"] = "/apex/com.android.tzdata"
        environment["HOME"] = context.filesDir.absolutePath
        environment["PATH"] = "/system/bin"
        environment["PROOT_LOADER"] = payload.loader.absolutePath
        environment["PROOT_TMP_DIR"] = temporaryDirectory.absolutePath
        environment["TMPDIR"] = temporaryDirectory.absolutePath
    }

    private fun androidExecutableCommand(
        executable: File,
        arguments: List<String>,
    ): List<String> {
        val linker = if (Build.SUPPORTED_64_BIT_ABIS.isNotEmpty()) {
            "/system/bin/linker64"
        } else {
            "/system/bin/linker"
        }
        return if (Build.VERSION.SDK_INT >= 29) {
            listOf(linker, executable.absolutePath) + arguments
        } else {
            listOf(executable.absolutePath) + arguments
        }
    }

    private fun stableRootfsPath(context: Context, rootfs: File): String {
        val dataDir = File(context.applicationInfo.dataDir).absoluteFile
        val legacy = File("/data/data/${context.packageName}")
        return try {
            val dataPath = dataDir.toPath().normalize()
            val rootPath = rootfs.absoluteFile.toPath().normalize()
            if ((rootPath == dataPath || rootPath.startsWith(dataPath)) &&
                java.nio.file.Files.isSameFile(dataPath, legacy.toPath())
            ) {
                File(legacy, dataPath.relativize(rootPath).toString()).absolutePath
            } else {
                rootfs.absolutePath
            }
        } catch (_: Throwable) {
            rootfs.absolutePath
        }
    }

    private fun ensureDirectory(directory: File) {
        check(directory.mkdirs() || directory.isDirectory) {
            "Could not create ${directory.absolutePath}"
        }
    }
}
