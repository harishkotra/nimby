package dev.nimby.gallery

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.PriorityQueue
import kotlin.math.sqrt

internal const val EYE_EMBEDDING_DIMENSIONS = 512
internal const val EYE_EMBEDDING_BYTES = EYE_EMBEDDING_DIMENSIONS * Float.SIZE_BYTES

internal fun unitEmbedding(values: FloatArray): FloatArray? {
    if (values.size != EYE_EMBEDDING_DIMENSIONS) return null
    var squares = 0.0
    for (value in values) {
        if (!value.isFinite()) return null
        squares += value.toDouble() * value
    }
    if (squares <= 0.0) return null
    val norm = sqrt(squares)
    return FloatArray(values.size) { (values[it] / norm).toFloat() }
}

internal fun encodeEmbedding(values: FloatArray): ByteArray = ByteArray(EYE_EMBEDDING_BYTES).also {
    ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().put(values)
}

internal fun decodeEmbedding(bytes: ByteArray, into: FloatArray, offset: Int = 0): Boolean {
    if (bytes.size != EYE_EMBEDDING_BYTES) return false
    ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(into, offset, EYE_EMBEDDING_DIMENSIONS)
    return true
}

internal fun embeddingScore(reference: FloatArray, values: FloatArray, offset: Int = 0, referenceOffset: Int = 0): Double {
    var score = 0.0
    for (index in 0 until EYE_EMBEDDING_DIMENSIONS) score += reference[referenceOffset + index].toDouble() * values[offset + index]
    return score.coerceIn(-1.0, 1.0)
}

// The caller serializes searches and embedding writes. IDs are looked up in SQLite before using this cache.
internal class VisualEmbeddingCache(private val capacity: Int) {
    private val data = FloatArray(capacity * EYE_EMBEDDING_DIMENSIONS)
    private val slots = LinkedHashMap<Long, Int>(16, 0.75f, true)
    private val lastUsed = LongArray(capacity)
    private var nextSlot = 0
    private var query = 0L

    fun startQuery() { query++ }

    fun replace(id: Long, vector: FloatArray) {
        val slot = slots[id] ?: return
        vector.copyInto(data, slot * EYE_EMBEDDING_DIMENSIONS)
    }

    fun score(id: Long, reference: FloatArray): Double? {
        val slot = slots[id] ?: return null
        lastUsed[slot] = query
        return embeddingScore(reference, data, slot * EYE_EMBEDDING_DIMENSIONS)
    }

    fun put(id: Long, vector: FloatArray) {
        val slot = if (nextSlot < capacity) nextSlot++ else {
            val oldest = slots.entries.iterator()
            val candidate = oldest.next().value
            // Keep vectors already used by this query so a large sequential scan won't flush the cache.
            if (lastUsed[candidate] == query) return
            oldest.remove()
            candidate
        }
        vector.copyInto(data, slot * EYE_EMBEDDING_DIMENSIONS)
        slots[id] = slot
        lastUsed[slot] = query
    }
}

internal data class VisualMatch(val id: Long, val score: Double)

internal class TopVisualMatches(private val capacity: Int, private val minimum: Double = 0.60) {
    private val order = compareBy<VisualMatch> { it.score }.thenByDescending { it.id }
    private val best = PriorityQueue<VisualMatch>(capacity, order)

    fun offer(id: Long, score: Double) {
        if (!score.isFinite() || score < minimum) return
        if (best.size == capacity) {
            val last = best.element()
            if (score < last.score || (score == last.score && id >= last.id)) return
            best.poll()
        }
        best.add(VisualMatch(id, score))
    }

    fun ranked(): List<VisualMatch> = best.sortedWith(order.reversed())
}
