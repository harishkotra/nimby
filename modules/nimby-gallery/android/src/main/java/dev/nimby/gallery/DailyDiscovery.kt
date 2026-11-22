package dev.nimby.gallery

internal data class DiscoveryTraits(val category: String, val topics: List<String>)
internal data class DiscoveryFeedback(val traits: DiscoveryTraits, val decision: String)

internal data class DiscoveryCandidate(val id: Long, val traits: DiscoveryTraits, val lastShown: String?,
    val lowQuality: Boolean, val analyzed: Long)

internal data class DiscoveryRank(val candidate: DiscoveryCandidate, val score: Int, val reason: String)

internal fun rankDiscoveries(candidates: List<DiscoveryCandidate>, feedback: List<DiscoveryFeedback>): List<DiscoveryRank> {
    val categories = mutableMapOf<String, Int>()
    val topics = mutableMapOf<String, Int>()
    for ((traits, decision) in feedback) {
        val weight = when (decision) {
            "kept" -> 3
            "dismissed" -> -4
            "archived" -> -2
            else -> continue
        }
        categories.merge(traits.category, weight, Int::plus)
        traits.topics.distinct().forEach { topics.merge(it, weight, Int::plus) }
    }
    return candidates.map { candidate ->
        val category = (categories[candidate.traits.category] ?: 0).coerceIn(-12, 12)
        val signals = candidate.traits.topics.map { it to (topics[it] ?: 0).coerceIn(-10, 10) }
        val strongest = signals.maxByOrNull { it.second }
        val topicScore = signals.sumOf { it.second }.coerceIn(-16, 16)
        val reason = when {
            strongest != null && strongest.second > 0 && topicScore > 0 -> "Related to photos you kept tagged “${strongest.first}”"
            category > 0 -> "Related to ${candidate.traits.category.lowercase()} you kept"
            else -> "From your scanned gallery"
        }
        val generic = if (candidate.traits.category == "Screenshots") -4 else 0
        DiscoveryRank(candidate, category + topicScore + generic, reason)
    }.sortedWith(compareBy<DiscoveryRank> { it.candidate.lowQuality }
        .thenBy { it.candidate.lastShown }
        .thenByDescending { it.score }
        .thenByDescending { it.candidate.analyzed }
        .thenByDescending { it.candidate.id })
}
