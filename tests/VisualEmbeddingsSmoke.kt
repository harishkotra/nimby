package dev.nimby.gallery

import kotlin.math.abs
import kotlin.math.sqrt
import kotlin.random.Random

fun main() {
    val random = Random(7)
    val vectors = List(4096) {
        FloatArray(EYE_EMBEDDING_DIMENSIONS) { index -> if (index == 0) 15f else random.nextFloat() - 0.5f }
    }
    val raw = vectors.first()
    val reference = checkNotNull(unitEmbedding(raw))
    val decoded = FloatArray(EYE_EMBEDDING_DIMENSIONS)
    check(unitEmbedding(decoded) == null)
    decoded[0] = Float.NaN
    check(unitEmbedding(decoded) == null)
    check(!decodeEmbedding(ByteArray(4), decoded))
    check(decodeEmbedding(encodeEmbedding(reference), decoded))
    check(decoded.contentEquals(reference))
    check(abs(embeddingScore(reference, decoded) - 1.0) < 1e-7)

    val legacy = vectors.mapIndexed { index, candidate -> VisualMatch(index.toLong(), cosine(raw, candidate)) }
        .sortedWith(compareByDescending<VisualMatch> { it.score }.thenBy { it.id }).take(24)
    val blobs = vectors.map { encodeEmbedding(checkNotNull(unitEmbedding(it))) }

    fun search(cache: VisualEmbeddingCache): Pair<List<VisualMatch>, Int> {
        cache.startQuery()
        val best = TopVisualMatches(24)
        var hits = 0
        for ((index, blob) in blobs.withIndex()) {
            val id = index.toLong()
            val hit = cache.score(id, reference)
            if (hit != null) {
                hits++
                best.offer(id, hit)
            } else {
                check(decodeEmbedding(blob, decoded))
                best.offer(id, embeddingScore(reference, decoded))
                cache.put(id, decoded)
            }
        }
        return best.ranked() to hits
    }

    val small = VisualEmbeddingCache(128)
    val (initial, coldHits) = search(small)
    check(coldHits == 0)
    check(search(small) == (initial to 128))
    check(initial.map(VisualMatch::id) == legacy.map(VisualMatch::id))
    check(initial.zip(legacy).all { (unit, cosine) -> abs(unit.score - cosine.score) < 1e-7 })
    small.startQuery()
    small.replace(0L, FloatArray(reference.size) { -reference[it] })
    check(abs(checkNotNull(small.score(0L, reference)) + 1.0) < 1e-7)

    val ties = TopVisualMatches(2)
    for (id in listOf(5L, 2L, 3L, 1L)) ties.offer(id, 0.8)
    ties.offer(8L, Double.NaN)
    ties.offer(9L, 0.59)
    check(ties.ranked().map(VisualMatch::id) == listOf(1L, 2L))

    val cache = VisualEmbeddingCache(blobs.size)
    repeat(10) { search(cache) } // Warm up the JVM before measuring application-cache cold and warm runs.
    fun timing(cache: VisualEmbeddingCache, expectedHits: Int): Double {
        val start = System.nanoTime()
        val (matches, hits) = search(cache)
        val ms = (System.nanoTime() - start) / 1_000_000.0
        check(matches == initial && hits == expectedHits)
        return ms
    }
    val cold = mutableListOf<Double>()
    val warm = mutableListOf<Double>()
    repeat(9) {
        val fresh = VisualEmbeddingCache(blobs.size)
        cold += timing(fresh, 0)
        warm += timing(fresh, blobs.size)
    }
    println("4096 vectors × 512 dimensions, host JVM scoring median: cold %.2f ms, warm %.2f ms"
        .format(cold.sorted()[cold.size / 2], warm.sorted()[warm.size / 2]))
}

private fun cosine(left: FloatArray, right: FloatArray): Double {
    var dot = 0.0
    var leftSquares = 0.0
    var rightSquares = 0.0
    for (index in left.indices) {
        val a = left[index].toDouble()
        val b = right[index].toDouble()
        dot += a * b
        leftSquares += a * a
        rightSquares += b * b
    }
    return dot / sqrt(leftSquares * rightSquares)
}
