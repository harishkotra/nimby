package dev.nimby.gallery

import ai.desertant.eye.Eye
import ai.desertant.eye.Options
import ai.desertant.eye.Part
import ai.desertant.eye.Analysis as EyeAnalysis
import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import kotlin.math.max
import kotlin.math.roundToInt

internal const val EYE_VERSION = "4.3.0"
internal val EYE_FILES = listOf("eye.tflite", "eye_meta.json")
internal fun eyeDirectory(context: Context) = File(context.noBackupFilesDir, "eye-$EYE_VERSION")

internal class EyeEngine(private val context: Context) : AutoCloseable {
    private var eye: Eye? = null
    private val photoOptions = Options(parts = setOf(Part.PHOTO))

    suspend fun prepare() {
        val directory = eyeDirectory(context)
        directory.mkdirs()
        for (name in EYE_FILES) {
            val target = File(directory, name)
            if (target.isFile && target.length() > 0) continue
            val temporary = File.createTempFile("eye-", ".part", directory)
            try {
                context.assets.open("eye/$name").use { input ->
                    temporary.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                        }
                    }
                }
                if (!temporary.renameTo(target)) throw IOException("Cannot stage the packaged Eye model.")
            } finally {
                temporary.delete()
            }
        }
        val engine = Eye(context, directory = directory.absolutePath)
        eye = engine
        check(engine.isDownloaded()) { "The packaged Eye model could not be verified." }
        engine.download()
    }

    suspend fun infer(bitmap: Bitmap): EyeAnalysis = checkNotNull(eye).analyze(bitmap, photoOptions)

    override fun close() {
        eye?.close()
        eye = null
    }
}

private val referenceCategories = mapOf(
    "receipt" to "Receipts",
    "document" to "Documents",
    "whiteboard" to "Notes and whiteboards",
    "handwriting" to "Notes and whiteboards",
    "shopping_reference" to "Shopping references",
    "screenshot" to "Screenshots",
    "photo_of_screen" to "Screenshots",
    "map" to "Other references",
    "chart_or_slide" to "Other references",
    "medical_reference" to "Other references",
    "repair_reference" to "Other references",
    "reference" to "Other references",
    "reference_photo" to "Other references"
)

internal fun mapEyeAnalysis(result: EyeAnalysis): Analysis {
    val kind = result.kind?.id
    val scores = result.confidences.entries.associate { (tag, score) -> tag.id to score }
        .filterValues { it in 0.0..1.0 }
    fun confidence(tag: String) = scores[tag]
    val matches = referenceCategories.keys.filter { (confidence(it) ?: 0.0) >= 0.5 }
    // A receipt or shopping page can also be a screenshot. Prefer the specific reference type.
    val category = matches.filterNot { it in setOf("screenshot", "photo_of_screen", "reference", "reference_photo") }
        .maxByOrNull { confidence(it) ?: 0.0 }
        ?: matches.maxByOrNull { confidence(it) ?: 0.0 }
    val tags = JSONArray()
    scores.entries.asSequence().filter { it.value >= 0.5 }.sortedByDescending { it.value }.take(18)
        .forEach { (tag, score) -> tags.put(JSONObject().put("label", tag).put("confidence", score)) }
    val stored = JSONObject().put("model", result.model).put("kind", kind).put("tags", JSONObject(scores))
    val serialized = JSONObject(result.toJson())
    serialized.optJSONObject("duplicates")?.let { stored.put("duplicates", it) }
    serialized.optJSONObject("scores")?.let { stored.put("scores", it) }
    return Analysis(stored.toString(), kind, kind?.let(::confidence), tags, referenceCategories[category],
        result.embedding?.takeIf { vector -> vector.all(Float::isFinite) } ?: FloatArray(0))
}

internal fun decodePhoto(resolver: ContentResolver, uri: Uri): Bitmap {
    val maxEdge = 960
    if (Build.VERSION.SDK_INT >= 28) {
        return ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            val longest = max(info.size.width, info.size.height)
            if (longest > maxEdge) {
                val scale = maxEdge.toDouble() / longest
                decoder.setTargetSize(
                    (info.size.width * scale).roundToInt().coerceAtLeast(1),
                    (info.size.height * scale).roundToInt().coerceAtLeast(1)
                )
            }
        }
    }

    fun stream() = resolver.openInputStream(uri) ?: throw IOException("This photo is no longer accessible.")
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    stream().use { BitmapFactory.decodeStream(it, null, options) }
    options.inJustDecodeBounds = false
    options.inSampleSize = 1
    val longest = max(options.outWidth, options.outHeight)
    while (longest / options.inSampleSize > maxEdge) options.inSampleSize *= 2
    val bitmap = stream().use { BitmapFactory.decodeStream(it, null, options) }
        ?: throw IOException("This photo format could not be decoded.")
    val exif = try {
        stream().use { ExifInterface(it) }
    } catch (_: IOException) {
        return bitmap
    }
    if (exif.rotationDegrees == 0 && !exif.isFlipped) return bitmap
    val matrix = Matrix().apply {
        if (exif.isFlipped) postScale(-1f, 1f)
        postRotate(exif.rotationDegrees.toFloat())
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        .also { if (it !== bitmap) bitmap.recycle() }
}
