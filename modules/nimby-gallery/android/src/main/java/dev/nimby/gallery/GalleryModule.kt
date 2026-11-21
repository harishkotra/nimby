package dev.nimby.gallery

import android.content.Intent
import android.app.Activity
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import java.io.File

class GalleryModule : Module() {
    private val context get() = requireNotNull(appContext.reactContext).applicationContext
    private val gallery by lazy { GallerySource(context) }
    private val memory by lazy { GalleryMemory(context, gallery) }
    private val scan = lazy { ScanWorker(context, gallery, memory) }
    private val worker get() = scan.value
    private val voiceEngine = lazy { VoiceRecall(context) }
    private val personal by lazy { PersonalMemory(context, memory) }
    private val productVision by lazy { ProductVision(context) }
    private val modelInference = Mutex()
    private val followUps by lazy { NextStepNotifications(context) }
    private val picker = PickMultipleVisualMedia()
    private val referencePicker = PickVisualMedia()
    @Volatile private var referenceUri: Uri? = null
    private var pickerPromise: Promise? = null
    @Volatile private var deletionPending = false
    private var deletion: Pair<Promise, List<ArchivedPhoto>>? = null

    override fun definition() = ModuleDefinition {
        Name("NimbyGallery")

        Function("access") { -> gallery.access().also { gallery.permissionStatus(false) } }
        Function("permissionStatus") { requested: Boolean -> gallery.permissionStatus(requested) }

        AsyncFunction("albums") Coroutine { ->
            withContext(Dispatchers.IO) { gallery.albums(memory.archivedUris()) }
        }

        AsyncFunction("photos") Coroutine { album: String?, cursor: String? ->
            withContext(Dispatchers.IO) {
                val hidden = memory.archivedUris()
                var before = cursor?.toLong() ?: Long.MAX_VALUE
                val visible = mutableListOf<Photo>()
                var next: String? = null
                while (visible.size < 60) {
                    val remaining = 60 - visible.size
                    val rows = gallery.page(listOfNotNull(album), before, remaining)
                    visible.addAll(rows.filterNot { it.uri.toString() in hidden })
                    if (rows.size < remaining) break
                    before = rows.last().id
                    if (visible.size == 60) next = before.toString()
                }
                mapOf("items" to visible.map { it.bridge() }, "next" to next)
            }
        }

        AsyncFunction("pickPhotos") { promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null || pickerPromise != null) {
                promise.reject("PICKER_UNAVAILABLE", "The photo picker is already open or unavailable.", null)
            } else {
                try {
                    pickerPromise = promise
                    activity.startActivityForResult(picker.createIntent(activity, PickVisualMediaRequest(PickVisualMedia.ImageOnly)), PICK_REQUEST)
                } catch (error: Exception) {
                    pickerPromise = null
                    promise.reject("PICKER_UNAVAILABLE", "Android could not open the photo picker.", error)
                }
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("pickReferencePhoto") { promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null || pickerPromise != null) {
                promise.reject("PICKER_UNAVAILABLE", "The photo picker is already open or unavailable.", null)
            } else {
                try {
                    pickerPromise = promise
                    activity.startActivityForResult(referencePicker.createIntent(activity, PickVisualMediaRequest(PickVisualMedia.ImageOnly)), REFERENCE_REQUEST)
                } catch (error: Exception) {
                    pickerPromise = null
                    promise.reject("PICKER_UNAVAILABLE", "Android could not open the photo picker.", error)
                }
            }
        }.runOnQueue(Queues.MAIN)

        OnActivityResult { _, payload ->
            if (payload.requestCode == PICK_REQUEST) {
                val promise = pickerPromise
                pickerPromise = null
                val selected = picker.parseResult(payload.resultCode, payload.data)
                appContext.backgroundCoroutineScope.launch {
                    selected.forEach { uri ->
                        try {
                            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        } catch (_: SecurityException) {
                            // The temporary grant can still be used during this session.
                        }
                    }
                    promise?.resolve(selected.map(Uri::toString))
                }
            }
            if (payload.requestCode == REFERENCE_REQUEST) {
                val promise = pickerPromise
                pickerPromise = null
                referenceUri = referencePicker.parseResult(payload.resultCode, payload.data)
                promise?.resolve(referenceUri?.toString())
            }
            if (payload.requestCode == DELETE_REQUEST) {
                val request = deletion
                deletion = null
                if (request != null) appContext.backgroundCoroutineScope.launch {
                    try {
                        val approved = payload.resultCode == Activity.RESULT_OK
                        val removed = if (approved) memory.recordConfirmedDeletion(request.second) else 0
                        request.first.resolve(mapOf("approved" to approved, "removed" to removed, "requested" to request.second.size))
                    } catch (error: Exception) {
                        request.first.reject("DELETE_UNVERIFIED", "Nimby could not verify the deletion result.", error)
                    } finally { deletionPending = false }
                } else deletionPending = false
            }
        }

        Function("startScan") { albums: List<String>, uris: List<String> ->
            check(!deletionPending) { "Finish Android’s deletion review before scanning." }
            check(modelInference.tryLock()) { "Wait for the current suggestion before scanning." }
            try { worker.start(albums, uris) } finally { modelInference.unlock() }
        }
        Function("scanStatus") { -> worker.status() }
        Function("controlScan") { action: String -> worker.control(action) }

        AsyncFunction("voiceStatus") Coroutine { ->
            withContext(Dispatchers.IO) { voiceEngine.value.status() }
        }
        AsyncFunction("installVoice") Coroutine { ->
            withContext(Dispatchers.IO) { voiceEngine.value.install() }
        }
        Function("startVoice") { -> voiceEngine.value.start() }
        AsyncFunction("finishVoice") Coroutine { ->
            withContext(Dispatchers.IO) { voiceEngine.value.finish() }
        }
        Function("cancelVoice") { -> if (voiceEngine.isInitialized()) voiceEngine.value.cancelRecording() }
        OnActivityEntersBackground {
            if (voiceEngine.isInitialized()) voiceEngine.value.cancelRecording()
        }
        OnActivityEntersForeground {
            worker.requestMemoryBackfill()
            appContext.backgroundCoroutineScope.launch(Dispatchers.IO) { runCatching { followUps.recover(memory) } }
        }
        OnCreate {
            appContext.backgroundCoroutineScope.launch(Dispatchers.IO) {
                val app = appContext.reactContext?.applicationContext ?: return@launch
                val retiredModels = File(app.noBackupFilesDir, "functiongemma")
                File(retiredModels, "mobile-actions-q8-92109695f911d1872fa8ae07c1e3ff0ed70f2c3d1690d410ec6db8587c2ab409.litertlm").delete()
                File(retiredModels, "functiongemma.part").delete()
            }
        }

        AsyncFunction("nextSteps") Coroutine { id: String? ->
            withContext(Dispatchers.IO) {
                val items = memory.nextSteps()
                val target = id?.takeIf { key -> items.none { (it["photo"] as Map<*, *>)["id"] == key } }
                listOfNotNull(target?.let(memory::nextStep)) + items
            }
        }
        Function("nextStepNotificationStatus") { -> followUps.status() }
        AsyncFunction("setShoppingNotifications") Coroutine { enabled: Boolean ->
            withContext(Dispatchers.IO) { followUps.setShopping(enabled) }
        }
        AsyncFunction("savePhotoFollowUp") Coroutine { id: String, action: String, due: Long ->
            withContext(Dispatchers.IO) {
                when (action) {
                    "schedule" -> followUps.schedule(memory, id, due)
                    "cancel" -> { memory.cancelFollowUp(id); followUps.stop(id) }
                    "file" -> { memory.fileReceipt(id); followUps.stop(id) }
                    "done", "dismissed" -> {
                        check(memory.nextStep(id) != null) { "This photo is no longer available for follow-up." }
                        memory.writeFollowUp(id, action)
                        followUps.stop(id)
                    }
                    else -> error("Unknown follow-up action.")
                }
            }
        }
        AsyncFunction("readShoppingText") Coroutine { id: String ->
            withContext(Dispatchers.IO) {
                id.toLongOrNull()?.let { worker.readShoppingText(it) }
            }
        }
        Function("productVisionStatus") { -> productVision.status() }
        AsyncFunction("installProductVision") Coroutine { ->
            withContext(Dispatchers.IO) { productVision.install() }
        }
        Function("cancelProductVisionDownload") { -> productVision.cancelDownload() }
        AsyncFunction("removeProductVision") Coroutine { ->
            withContext(Dispatchers.IO) { productVision.remove() }
        }
        AsyncFunction("identifyProductImage") Coroutine { id: String ->
            withContext(Dispatchers.IO) {
                check(modelInference.tryLock()) { "Wait for the current suggestion to finish." }
                try {
                    check(worker.status()["phase"] !in listOf("preparing", "running", "matching", "paused")) {
                        "Finish your gallery scan before using Qwen."
                    }
                    val imageId = id.toLongOrNull()
                    check(imageId != null && memory.shoppingOcrTarget(imageId) != null) { "This image is no longer available." }
                    val uri = memory.available(imageId) ?: error("This image is no longer accessible.")
                    productVision.identify(uri)
                } finally { modelInference.unlock() }
            }
        }
        AsyncFunction("reviewReceiptImage") Coroutine { id: String ->
            withContext(Dispatchers.IO) {
                check(modelInference.tryLock()) { "Wait for the current suggestion to finish." }
                try {
                    check(worker.status()["phase"] !in listOf("preparing", "running", "matching", "paused")) {
                        "Finish your gallery scan before using Qwen."
                    }
                    val imageId = id.toLongOrNull()
                    check(imageId != null && memory.nextStep(id)?.get("kind") == "receipt") {
                        "This receipt is no longer available."
                    }
                    val uri = memory.available(imageId) ?: error("This receipt is no longer accessible.")
                    productVision.reviewReceipt(uri)
                } finally { modelInference.unlock() }
            }
        }

        AsyncFunction("searchReferencePhoto") Coroutine { uri: String ->
            withContext(Dispatchers.IO) {
                check(modelInference.tryLock()) { "Wait for the current image to finish." }
                try {
                    val reference = checkedReference(uri)
                    memory.similarToReference(reference, worker.referenceEmbedding(reference))
                } finally { modelInference.unlock() }
            }
        }
        AsyncFunction("describeReferenceScene") Coroutine { uri: String ->
            withContext(Dispatchers.IO) {
                check(modelInference.tryLock()) { "Wait for the current image to finish." }
                try {
                    check(worker.status()["phase"] !in listOf("preparing", "running", "matching", "paused")) {
                        "Finish your gallery scan before using Qwen."
                    }
                    productVision.describeScene(checkedReference(uri))
                } finally { modelInference.unlock() }
            }
        }
        AsyncFunction("searchablePlaces") Coroutine { ->
            withContext(Dispatchers.IO) { memory.searchablePlaces() }
        }

        AsyncFunction("requestMemoryBackfill") Coroutine { ->
            withContext(Dispatchers.IO) { worker.requestMemoryBackfill() }
        }
        AsyncFunction("memoryStatus") Coroutine { ->
            withContext(Dispatchers.IO) { worker.memoryStatus() }
        }
        AsyncFunction("searchMemory") Coroutine {
            query: String, category: String?, start: Long?, end: Long?, place: String?, collection: String?, textOnly: Boolean, offset: Int ->
            withContext(Dispatchers.IO) {
                memory.searchMemory(query.take(512), category, start, end, place, collection, textOnly, offset.coerceAtLeast(0))
            }
        }
        AsyncFunction("setMemoryPlace") Coroutine { imageId: String, place: String? ->
            withContext(Dispatchers.IO) { memory.setMemoryPlace(imageId, place) }
        }
        AsyncFunction("memoryPlace") Coroutine { imageId: String ->
            withContext(Dispatchers.IO) { memory.memoryPlace(imageId) }
        }
        AsyncFunction("photoLocationStatus") Coroutine { ->
            withContext(Dispatchers.IO) { worker.photoLocationStatus() }
        }
        AsyncFunction("setPhotoLocationsEnabled") Coroutine { enabled: Boolean ->
            withContext(Dispatchers.IO) { worker.setPhotoLocationsEnabled(enabled) }
        }
        AsyncFunction("clearPhotoLocations") Coroutine { ->
            withContext(Dispatchers.IO) { worker.clearPhotoLocations() }
        }
        AsyncFunction("personalCandidates") Coroutine { start: Long, end: Long ->
            withContext(Dispatchers.IO) { personal.candidates(start, end, worker.photoLocationsAvailable()) }
        }
        AsyncFunction("readPersonal") Coroutine { section: String ->
            withContext(Dispatchers.IO) { personal.read(section) }
        }
        AsyncFunction("savePersonal") Coroutine { section: String, data: String? ->
            withContext(Dispatchers.IO) { personal.save(section, data) }
        }
        AsyncFunction("mapPhotoClusters") Coroutine {
            south: Double, west: Double, north: Double, east: Double, zoom: Double, start: Long?, end: Long? ->
            withContext(Dispatchers.IO) {
                check(worker.photoLocationsAvailable()) { "Enable photo locations to open the map." }
                photoMapClusters(memory, MapViewport(south, west, north, east), zoom, start, end).bridge()
            }
        }
        AsyncFunction("mapPhotoPage") Coroutine {
            bounds: List<Double>, zoom: Double, start: Long?, end: Long?, clusterId: String?, offset: Int ->
            withContext(Dispatchers.IO) {
                check(worker.photoLocationsAvailable()) { "Enable photo locations to open the map." }
                require(bounds.size == 4)
                val (south, west, north, east) = bounds
                photoMapPage(memory, MapViewport(south, west, north, east), zoom, start, end, clusterId, offset).bridge()
            }
        }

        AsyncFunction("eyeStatus") Coroutine { ->
            withContext(Dispatchers.IO) { worker.eyeStatus() }
        }

        AsyncFunction("runEyeCheck") Coroutine { ->
            withContext(Dispatchers.IO) { worker.runEyeCheck() }
        }

        AsyncFunction("processing") Coroutine { ->
            withContext(Dispatchers.IO) { worker.processing() }
        }
        AsyncFunction("resumeInterrupted") Coroutine { ->
            withContext(Dispatchers.IO) {
                check(!deletionPending) { "Finish Android’s deletion review before scanning." }
                check(modelInference.tryLock()) { "Wait for the current suggestion before scanning." }
                try { worker.resumeInterrupted() } finally { modelInference.unlock() }
            }
        }
        AsyncFunction("excludeAlbum") Coroutine { id: String, name: String, excluded: Boolean ->
            withContext(Dispatchers.IO) { memory.excludeAlbum(id, name, excluded) }
        }
        AsyncFunction("clearAnalysis") Coroutine { all: Boolean ->
            withContext(Dispatchers.IO) { worker.clearAnalysis(all) { personal.clear() } }
        }

        AsyncFunction("archivePage") Coroutine { offset: Int ->
            withContext(Dispatchers.IO) { memory.archivePage(offset.coerceAtLeast(0)) }
        }
        AsyncFunction("overview") Coroutine { ->
            withContext(Dispatchers.IO) { worker.overview() }
        }
        AsyncFunction("duplicatePage") Coroutine { offset: Int ->
            withContext(Dispatchers.IO) {
                if (offset == 0) memory.refreshDuplicateLinks()
                memory.duplicateGroups().drop(offset.coerceAtLeast(0)).take(20).map { it.bridge() }
            }
        }
        AsyncFunction("markReviewed") Coroutine { uris: List<String> ->
            withContext(Dispatchers.IO) { memory.markReviewed(uris) }
        }
        AsyncFunction("archive") Coroutine { uris: List<String> ->
            withContext(Dispatchers.IO) { memory.archive(uris) }
        }
        AsyncFunction("restore") Coroutine { uris: List<String> ->
            check(!deletionPending) { "Finish Android’s deletion review first." }
            withContext(Dispatchers.IO) { memory.restore(uris) }
        }
        AsyncFunction("deleteArchived") { uris: List<String>, promise: Promise ->
            if (deletionPending || worker.busy() || Build.VERSION.SDK_INT < 30) {
                promise.reject("DELETE_UNAVAILABLE", "Finish the current operation first. Deletion requires Android 11 or newer.", null)
            } else {
                deletionPending = true
                appContext.backgroundCoroutineScope.launch {
                    try {
                        val items = memory.deletionCandidates(uris)
                        val request = MediaStore.createDeleteRequest(context.contentResolver, items.map { Uri.parse(it.uri) })
                        withContext(Dispatchers.Main) {
                            val activity = requireNotNull(appContext.currentActivity) { "Nimby needs to be in the foreground." }
                            deletion = promise to items
                            activity.startIntentSenderForResult(request.intentSender, DELETE_REQUEST, null, 0, 0, 0)
                        }
                    } catch (error: Exception) {
                        withContext(Dispatchers.Main) { deletion = null; deletionPending = false }
                        promise.reject("DELETE_UNAVAILABLE", error.message ?: "Android could not open deletion review.", error)
                    }
                }
            }
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("feed") Coroutine { mode: String, group: String?, offset: Int, limit: Int ->
            withContext(Dispatchers.IO) { memory.feed(mode, group, offset.coerceAtLeast(0), limit.coerceIn(1, 48)) }
        }

        AsyncFunction("reviewCategories") Coroutine { scanId: String? ->
            withContext(Dispatchers.IO) { memory.reviewCategories(scanId?.toLong()) }
        }

        AsyncFunction("revisitPicks") Coroutine { seen: List<String> ->
            withContext(Dispatchers.IO) { memory.revisitPicks(seen) }
        }

        AsyncFunction("scanFeed") Coroutine { scanId: String, category: String?, offset: Int, limit: Int ->
            withContext(Dispatchers.IO) { memory.scanFeed(scanId.toLong(), category, offset.coerceAtLeast(0), limit.coerceIn(1, 48)) }
        }

        AsyncFunction("groups") Coroutine { kept: Boolean ->
            withContext(Dispatchers.IO) { memory.groups(kept) }
        }

        AsyncFunction("decide") Coroutine { id: String, decision: String, collection: String? ->
            withContext(Dispatchers.IO) { memory.decide(id.toLong(), decision, collection) }
        }

        AsyncFunction("similar") Coroutine { id: String ->
            withContext(Dispatchers.IO) { memory.similar(id.toLong()) }
        }

        AsyncFunction("openOriginal") Coroutine { id: String, source: String? ->
            val uri = withContext(Dispatchers.IO) { memory.available(id.toLong(), source) }
                ?: throw IllegalStateException("This photo has been deleted or access has changed.")
            withContext(Dispatchers.Main) {
                val activity = requireNotNull(appContext.currentActivity)
                val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "image/*")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                try {
                    activity.startActivity(view)
                } catch (_: android.content.ActivityNotFoundException) {
                    throw IllegalStateException("No image viewer is installed. You can still view the photo in Nimby.")
                } catch (_: SecurityException) {
                    throw IllegalStateException("This photo is unavailable in an external viewer. You can still view it in Nimby if access is active.")
                }
            }
        }

        OnDestroy {
            if (voiceEngine.isInitialized()) voiceEngine.value.destroy()
            if (scan.isInitialized()) worker.destroy()
            pickerPromise?.reject("PICKER_CLOSED", "The photo picker closed.", null)
            pickerPromise = null
            deletion?.first?.reject("DELETE_UNVERIFIED", "Nimby did not receive the deletion result.", null)
            deletion = null
        }
    }

    private fun checkedReference(uri: String): Uri = checkNotNull(
        referenceUri?.takeIf { it.toString() == uri && gallery.readable(it) }
    ) { "Choose the reference photo again. Android no longer allows access to it." }

    private companion object {
        const val PICK_REQUEST = 0x4e42
        const val REFERENCE_REQUEST = 0x4e48
        const val DELETE_REQUEST = 0x4e43
    }
}
