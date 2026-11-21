package dev.nimby.gallery

import android.content.Context
import android.os.Build
import android.os.SystemClock
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.OpenApiTool
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.tool
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

internal class FunctionGemma(context: Context) {
    private val directory = File(context.noBackupFilesDir, "functiongemma")
    private val model = File(directory, "mobile-actions-q8-$SHA256.litertlm")
    private val lock = Mutex()
    private val supported = Build.SUPPORTED_ABIS.any { it == "arm64-v8a" || it == "x86_64" }
    @Volatile private var phase = "idle"
    @Volatile private var received = 0L
    @Volatile private var issue: String? = null
    @Volatile private var lastInferenceMs: Long? = null

    fun status() = mapOf("supported" to supported, "downloaded" to model.isFile,
        "phase" to phase, "bytes" to received, "issue" to issue, "lastInferenceMs" to lastInferenceMs)

    suspend fun install() = lock.withLock {
        check(supported) { "FunctionGemma needs a supported 64-bit Android device." }
        if (model.isFile) return@withLock
        issue = null
        received = 0
        phase = "downloading"
        try {
            check(directory.isDirectory || directory.mkdirs()) { "Could not prepare model storage." }
            check(directory.usableSpace >= 310_000_000L) { "Free at least 310 MB to install FunctionGemma." }
            val pending = File(directory, "functiongemma.part")
            val connection = URI.create(MODEL_URL).toURL().openConnection() as HttpsURLConnection
            try {
                connection.connectTimeout = 15_000
                connection.readTimeout = 30_000
                check(connection.responseCode == 200) { "The model download is unavailable. Try again later." }
                val hash = MessageDigest.getInstance("SHA-256")
                connection.inputStream.use { input ->
                    pending.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            received += count
                            check(received <= 310_000_000L) { "Unexpected FunctionGemma download size." }
                            hash.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                        }
                    }
                }
                val digest = hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
                check(digest == SHA256) { "The model download failed its integrity check." }
                check(pending.renameTo(model)) { "Could not save the verified model." }
            } finally {
                connection.disconnect()
                pending.delete()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            issue = "Could not download or verify FunctionGemma. Check your connection and free storage."
            throw IllegalStateException(issue, error)
        } finally {
            phase = "idle"
        }
    }

    suspend fun remove() = lock.withLock {
        check(!model.exists() || model.delete()) { "Could not remove FunctionGemma." }
        issue = null
        lastInferenceMs = null
    }

    suspend fun suggest(kind: String, hasComparison: Boolean, hasReturnDate: Boolean): String? {
        val options = when (kind) {
            "shopping" -> if (hasComparison) listOf("compare_products", "revisit_product") else listOf("revisit_product")
            "receipt" -> if (hasReturnDate) listOf("suggest_return_reminder", "review_receipt") else listOf("review_receipt")
            else -> error("This photo has no supported next step.")
        }.associateWith { name -> when (name) {
            "compare_products" -> "Compare related product screenshots the user saved."
            "revisit_product" -> "Offer to review this saved product screenshot."
            "suggest_return_reminder" -> "Offer a reminder for the explicit return deadline printed on the receipt."
            else -> "Offer to review the saved receipt for filing or reimbursement."
        } } + ("show_nothing" to "Show no suggestion when the evidence is unclear.")
        val request = when {
            kind == "shopping" && hasComparison -> "I saved several screenshots of similar products. Help me compare my saved options before deciding."
            kind == "shopping" -> "I saved a screenshot of a product. Help me revisit the saved product details."
            hasReturnDate -> "Remind me to check this receipt before the return deadline I found on it. Suggest a return reminder for me to review."
            else -> "I saved a receipt. Help me review it for filing or reimbursement. The receipt has no clear return date."
        }
        return choose(options, request)
    }

    private suspend fun choose(options: Map<String, String>, request: String): String? = lock.withLock {
        check(supported && model.isFile) { "Download FunctionGemma first." }
        issue = null
        phase = "loading"
        try {
            Engine(EngineConfig(modelPath = model.absolutePath, backend = Backend.CPU(threadCount = 2),
                maxNumTokens = 1024, cacheDir = ":nocache")).use { engine ->
                engine.initialize()
                phase = "running"
                val config = ConversationConfig(
                    systemInstruction = Contents.of("You are a model that can do function calling with the following functions"),
                    tools = options.map { (name, description) -> tool(ProposalTool(name, description)) }, automaticToolCalling = false,
                    samplerConfig = SamplerConfig(topK = 1, topP = 1.0, temperature = 0.0), maxOutputToken = 64,
                )
                engine.createConversation(config).use { conversation ->
                    val start = SystemClock.elapsedRealtime()
                    val reply = conversation.sendMessage(request)
                    lastInferenceMs = SystemClock.elapsedRealtime() - start
                    return@withLock reply.toolCalls.singleOrNull()?.name?.takeIf { it in options }
                }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            issue = "FunctionGemma could not complete an on-device suggestion."
            null
        } catch (_: LinkageError) {
            issue = "FunctionGemma could not load its Android runtime."
            null
        } finally {
            phase = "idle"
        }
    }

    // These functions describe possible UI suggestions. The runtime never executes them.
    private class ProposalTool(private val name: String, private val description: String) : OpenApiTool {
        override fun getToolDescriptionJsonString() = JSONObject().put("name", name).put("description", description)
            .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject())).toString()

        override fun execute(paramsJsonString: String): String = error("Suggestions cannot execute actions.")
    }

    companion object {
        private const val MODEL_URL = "https://huggingface.co/litert-community/functiongemma-mobile-actions_q8_ekv1024.litertlm/resolve/5683618019f1025f4dd567d26f58dc0ebb6244f2/mobile-actions_q8_ekv1024.litertlm"
        private const val SHA256 = "92109695f911d1872fa8ae07c1e3ff0ed70f2c3d1690d410ec6db8587c2ab409"
    }
}
