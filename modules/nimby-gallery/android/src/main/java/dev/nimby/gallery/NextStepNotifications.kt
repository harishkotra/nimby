package dev.nimby.gallery

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

internal class NextStepNotifications(private val context: Context) {
    private val manager = requireNotNull(context.getSystemService(NotificationManager::class.java))
    private val prefs = context.getSharedPreferences("next-step-notifications", Context.MODE_PRIVATE)
    private val work get() = WorkManager.getInstance(context)

    fun status() = mapOf("shopping" to prefs.getBoolean("shopping", false),
        "remindersAvailable" to allowed(REMINDERS), "shoppingAvailable" to allowed(SHOPPING))

    fun setShopping(enabled: Boolean) {
        if (enabled) check(allowed(SHOPPING)) { "Allow shopping notifications in Android settings first." }
        prefs.edit().putBoolean("shopping", enabled).apply()
        if (enabled) offerShoppingDigest() else {
            work.cancelUniqueWork(DIGEST_WORK)
            manager.cancel(DIGEST_WORK, NOTIFICATION_ID)
        }
    }

    fun offerShoppingDigest() {
        if (!prefs.getBoolean("shopping", false) || !allowed(SHOPPING)) return
        val earliest = maxOf(DAY, prefs.getLong("last_shopping", 0) + 7 * DAY - System.currentTimeMillis())
        work.enqueueUniqueWork(DIGEST_WORK, ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<NextStepWorker>().setInitialDelay(earliest, TimeUnit.MILLISECONDS).build())
    }

    fun schedule(memory: GalleryMemory, id: String, due: Long) {
        check(allowed(REMINDERS)) { "Allow Nimby reminders in Android settings first." }
        require(due > System.currentTimeMillis()) { "Choose a reminder time in the future." }
        check(memory.nextStep(id) != null) { "This photo is no longer available for follow-up." }
        memory.writeFollowUp(id, "scheduled", due)
        enqueue(id, due, ExistingWorkPolicy.REPLACE).result.get(10, TimeUnit.SECONDS)
        manager.cancel(reminderKey(id), NOTIFICATION_ID)
    }

    fun recover(memory: GalleryMemory) {
        if (!allowed(REMINDERS)) return
        for ((id, due) in memory.scheduledFollowUps()) enqueue(id, due, ExistingWorkPolicy.KEEP)
    }

    fun stop(id: String) {
        work.cancelUniqueWork(reminderKey(id))
        manager.cancel(reminderKey(id), NOTIFICATION_ID)
    }

    fun explicitReminder(memory: GalleryMemory, id: String, due: Long) {
        val item = memory.nextStep(id) ?: return
        if (item["state"] != "scheduled" || item["due"] != due || !allowed(REMINDERS)) return
        post(REMINDERS, reminderKey(id), id, "A saved photo is ready to revisit.")
        memory.markFollowUpDelivered(id, due)
    }

    fun shoppingDigest(memory: GalleryMemory) {
        if (!prefs.getBoolean("shopping", false) || !allowed(SHOPPING)) return
        val now = System.currentTimeMillis()
        val last = prefs.getLong("last_shopping", 0)
        if (now - last < 7 * DAY) return
        val id = memory.recentShopping(maxOf(last, now - 14 * DAY)) ?: return
        post(SHOPPING, DIGEST_WORK, id, "You have saved shopping references to review.")
        prefs.edit().putLong("last_shopping", now).apply()
    }

    private fun enqueue(id: String, due: Long, policy: ExistingWorkPolicy): androidx.work.Operation {
        val input = Data.Builder().putString("photo", id).putLong("due", due).build()
        val request = OneTimeWorkRequestBuilder<NextStepWorker>().setInputData(input)
            .setInitialDelay((due - System.currentTimeMillis()).coerceAtLeast(0), TimeUnit.MILLISECONDS).build()
        return work.enqueueUniqueWork(reminderKey(id), policy, request)
    }

    private fun allowed(channel: String): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        if (!manager.areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(channel)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    private fun post(channel: String, key: String, id: String, message: String) {
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            val name = if (channel == REMINDERS) "Photo reminders" else "Shopping suggestions"
            manager.createNotificationChannel(NotificationChannel(channel, name, NotificationManager.IMPORTANCE_LOW))
            Notification.Builder(context, channel)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nimby://next-steps/$id")).setPackage(context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(key, NOTIFICATION_ID, builder.setSmallIcon(R.drawable.ic_next_step)
            .setContentTitle("Nimby").setContentText(message).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(open).setOnlyAlertOnce(true).setAutoCancel(true).build())
    }

    private fun reminderKey(id: String) = "nimby-photo-reminder-$id"

    companion object {
        private const val REMINDERS = "nimby-photo-reminders"
        private const val SHOPPING = "nimby-shopping-suggestions"
        private const val DIGEST_WORK = "nimby-shopping-digest"
        private const val NOTIFICATION_ID = 1
        private const val DAY = 24L * 60 * 60 * 1000
    }
}

class NextStepWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = try {
        val notifications = NextStepNotifications(applicationContext)
        GalleryMemory(applicationContext, GallerySource(applicationContext)).use { memory ->
            val id = inputData.getString("photo")
            if (id == null) notifications.shoppingDigest(memory)
            else notifications.explicitReminder(memory, id, inputData.getLong("due", 0))
        }
        Result.success()
    } catch (_: SecurityException) {
        Result.success()
    } catch (_: Exception) {
        if (runAttemptCount >= 2) Result.failure() else Result.retry()
    }
}
