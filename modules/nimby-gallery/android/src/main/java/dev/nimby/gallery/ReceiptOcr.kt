package dev.nimby.gallery

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File
import java.io.IOException
import kotlin.math.roundToInt

internal class ReceiptOcr(private val context: Context) : AutoCloseable {
    private var engine: TessBaseAPI? = null

    // null means the source or recognizer was unavailable; an empty string is a completed recognition.
    @Synchronized
    fun recognize(uri: Uri): String? {
        return try {
            val bitmap = decode(uri)
            try {
                val tess = engine ?: prepare().also { engine = it }
                try {
                    tess.setImage(bitmap)
                    tess.getUTF8Text().orEmpty().trim().take(32_768)
                } finally {
                    tess.clear()
                }
            } finally {
                bitmap.recycle()
            }
        } catch (_: IOException) {
            null
        } catch (_: RuntimeException) {
            close()
            null
        } catch (_: LinkageError) {
            close()
            null
        }
    }

    private fun prepare(): TessBaseAPI {
        val root = File(context.noBackupFilesDir, "recall-ocr-4.1.0")
        val data = File(root, "tessdata").apply { mkdirs() }
        val weights = File(data, "eng.traineddata")
        if (weights.length() != 4_113_088L) {
            val stage = File.createTempFile("eng", null, data)
            try {
                context.assets.open("ocr/eng.traineddata").use { input ->
                    stage.outputStream().use { output -> input.copyTo(output) }
                }
                if (stage.length() != 4_113_088L || !stage.renameTo(weights)) {
                    throw IOException("Could not install the English text recognition model.")
                }
            } finally {
                stage.delete()
            }
        }
        val tess = TessBaseAPI()
        try {
            check(tess.init(root.absolutePath, "eng", TessBaseAPI.OEM_LSTM_ONLY))
            tess.setPageSegMode(TessBaseAPI.PageSegMode.PSM_SPARSE_TEXT)
            return tess
        } catch (failure: Throwable) {
            tess.recycle()
            throw failure
        }
    }

    private fun decode(uri: Uri): Bitmap {
        if (Build.VERSION.SDK_INT < 28) return decodePhoto(context.contentResolver, uri)
        return ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
            val width = info.size.width
            val height = info.size.height
            val longest = maxOf(width, height)
            if (longest > 2_048) {
                val scale = 2_048.0 / longest
                decoder.setTargetSize((width * scale).roundToInt().coerceAtLeast(1), (height * scale).roundToInt().coerceAtLeast(1))
            }
        }
    }

    @Synchronized
    override fun close() {
        val tess = engine
        engine = null
        tess?.recycle()
    }
}
