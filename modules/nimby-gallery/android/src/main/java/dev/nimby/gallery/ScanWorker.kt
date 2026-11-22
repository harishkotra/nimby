package dev.nimby.gallery

import android.content.Context
import android.database.sqlite.SQLiteException
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import com.googlecode.tesseract.android.TessBaseAPI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.yield
import java.io.IOException
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipFile

internal data class ScanProgress(
    val runId: Int = 0, val phase: String = "idle", val total: Int = 0, val processed: Int = 0, val analyzed: Int = 0,
    val cached: Int = 0, val failed: Int = 0, val errors: List<String> = emptyList(), val problem: String? = null,
    val resultId: String? = null, val automatic: Boolean = false
) {
    fun bridge() = mapOf(
        "runId" to runId, "phase" to phase, "total" to total, "processed" to processed, "analyzed" to analyzed,
        "cached" to cached, "failed" to failed, "errors" to errors, "problem" to problem, "resultId" to resultId,
        "automatic" to automatic
    )
}

internal class ScanWorker(private val context: Context, private val gallery: GallerySource,
                          private val memory: GalleryMemory) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var task: Job? = null
    @Volatile private var metadataTask: Job? = null
    private val ocrLock = Mutex()
    @Volatile private var ocrRunning = false
    @Volatile private var locating = false
    private val locationLock = Any()
    private val locationPreferences = context.getSharedPreferences("photo-locations", Context.MODE_PRIVATE)
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

    fun photoLocationsAvailable(): Boolean =
        locationPreferences.getBoolean("enabled", false) && hasPhotoLocationPermission(context)

    fun photoLocationStatus(): Map<String, Any?> {
        val enabled = locationPreferences.getBoolean("enabled", false)
        val permission = hasPhotoLocationPermission(context)
        if (enabled && !permission) clearPhotoLocations()
        val available = enabled && permission
        return mapOf(
            "enabled" to available,
            "permission" to permission,
            "pending" to if (available) memory.pendingLocationCount() else 0,
            "mapped" to if (available) memory.mappedLocationCount() else 0,
            "running" to (available && (locating || task?.isCompleted == false))
        )
    }

    fun setPhotoLocationsEnabled(enabled: Boolean) {
        if (!enabled) {
            clearPhotoLocations()
            return
        }
        check(hasPhotoLocationPermission(context)) { "Allow access to photo locations first." }
        synchronized(locationLock) {
            locationPreferences.edit().putBoolean("enabled", true).apply()
        }
        restartMetadataForLocations()
    }

    @Synchronized
    private fun restartMetadataForLocations() {
        val current = metadataTask
        if (current?.isCompleted == false) {
            current.cancel()
            current.invokeOnCompletion { requestMemoryBackfill() }
        } else {
            requestMemoryBackfill()
        }
    }

    fun clearPhotoLocations() {
        synchronized(locationLock) {
            locationPreferences.edit().putBoolean("enabled", false).apply()
            memory.clearPhotoLocations()
        }
    }

    fun memoryStatus(): Map<String, Any?> {
        val locationsEnabled = photoLocationsAvailable()
        return mapOf("pending" to memory.pendingOcrCount(), "locationsEnabled" to locationsEnabled,
            "locationsPending" to if (locationsEnabled) memory.pendingLocationCount() else 0,
            "running" to (ocrRunning || locating))
    }

    suspend fun readShoppingText(id: Long): String? = ocrLock.withLock {
        val target = memory.shoppingOcrTarget(id) ?: return null
        val uri = memory.available(id) ?: return null
        // Automatic page layout can keep multi-line product titles together on store pages.
        val text = ReceiptOcr(context).use { it.recognize(uri, TessBaseAPI.PageSegMode.PSM_AUTO) }
        currentCoroutineContext().ensureActive()
        if (!text.isNullOrBlank()) memory.saveOcr(target, text)
        text
    }

    @Synchronized
    fun requestMemoryBackfill() {
        if (task?.isCompleted == false || metadataTask?.isCompleted == false) return
        metadataTask = scope.launch {
            try {
                var locationAfter = 0L
                if (!photoLocationsAvailable() && locationPreferences.getBoolean("enabled", false)) clearPhotoLocations()
                if (photoLocationsAvailable()) {
                    locating = true
                    while (photoLocationsAvailable()) {
                        val page = memory.pendingLocationPage(locationAfter)
                        if (page.isEmpty()) break
                        for (target in page) {
                            currentCoroutineContext().ensureActive()
                            indexPhotoLocation(target.uri, target.version)
                            yield()
                        }
                        locationAfter = page.last().after
                    }
                    locating = false
                }
                indexPendingText()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                Log.w("NimbyMemory", "Local metadata indexing stopped; remaining photos can be retried.")
            } catch (_: LinkageError) {
                Log.w("NimbyMemory", "The local text recognizer could not be loaded.")
            } finally {
                locating = false
                ocrRunning = false
            }
        }
    }

    private suspend fun indexPendingText() {
        if (memory.pendingOcrCount() == 0) return
        ocrRunning = true
        try {
            ReceiptOcr(context).use { ocr ->
                var after = 0L
                while (true) {
                    val page = memory.pendingOcrPage(after)
                    if (page.isEmpty()) break
                    for (target in page) {
                        currentCoroutineContext().ensureActive()
                        indexText(ocr, target)
                        yield()
                    }
                    after = page.last().id
                }
            }
        } finally { ocrRunning = false }
    }

    private suspend fun indexText(ocr: ReceiptOcr, target: PendingOcr, source: String? = null) = ocrLock.withLock {
        val uri = memory.available(target.id, source) ?: return@withLock
        val text = ocr.recognize(uri)
        currentCoroutineContext().ensureActive()
        if (text != null) memory.saveOcr(target, text)
    }

    private suspend fun indexAutomaticText(batch: AutoScanBatch) {
        if (gallery.access() != batch.access) return
        val excluded = memory.excludedAlbums().mapNotNull { it["id"] }.toSet()
        val targets = batch.photos.asSequence().filter { it.bucket !in excluded }.mapNotNull { photo ->
            memory.pendingOcrSource(photo)?.let { it to photo.uri.toString() }
        }.distinctBy { it.first.id }.take(8).toList()
        if (targets.isEmpty()) return
        ocrRunning = true
        try {
            ReceiptOcr(context).use { ocr ->
                for ((target, uri) in targets) {
                    currentCoroutineContext().ensureActive()
                    if (gallery.access() != batch.access) break
                    indexText(ocr, target, uri)
                }
            }
        }
        catch (error: CancellationException) { throw error }
        catch (error: Exception) { Log.w("NimbyMemory", "Automatic text indexing will retry later.", error) }
        catch (error: LinkageError) { Log.w("NimbyMemory", "The local text recognizer could not be loaded.", error) }
        finally { ocrRunning = false }
    }

    private suspend fun indexPhotoLocation(uri: Uri, version: String) {
        if (!photoLocationsAvailable() || memory.locationProcessed(uri, version) || !gallery.readable(uri)) return
        val location = try {
            readPhotoCoordinates(context, uri)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return
        }
        currentCoroutineContext().ensureActive()
        synchronized(locationLock) {
            if (photoLocationsAvailable()) memory.savePhotoLocation(uri, version, location)
        }
    }

    fun processing() = memory.processing(currentScanId)
    fun overview() = memory.overview(currentScanId)
    suspend fun resumeInterrupted() {
        yieldAutoScan()
        val (albums, uris) = memory.interruptedScope() ?: error("No interrupted scan is available.")
        check(uris.isNotEmpty() || gallery.access() != "none") { "Allow gallery access before resuming this scan." }
        startManual(albums, uris)
    }

    @Synchronized
    fun clearAnalysis(all: Boolean, beforeReset: () -> Unit) {
        check(task?.isCompleted != false && eyeCheck.phase != "running") { "Finish the scan or model check first." }
        metadataTask?.cancel()
        if (all) beforeReset()
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
    private fun beginEyeCheck(): EyeCheck {
        check(task?.isCompleted != false) { "Finish or cancel the photo scan before using Eye." }
        check(eyeCheck.phase != "running") { "Eye is already processing an image." }
        val previous = eyeCheck
        eyeCheck = EyeCheck("running")
        return previous
    }

    suspend fun referenceEmbedding(uri: Uri): FloatArray {
        val previous = beginEyeCheck()
        try {
            EyeEngine(context).use { engine ->
                engine.prepare()
                eyeLoaded = true
                val bitmap = decodePhoto(context.contentResolver, uri)
                val output = try { infer(engine, bitmap) } finally { bitmap.recycle() }
                return checkNotNull(output.embedding?.takeIf { it.size == EYE_EMBEDDING_DIMENSIONS && it.all(Float::isFinite) }) {
                    "Eye couldn’t create a visual match for this photo."
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w("NimbyEye", "Could not compare a reference photo", error)
            throw IllegalStateException("Eye couldn’t compare this photo. Check that Eye works in Settings.", error)
        } catch (error: LinkageError) {
            Log.w("NimbyEye", "Could not start Eye for a reference photo", error)
            throw IllegalStateException("Eye couldn’t start on this phone.", error)
        } finally {
            eyeLoaded = false
            eyeCheck = previous
        }
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
                check(embedding != null && embedding.size == EYE_EMBEDDING_DIMENSIONS && embedding.all(Float::isFinite) &&
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

    suspend fun yieldAutoScan() {
        val automatic = synchronized(this) { task?.takeIf { progress.value.automatic && !it.isCompleted } }
        automatic?.cancelAndJoin()
    }

    suspend fun startManual(buckets: List<String>, uris: List<String>) {
        yieldAutoScan()
        synchronized(this) {
            check(eyeCheck.phase != "running") { "Wait for the Eye check to finish before scanning." }
            check(task?.isCompleted != false) { "A scan is already active." }
            startTask(false) { scan(buckets.distinct(), uris.distinct()) }
        }
    }

    @Synchronized
    fun startAutomatic(select: suspend () -> AutoScanBatch): Deferred<Pair<AutoScanBatch, ScanProgress>>? {
        if (busy()) return null
        return startTask(true) {
            val batch = select()
            if (batch.photos.isEmpty()) {
                memory.refreshDuplicateLinks(48)
                finish("complete")
            } else scan(emptyList(), emptyList(), batch)
            batch to progress.value
        }
    }

    // Both admission paths hold the scanner monitor while assigning the new task.
    private fun <T> startTask(automatic: Boolean, run: suspend () -> T): Deferred<T> {
        paused.value = false
        runtimeError = null
        progress.value = ScanProgress(runId = progress.value.runId + 1, phase = "preparing", automatic = automatic)
        val metadata = metadataTask
        metadata?.cancel()
        val current = scope.async(start = CoroutineStart.LAZY) {
            try {
                metadata?.join()
                run()
            } catch (error: CancellationException) {
                finish("cancelled")
                throw error
            } catch (error: Exception) {
                finish("blocked", "Nimby could not check the gallery.")
                throw error
            }
        }
        task = current
        if (!automatic) current.invokeOnCompletion { requestMemoryBackfill() }
        current.start()
        return current
    }

    @Synchronized
    fun control(action: String) {
        when (action) {
            "pause" -> if (!progress.value.automatic && progress.value.phase in setOf("preparing", "running")) {
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

    private suspend fun scan(buckets: List<String>, uris: List<String>, automatic: AutoScanBatch? = null) {
        var eye: EyeEngine? = null
        val loggedFailures = mutableSetOf<String>()
        var historyId: Long? = null
        try {
            historyId = memory.beginScan(buckets, uris, automatic != null)
            currentScanId = historyId
            progress.update { it.copy(resultId = historyId.toString()) }
            val scopes = if (buckets.isEmpty()) listOf(emptyList()) else buckets.chunked(100)
            val excluded = if (buckets.isEmpty() && uris.isEmpty()) memory.excludedAlbums().mapNotNull { it["id"] }.toSet() else emptySet()
            val count = when {
                automatic != null -> automatic.photos.size
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
                if (automatic != null && gallery.access() != automatic.access) throw SecurityException("Gallery access changed.")
                var photo = known
                var id: Long? = null
                var stage = "index"
                try {
                    photo = photo ?: gallery.chosen(uri)
                    id = memory.knownImage(photo)
                    if (id == null) id = memory.attach(photo, fingerprint(uri))
                    if (memory.isCached(id)) {
                        if (!gallery.readable(uri)) throw IOException("Photo access has changed.")
                        indexPhotoLocation(uri, photo.version)
                        memory.clearSourceError(uri)
                        memory.recordScanResults(historyId, listOf(uri.toString()))
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
                    indexPhotoLocation(uri, photo.version)
                    memory.clearSourceError(uri)
                    memory.recordScanResults(historyId, listOf(uri.toString()))
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

            if (automatic != null) {
                automatic.photos.filter { it.bucket !in excluded }.forEach { process(it.uri, it) }
            } else if (uris.isNotEmpty()) {
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
                    val reused = mutableListOf<String>()
                    try {
                        included.forEach { photo ->
                            if (photo.uri.toString() in cached) {
                                paused.first { !it }
                                currentCoroutineContext().ensureActive()
                                indexPhotoLocation(photo.uri, photo.version)
                                reused.add(photo.uri.toString())
                                progress.update { it.copy(processed = it.processed + 1, cached = it.cached + 1) }
                                if (progress.value.processed % 12 == 0) memory.saveScan(historyId, progress.value, false)
                            } else process(photo.uri, photo)
                        }
                    } finally {
                        memory.recordScanResults(historyId, reused)
                    }
                    before = page.last().id
                }
            }
            progress.update { it.copy(total = it.processed) }
            currentCoroutineContext().ensureActive()
            paused.first { !it }
            progress.update { if (it.phase != "cancelled") it.copy(phase = "matching") else it }
            memory.refreshDuplicateLinks(if (automatic == null) Int.MAX_VALUE else 48)
            if (automatic != null) indexAutomaticText(automatic)
            finish("complete")
            if (progress.value.analyzed > 0) runCatching { NextStepNotifications(context).offerShoppingDigest() }
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
