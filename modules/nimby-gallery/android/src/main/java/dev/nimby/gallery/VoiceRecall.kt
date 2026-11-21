package dev.nimby.gallery

import ai.moonshine.voice.JNI
import ai.moonshine.voice.Transcriber
import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

internal class VoiceRecall(private val context: Context) {
    private data class Part(val name: String, val bytes: Long, val sha256: String)
    private data class Recording(val stopped: AtomicBoolean, val audio: Deferred<FloatArray>)
    private val directory = File(context.noBackupFilesDir, "moonshine-tiny-en-26-11-02")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val downloads = Mutex()
    private val microphone = Mutex()
    private var active: Recording? = null

    fun status() = mapOf("ready" to modelReady(), "bytes" to MODEL.sumOf { it.bytes })

    private fun modelReady(): Boolean = File(directory, "verified").isFile &&
        MODEL.all { File(directory, it.name).length() == it.bytes }

    suspend fun install() = downloads.withLock {
        requireSupported()
        if (modelReady()) return@withLock
        check(directory.isDirectory || directory.mkdirs()) { "Nimby could not prepare model storage." }
        val ready = File(directory, "verified")
        ready.delete()
        for (part in MODEL) {
            currentCoroutineContext().ensureActive()
            val destination = File(directory, part.name)
            if (destination.length() == part.bytes && sha256(destination) == part.sha256) continue
            val temp = File.createTempFile("voice", ".part", directory)
            val connection = URL("$BASE/${part.name}").openConnection() as HttpsURLConnection
            try {
                connection.connectTimeout = 15_000
                connection.readTimeout = 30_000
                connection.instanceFollowRedirects = false
                check(connection.responseCode == 200) { "Could not download the English voice model. Try again." }
                connection.inputStream.use { input ->
                    temp.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var remaining = part.bytes
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            remaining -= count
                            check(remaining >= 0) { "Unexpected voice model size." }
                            output.write(buffer, 0, count)
                        }
                    }
                }
                check(temp.length() == part.bytes && sha256(temp) == part.sha256) {
                    "The English voice model failed its integrity check."
                }
                check(!destination.exists() || destination.delete()) { "Could not replace a damaged model file." }
                check(temp.renameTo(destination)) { "Could not save the English voice model." }
            } finally {
                connection.disconnect()
                temp.delete()
            }
        }
        ready.writeText("verified")
    }

    @Synchronized fun start() {
        requireSupported()
        check(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            "Allow microphone access to search by voice."
        }
        check(modelReady()) { "Download the English voice model first." }
        check(active == null) { "A recording is already in progress." }
        val stopped = AtomicBoolean(false)
        active = Recording(stopped, scope.async { microphone.withLock { capture(stopped) } })
    }

    suspend fun finish(): String {
        requireSupported()
        val recording = synchronized(this) { active } ?: return ""
        recording.stopped.set(true)
        val audio = try { recording.audio.await() } finally {
            synchronized(this) { if (active === recording) active = null }
        }
        if (audio.isEmpty()) return ""
        val transcriber = Transcriber()
        return try {
            transcriber.loadFromFiles(directory.absolutePath, JNI.MOONSHINE_MODEL_ARCH_TINY_STREAMING)
            transcriber.transcribeWithoutStreaming(audio, SAMPLE_RATE).text().trim()
        } finally {
            audio.fill(0f)
            transcriber.close()
        }
    }

    @Synchronized fun cancelRecording() {
        val recording = active ?: return
        recording.stopped.set(true)
        active = null
    }

    fun destroy() {
        cancelRecording()
        scope.cancel()
    }

    private fun requireSupported() {
        check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) { "English voice search requires Android 8 or newer." }
    }

    @SuppressLint("MissingPermission")
    private suspend fun capture(stopped: AtomicBoolean): FloatArray {
        val format = AudioFormat.ENCODING_PCM_16BIT
        val channel = AudioFormat.CHANNEL_IN_MONO
        val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, channel, format)
        check(minimum > 0) { "This phone could not initialize its microphone." }
        val recorder = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE, channel, format, maxOf(minimum, 4096))
        val samples = FloatArray(SAMPLE_RATE * 12)
        val buffer = ShortArray(1024)
        var size = 0
        try {
            check(recorder.state == AudioRecord.STATE_INITIALIZED) { "This phone could not initialize its microphone." }
            if (stopped.get()) return FloatArray(0)
            recorder.startRecording()
            val deadline = SystemClock.elapsedRealtime() + 12_000
            while (!stopped.get() && size < samples.size && SystemClock.elapsedRealtime() < deadline) {
                currentCoroutineContext().ensureActive()
                val count = recorder.read(buffer, 0, minOf(buffer.size, samples.size - size))
                check(count >= 0) { "The microphone stopped before Nimby could finish recording." }
                for (index in 0 until count) samples[size++] = buffer[index] / 32768f
            }
            return samples.copyOf(size)
        } finally {
            if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop()
            recorder.release()
            samples.fill(0f)
            buffer.fill(0)
        }
    }

    private fun sha256(file: File): String {
        val hash = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                hash.update(buffer, 0, read)
            }
        }
        return hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }

    companion object {
        private const val SAMPLE_RATE = 16_000
        private const val BASE = "https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_11_02"
        private val MODEL = listOf(
            Part("adapter.ort", 1319616L, "c5f9f7cc98c27a965d8e200816f7e5c07b892712bb30cf07444bbde4ffd38199"),
            Part("cross_kv.ort", 1287504L, "5f68900da4ea20f40fbe67bbec36399f0d47faedbd7198b29abd9dc5f472ef9f"),
            Part("decoder_kv.ort", 32748720L, "6564f2c9a19de44195a53e336e07d05108f14babab57105d623bb68b79572d75"),
            Part("encoder.ort", 7675392L, "617e403b2aae48f2474e0b148bf835deb9510bc8692efeabfe27203959a3256e"),
            Part("frontend.model.ort", 23392L, "5662679f0e5758646d8eade3bc4b5d9ebda875feb6e696c0cc5f1a08fea2219e"),
            Part("frontend.weights.ort", 2093416L, "55c91d7efab9f7506d7d753131cba72145ff016be3447319fe414a31e13f25b4"),
            Part("streaming_config.json", 509L, "74fe5ddebd63b17caf59e8a3b18c17547ff7bce1642050edbb1c3962674f8950"),
            Part("tokenizer.bin", 249974L, "6884b35fd6377d4c4d32336a0bc152f36b64d1e45b6503683cdc238250a8472d"),
        )
    }
}
