package dev.nimby.gallery

import android.content.Context
import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.atomic.AtomicReference

internal class GalleryRuntime private constructor(context: Context) {
    val gallery = GallerySource(context)
    val memory = GalleryMemory(context, gallery)
    val worker = ScanWorker(context, gallery, memory)
    val autoScan = AutoScanSchedule(context, gallery, memory)
    val modelInference = Mutex()
    val deletionReview = AtomicReference<Any?>()
    val deletionPending get() = deletionReview.get() != null

    companion object {
        private var instance: GalleryRuntime? = null

        @Synchronized fun get(context: Context): GalleryRuntime =
            instance ?: GalleryRuntime(context.applicationContext).also { instance = it }
    }
}
