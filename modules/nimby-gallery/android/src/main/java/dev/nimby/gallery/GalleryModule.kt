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
import kotlinx.coroutines.withContext

class GalleryModule : Module() {
    private val context get() = requireNotNull(appContext.reactContext).applicationContext
    private val gallery by lazy { GallerySource(context) }
    private val memory by lazy { GalleryMemory(context, gallery) }
    private val scan = lazy { ScanWorker(context, gallery, memory) }
    private val worker get() = scan.value
    private val picker = PickMultipleVisualMedia()
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
            worker.start(albums, uris)
        }
        Function("scanStatus") { -> worker.status() }
        Function("controlScan") { action: String -> worker.control(action) }

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
                worker.resumeInterrupted()
            }
        }
        AsyncFunction("excludeAlbum") Coroutine { id: String, name: String, excluded: Boolean ->
            withContext(Dispatchers.IO) { memory.excludeAlbum(id, name, excluded) }
        }
        AsyncFunction("clearAnalysis") Coroutine { all: Boolean ->
            withContext(Dispatchers.IO) { worker.clearAnalysis(all) }
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
            if (scan.isInitialized()) worker.destroy()
            pickerPromise?.reject("PICKER_CLOSED", "The photo picker closed.", null)
            pickerPromise = null
            deletion?.first?.reject("DELETE_UNVERIFIED", "Nimby did not receive the deletion result.", null)
            deletion = null
        }
    }

    private companion object {
        const val PICK_REQUEST = 0x4e42
        const val DELETE_REQUEST = 0x4e43
    }
}
