package dev.nimby.gallery

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

private const val WORK_NAME = "nimby-gallery-auto-scan"
private const val PAGE_SIZE = 64
private const val PAGES_PER_CHECK = 32
private const val PHOTOS_PER_CHECK = 24
private const val CHECK_TIMEOUT_MS = 180_000L

internal data class AutoScanBatch(
    val photos: List<Photo>, val access: String, val nextBefore: Long?, val sweepToken: String?
)

internal class AutoScanSchedule(
    private val context: Context, private val gallery: GallerySource, private val memory: GalleryMemory
) {
    private val prefs = context.getSharedPreferences("gallery-auto-scan", Context.MODE_PRIVATE)
    private val updates = Mutex()

    fun epoch(): Long = prefs.getLong("epoch", 0)
    fun enabled(): Boolean = prefs.getString("interval", "off") != "off"
    fun chargingOnly(): Boolean = prefs.getBoolean("charging", true)

    fun status(): Map<String, Any?> = mapOf(
        "interval" to prefs.getString("interval", "off"),
        "preferredInterval" to prefs.getString("preferred_interval", "daily"),
        "chargingOnly" to chargingOnly(),
        "firstScanComplete" to memory.hasCompletedScan(),
        "lastCheck" to prefs.getLong("last_check", 0).takeIf { it > 0 },
        "lastOutcome" to prefs.getString("last_outcome", null),
        "analyzed" to prefs.getInt("analyzed", 0), "failed" to prefs.getInt("failed", 0),
        "more" to prefs.getBoolean("more", false)
    )

    suspend fun configure(interval: String, chargingOnly: Boolean): Map<String, Any?> = updates.withLock {
        require(interval in setOf("off", "daily", "weekly"))
        val previous = prefs.getString("interval", "off") ?: "off"
        val previousCharging = chargingOnly()
        if (interval != "off" && previous == "off") {
            check(memory.hasCompletedScan()) { "Complete a photo scan before turning on Auto-scan." }
            check(gallery.access() != "none") { "Allow gallery access before turning on Auto-scan." }
        }
        saveSettings(interval, chargingOnly)
        try {
            val manager = WorkManager.getInstance(context)
            if (interval == "off") manager.cancelUniqueWork(WORK_NAME).result.get()
            else {
                val policy = if (previous != "off" && previousCharging != chargingOnly)
                    ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE else ExistingPeriodicWorkPolicy.UPDATE
                manager.enqueueUniquePeriodicWork(WORK_NAME, policy, request(interval, chargingOnly)).result.get()
            }
        } catch (error: Exception) {
            if (interval != "off") saveSettings(previous, previousCharging)
            throw IllegalStateException("Android could not update the Auto-scan schedule.", error)
        }
        status()
    }

    suspend fun recoverSchedule() = updates.withLock {
        val interval = prefs.getString("interval", "off")
        if (interval == "daily" || interval == "weekly") {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE,
                request(interval, chargingOnly())).result.get()
        }
    }

    private fun request(interval: String, chargingOnly: Boolean) = PeriodicWorkRequest.Builder(
        GalleryAutoScanWorker::class.java, if (interval == "daily") 1 else 7, TimeUnit.DAYS
    ).setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).setRequiresCharging(chargingOnly).build())
        .setBackoffCriteria(androidx.work.BackoffPolicy.LINEAR, 15, TimeUnit.MINUTES).build()

    @Synchronized
    private fun saveSettings(interval: String, chargingOnly: Boolean) {
        val edit = prefs.edit().putString("interval", interval).putBoolean("charging", chargingOnly)
            .putLong("epoch", epoch() + 1)
        if (interval != "off") edit.putString("preferred_interval", interval)
        check(edit.commit()) { "Could not save Auto-scan settings." }
    }

    @Synchronized
    fun invalidateCheckpoint(clearStatus: Boolean = false) {
        val edit = prefs.edit().remove("before").remove("sweep_token").remove("settled_token")
            .putLong("epoch", epoch() + 1)
        if (clearStatus) edit.remove("last_check").remove("last_outcome").remove("analyzed").remove("failed").remove("more")
        edit.apply()
    }

    suspend fun selectBatch(access: String): AutoScanBatch {
        val checkpoint = prefs.all
        val token = gallery.changeToken()
        val sameAccess = checkpoint["access"] == access
        if (sameAccess && token != null && token == checkpoint["settled_token"]) {
            return AutoScanBatch(emptyList(), access, null, token)
        }
        var before = (checkpoint["before"] as? Long)?.takeIf { sameAccess } ?: Long.MAX_VALUE
        val sweepToken = if (before == Long.MAX_VALUE) token else checkpoint["sweep_token"] as? String
        val excluded = memory.excludedAlbums().mapNotNull { it["id"] }.toSet()
        val photos = mutableListOf<Photo>()
        if (before != Long.MAX_VALUE) {
            val recent = gallery.page(emptyList(), Long.MAX_VALUE, PAGE_SIZE)
                .filter { it.id >= before && it.bucket !in excluded }
            photos.addAll(memory.pendingAutoScanPhotos(recent).take(PHOTOS_PER_CHECK / 4))
        }
        repeat(PAGES_PER_CHECK) {
            currentCoroutineContext().ensureActive()
            val page = gallery.page(emptyList(), before, PAGE_SIZE)
            val pending = memory.pendingAutoScanPhotos(page.filter { it.bucket !in excluded })
            val slots = PHOTOS_PER_CHECK - photos.size
            photos.addAll(pending.take(slots))
            if (pending.size > slots) return AutoScanBatch(photos, access, photos.last().id, sweepToken)
            if (page.size < PAGE_SIZE) return AutoScanBatch(photos, access, null, sweepToken)
            before = page.last().id
            if (photos.size == PHOTOS_PER_CHECK) return AutoScanBatch(photos, access, before, sweepToken)
        }
        return AutoScanBatch(photos, access, before, sweepToken)
    }

    @Synchronized
    fun record(expectedEpoch: Long, outcome: String, batch: AutoScanBatch? = null, progress: ScanProgress? = null) {
        if (!enabled() || expectedEpoch != epoch()) return
        val edit = prefs.edit().putLong("last_check", System.currentTimeMillis()).putString("last_outcome", outcome)
            .putInt("analyzed", progress?.analyzed ?: 0).putInt("failed", progress?.failed ?: 0)
            .putBoolean("more", batch?.nextBefore != null || outcome == "partial")
        if (outcome == "complete" && batch != null) {
            edit.putString("access", batch.access).remove("settled_token")
            val token = batch.sweepToken?.takeIf { progress?.failed == 0 }
            if (batch.nextBefore != null) edit.putLong("before", batch.nextBefore).putString("sweep_token", token)
            else {
                edit.remove("before").remove("sweep_token")
                if (token != null && token == gallery.changeToken()) edit.putString("settled_token", token)
            }
        }
        edit.apply()
    }
}

class GalleryAutoScanWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val runtime = GalleryRuntime.get(applicationContext)
        val schedule = runtime.autoScan
        val epoch = schedule.epoch()
        if (!schedule.enabled()) return@withContext Result.success()
        val access = runtime.gallery.access()
        if (access == "none") {
            schedule.record(epoch, "access")
            return@withContext Result.success()
        }

        if (!runtime.modelInference.tryLock()) return@withContext Result.retry()
        val task = try {
            if (runtime.deletionPending) null else runtime.worker.startAutomatic { schedule.selectBatch(access) }
        } finally { runtime.modelInference.unlock() } ?: return@withContext Result.retry()

        try {
            val result = withTimeoutOrNull(CHECK_TIMEOUT_MS) { task.await() }
            if (result == null) {
                task.cancelAndJoin()
                schedule.record(epoch, "partial")
            } else {
                val (batch, progress) = result
                val outcome = when {
                    runtime.gallery.access() == "none" -> "access"
                    runtime.gallery.access() != access -> "partial"
                    progress.phase == "complete" -> "complete"
                    else -> "error"
                }
                schedule.record(epoch, outcome, batch, progress)
            }
        } catch (error: CancellationException) {
            currentCoroutineContext().ensureActive()
            // The foreground scanner took priority, or the user stopped this check.
        } catch (error: Exception) {
            Log.w("NimbyAutoScan", "Auto-scan could not complete", error)
            schedule.record(epoch, if (runtime.gallery.access() == "none") "access" else "error")
        } finally {
            withContext(NonCancellable) { task.cancelAndJoin() }
        }
        Result.success()
    }
}
