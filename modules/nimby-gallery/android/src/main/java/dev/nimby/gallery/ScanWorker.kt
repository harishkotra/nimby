package dev.nimby.gallery

import android.content.Context
import android.database.sqlite.SQLiteException
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipFile

internal data class ScanProgress(
    val runId: Int = 0, val phase: String = "idle", val total: Int = 0, val processed: Int = 0, val analyzed: Int = 0,
    val cached: Int = 0, val failed: Int = 0, val errors: List<String> = emptyList(), val problem: String? = null
) {
    fun bridge() = mapOf(
        "runId" to runId, "phase" to phase, "total" to total, "processed" to processed, "analyzed" to analyzed,
        "cached" to cached, "failed" to failed, "errors" to errors, "problem" to problem
    )
}

internal class ScanWorker(private val context: Context, private val gallery: GallerySource,
                          private val memory: GalleryMemory) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var task: Job? = null
    private val paused = MutableStateFlow(false)
    private val progress = MutableStateFlow(ScanProgress())
    @Volatile private var eyeLoaded = false
    @Volatile private var currentScanId: Long? = null
    @Volatile private var runtimeError: String? = null
    private val health = context.getSharedPreferences("eye-health", Context.MODE_PRIVATE)
    @Volatile private var eyeCheck = EyeCheck("idle")
    private val packagedBytes by lazy {
        try {
            ZipFile(context.applicationInfo.sourceDir).use { apk ->
                val sizes = EYE_FILES.map { apk.getEntry("assets/eye/$it")?.compressedSize }
                if (sizes.all { it != null && it >= 0 }) sizes.sumOf { requireNotNull(it) } else null
            }
        } catch (_: IOException) {
            null
        }
    }

    private data class EyeCheck(val phase: String, val durationMs: Long? = null, val error: String? = null)

    fun eyeStatus(): Map<String, Any?> {
        val sizes = EYE_FILES.map { File(eyeDirectory(context), it).length() }
        val check = eyeCheck
        return mapOf(
            "sdkVersion" to EYE_VERSION, "packagedBytes" to packagedBytes, "stagedBytes" to sizes.sum(),
            "filesReady" to sizes.all { it > 0 }, "loaded" to eyeLoaded,
            "checkPhase" to check.phase, "checkDurationMs" to check.durationMs, "checkError" to check.error,
            "modelVersion" to health.getString("version", null),
            "lastSuccess" to health.getLong("success", 0L).takeIf { it > 0 },
            "lastInferenceMs" to health.getLong("latency", -1L).takeIf { it >= 0 },
            "runtime" to when {
                runtimeError != null -> "error"
                eyeLoaded -> "initialized"
                check.phase == "running" || progress.value.phase == "preparing" -> "loading"
                else -> "unloaded"
            },
            "runtimeError" to runtimeError
        )
    }

    fun processing() = memory.processing(currentScanId)
    fun overview() = memory.overview(currentScanId)
    @Synchronized fun resumeInterrupted() {
        check(!busy()) { "Finish the current operation before resuming." }
        val (albums, uris) = memory.interruptedScope() ?: error("No interrupted scan is available.")
        check(uris.isNotEmpty() || gallery.access() != "none") { "Allow gallery access before resuming this scan." }
        start(albums, uris)
    }

    @Synchronized
    fun clearAnalysis(all: Boolean) {
        check(task?.isCompleted != false && eyeCheck.phase != "running") { "Finish the scan or model check first." }
        memory.clearAnalysis(all)
    }

    private suspend fun infer(engine: EyeEngine, bitmap: android.graphics.Bitmap): ai.desertant.eye.Analysis {
        val started = SystemClock.elapsedRealtime()
        val result = engine.infer(bitmap)
        health.edit().putString("version", result.model).putLong("success", System.currentTimeMillis())
            .putLong("latency", SystemClock.elapsedRealtime() - started).apply()
        runtimeError = null
        return result
    }

    @Synchronized
    private fun beginEyeCheck() {
        check(task?.isCompleted != false) { "Finish or cancel the photo scan before checking Eye." }
        check(eyeCheck.phase != "running") { "Eye is already being checked." }
        eyeCheck = EyeCheck("running")
    }

    suspend fun runEyeCheck() {
        beginEyeCheck()
        var step = "Model setup"
        var result = EyeCheck("idle")
        try {
            EyeEngine(context).use { engine ->
                engine.prepare()
                eyeLoaded = true
                step = "Inference"
                val image = context.assets.open("eye/self-test.png").use { BitmapFactory.decodeStream(it) }
                    ?: error("The bundled test image could not be decoded.")
                val started = SystemClock.elapsedRealtime()
                val output = try { infer(engine, image) } finally { image.recycle() }
                val latency = SystemClock.elapsedRealtime() - started
                step = "Result validation"
                val embedding = output.embedding
                check(embedding != null && embedding.size == 512 && embedding.all(Float::isFinite) &&
                    output.confidences.values.any { it in 0.0..1.0 }) { "Eye didn’t return usable photo analysis data." }
                result = EyeCheck("passed", latency)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w("NimbyEye", "Model check failed during $step", error)
            result = EyeCheck("failed", error = "$step failed (${eyeErrorDetail(error)}).")
            runtimeError = result.error
        } catch (error: LinkageError) {
            Log.w("NimbyEye", "Model check could not link the native runtime", error)
            result = EyeCheck("failed", error = "Eye’s native runtime could not start (${error.javaClass.simpleName}).")
            runtimeError = result.error
        } finally {
            eyeLoaded = false
            eyeCheck = result
        }
    }

    fun status() = progress.value.bridge()
    @Synchronized fun busy() = task?.isCompleted == false || eyeCheck.phase == "running"

    @Synchronized
    fun start(buckets: List<String>, uris: List<String>) {
        check(eyeCheck.phase != "running") { "Wait for the Eye check to finish before scanning." }
        check(task?.isCompleted != false) { "A scan is already active." }
        paused.value = false
        runtimeError = null
        progress.value = ScanProgress(runId = progress.value.runId + 1, phase = "preparing")
        task = scope.launch { scan(buckets.distinct(), uris.distinct()) }
    }

    @Synchronized
    fun control(action: String) {
        when (action) {
            "pause" -> if (progress.value.phase in setOf("preparing", "running")) {
                paused.value = true
                progress.update { it.copy(phase = "paused") }
            }
            "resume" -> if (progress.value.phase == "paused") {
                paused.value = false
                progress.update { it.copy(phase = "running") }
            }
            "cancel" -> if (progress.value.phase in setOf("preparing", "running", "paused", "matching")) {
                progress.update { it.copy(phase = "cancelled") }
                task?.cancel()
            }
        }
    }

    fun destroy() = scope.cancel()

    private suspend fun scan(buckets: List<String>, uris: List<String>) {
        var eye: EyeEngine? = null
        val loggedFailures = mutableSetOf<String>()
        var historyId: Long? = null
        try {
            historyId = memory.beginScan(buckets, uris)
            currentScanId = historyId
            val scopes = if (buckets.isEmpty()) listOf(emptyList()) else buckets.chunked(100)
            val excluded = if (buckets.isEmpty() && uris.isEmpty()) memory.excludedAlbums().mapNotNull { it["id"] }.toSet() else emptySet()
            val count = when {
                uris.isNotEmpty() -> uris.size
                excluded.isEmpty() -> scopes.sumOf { gallery.count(it) }
                else -> {
                    var included = 0
                    val coroutine = currentCoroutineContext()
                    gallery.forEachPhoto {
                        coroutine.ensureActive()
                        if (it.bucket !in excluded) included++
                    }
                    included
                }
            }
            progress.update { it.copy(total = count) }
            if (count == 0) {
                finish("complete")
                return
            }

            suspend fun process(uri: Uri, known: Photo?) {
                paused.first { !it }
                currentCoroutineContext().ensureActive()
                var photo = known
                var id: Long? = null
                var stage = "index"
                try {
                    photo = photo ?: gallery.chosen(uri)
                    id = memory.knownImage(photo)
                    if (id == null) id = memory.attach(photo, fingerprint(uri))
                    if (memory.isCached(id)) {
                        if (!gallery.readable(uri)) throw IOException("Photo access has changed.")
                        memory.clearSourceError(uri)
                        progress.update { it.copy(processed = it.processed + 1, cached = it.cached + 1) }
                        return
                    }
                    stage = "decode"
                    val bitmap = decodePhoto(context.contentResolver, uri)
                    try {
                        val engine = eye ?: prepareEye().also {
                            eye = it
                            eyeLoaded = true
                        }
                        currentCoroutineContext().ensureActive()
                        stage = "inference"
                        val output = infer(engine, bitmap)
                        currentCoroutineContext().ensureActive()
                        stage = "result"
                        val result = mapEyeAnalysis(output)
                        stage = "save"
                        memory.complete(id, result)
                    } finally {
                        bitmap.recycle()
                    }
                    memory.clearSourceError(uri)
                    progress.update { it.copy(processed = it.processed + 1, analyzed = it.analyzed + 1) }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: EyeUnavailable) {
                    memory.recordFailure(uri, photo, id, error.message.orEmpty())
                    throw error
                } catch (error: SQLiteException) {
                    throw error
                } catch (error: Exception) {
                    val message = when (error) {
                        is SecurityException, is java.io.FileNotFoundException -> "Photo is unavailable or access has changed."
                        else -> when (stage) {
                            "decode" -> "Android could not decode this photo."
                            "inference" -> "Eye inference failed (${eyeErrorDetail(error)})."
                            "result" -> "Nimby could not read Eye’s result (${error.javaClass.simpleName})."
                            "save" -> "Nimby could not save Eye’s result."
                            else -> "Nimby could not index this photo."
                        }
                    }
                    if (stage in setOf("inference", "result") && loggedFailures.add(stage)) {
                        Log.w("NimbyEye", "Scan ${progress.value.runId} failed during $stage", error)
                    }
                    if (stage == "inference") runtimeError = message
                    memory.recordFailure(uri, photo, id, message)
                    progress.update {
                        it.copy(processed = it.processed + 1, failed = it.failed + 1,
                            errors = (it.errors + "${photo?.name ?: "Photo"} · $message").takeLast(5))
                    }
                } finally {
                    val snapshot = progress.value
                    if (snapshot.processed > 0 && snapshot.processed % 12 == 0) memory.saveScan(historyId, snapshot, false)
                }
            }

            if (uris.isNotEmpty()) {
                uris.forEach { process(Uri.parse(it), null) }
            } else for (scope in scopes) {
                var before = Long.MAX_VALUE
                while (true) {
                    paused.first { !it }
                    currentCoroutineContext().ensureActive()
                    val page = gallery.page(scope, before, 48)
                    if (page.isEmpty()) break
                    val included = page.filter { it.bucket !in excluded }
                    val cached = memory.cachedPhotos(included)
                    included.forEach { photo ->
                        if (photo.uri.toString() in cached) {
                            paused.first { !it }
                            currentCoroutineContext().ensureActive()
                            progress.update { it.copy(processed = it.processed + 1, cached = it.cached + 1) }
                            if (progress.value.processed % 12 == 0) memory.saveScan(historyId, progress.value, false)
                        } else process(photo.uri, photo)
                    }
                    before = page.last().id
                }
            }
            progress.update { it.copy(total = it.processed) }
            currentCoroutineContext().ensureActive()
            paused.first { !it }
            progress.update { if (it.phase != "cancelled") it.copy(phase = "matching") else it }
            memory.refreshDuplicateLinks()
            finish("complete")
        } catch (error: CancellationException) {
            finish("cancelled")
            throw error
        } catch (error: EyeUnavailable) {
            runtimeError = error.message
            Log.w("NimbyEye", "Could not prepare the bundled Eye model", error.cause ?: error)
            finish("blocked", error.message)
        } catch (_: LinkageError) {
            finish("blocked", "Eye could not start on this Android device.")
        } catch (_: SQLiteException) {
            finish("blocked", "Nimby could not write to its photo index.")
        } catch (_: SecurityException) {
            finish("blocked", "Gallery access changed. Update it in Gallery and scan again.")
        } catch (_: Exception) {
            finish("blocked", "The scan stopped unexpectedly. Try scanning again.")
        } finally {
            try { eye?.close() } finally {
                eyeLoaded = false
                currentScanId = null
                historyId?.let { id -> runCatching { memory.saveScan(id, progress.value, true) } }
            }
        }
    }

    @Synchronized
    private fun finish(phase: String, problem: String? = null) = progress.update {
        if (it.phase == "cancelled") it else it.copy(phase = phase, problem = problem)
    }

    private suspend fun prepareEye(): EyeEngine {
        val engine = EyeEngine(context)
        try {
            runtimeError = null
            engine.prepare()
            progress.update { if (it.phase == "preparing") it.copy(phase = "running") else it }
            paused.first { !it }
            return engine
        } catch (error: CancellationException) {
            engine.close()
            throw error
        } catch (error: Exception) {
            engine.close()
            throw EyeUnavailable(error)
        } catch (error: LinkageError) {
            engine.close()
            throw EyeUnavailable(error)
        }
    }

    private suspend fun fingerprint(uri: Uri): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val stream = context.contentResolver.openInputStream(uri) ?: throw IOException("Cannot read photo.")
        stream.use {
            val buffer = ByteArray(64 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val count = it.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private class EyeUnavailable(cause: Throwable) : IOException(
        "Eye couldn’t load the model included with Nimby (${eyeErrorDetail(cause)}).", cause
    )
}

private fun eyeErrorDetail(error: Throwable): String =
    error.message?.lineSequence()?.firstOrNull()?.trim()?.take(180)?.takeIf { it.isNotEmpty() }
        ?: error.javaClass.simpleName
