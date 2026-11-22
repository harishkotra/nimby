package dev.nimby.gallery

fun main() {
    val photo = DiscoveryTraits("Photos", listOf("forest"))
    val receipt = DiscoveryTraits("Receipts", listOf("coffee"))
    val screen = DiscoveryTraits("Screenshots", listOf("app settings"))
    val candidates = listOf(
        DiscoveryCandidate(1, photo, null, false, 1),
        DiscoveryCandidate(2, receipt, null, false, 2),
        DiscoveryCandidate(3, screen, null, false, 3),
        DiscoveryCandidate(4, photo, "2026-11-02", false, 4),
        DiscoveryCandidate(5, photo, null, true, 5),
    )
    val feedback = listOf(DiscoveryFeedback(photo, "kept"), DiscoveryFeedback(receipt, "archived"), DiscoveryFeedback(screen, "dismissed"))
    val picks = rankDiscoveries(candidates, feedback)
    check(picks.map { it.candidate.id } == listOf(1L, 2L, 3L, 4L, 5L))
    check(picks[0].reason.contains("forest") && picks[1].score < 0 && picks[2].score < 0)
    check(rankDiscoveries(candidates, emptyList()).first().candidate.id == 2L)

    val hour = 3_600_000L
    val stamps = listOf(TimelinePhotoStamp(1, hour), TimelinePhotoStamp(2, 2 * hour), TimelinePhotoStamp(3, 3 * hour),
        TimelinePhotoStamp(4, 4 * hour), TimelinePhotoStamp(5, 8 * hour))
    val vectors = FloatArray(stamps.size * EYE_EMBEDDING_DIMENSIONS)
    val matching = floatArrayOf(1f, .98f, .2f, 1f, 1f)
    for (index in stamps.indices) {
        val score = matching[index]
        vectors[index * EYE_EMBEDDING_DIMENSIONS] = score
        vectors[index * EYE_EMBEDDING_DIMENSIONS + 1] = kotlin.math.sqrt(1 - score * score)
    }
    val scenes = timelineSceneNeighbors(stamps, vectors, booleanArrayOf(true, true, true, false, true)) {}
    check(scenes[1L] == listOf("2"))
    check(scenes[2L] == listOf("5"))
    check(scenes[3L] == null && scenes[4L] == null)
    println("Daily feedback, exposure rotation, and stored scene embedding comparisons passed")
}
