package dev.nimby.gallery

internal data class TimelinePhotoStamp(val id: Long, val captured: Long)

// Stamps and Float32 slots share the same order. Only nearby captures need comparison.
internal fun timelineSceneNeighbors(stamps: List<TimelinePhotoStamp>, vectors: FloatArray, loaded: BooleanArray,
                                    checkActive: () -> Unit): Map<Long, List<String>> = buildMap {
    val sixHours = 6L * 60 * 60 * 1_000
    for (left in stamps.indices) {
        checkActive()
        if (!loaded[left]) continue
        val best = TopVisualMatches(3, 0.86)
        for (right in left + 1 until minOf(stamps.size, left + 49)) {
            if (stamps[right].captured - stamps[left].captured > sixHours) break
            if (!loaded[right]) continue
            val score = embeddingScore(vectors, vectors, right * EYE_EMBEDDING_DIMENSIONS, left * EYE_EMBEDDING_DIMENSIONS)
            best.offer(stamps[right].id, score)
        }
        val matches = best.ranked()
        if (matches.isNotEmpty()) put(stamps[left].id, matches.map { it.id.toString() })
    }
}
