package dev.nimby.gallery

internal data class DuplicatePhoto(val image: Long, val uri: String, val name: String, val album: String,
    val bytes: Long, val keeper: Double?, val aesthetic: Double?) {
    fun bridge() = mapOf("uri" to uri, "imageId" to image.toString(), "name" to name, "album" to album,
        "bytes" to bytes, "keeper" to keeper, "aesthetic" to aesthetic)
}
internal data class DuplicateGroup(val photos: List<DuplicatePhoto>, val similarity: Double?) {
    fun bridge() = mapOf("id" to photos.first().uri, "photos" to photos.map { it.bridge() }, "similarity" to similarity)
}

internal data class EyeMatch(val left: Long, val right: Long, val similarity: Double)

internal fun groupDuplicatePhotos(photos: List<DuplicatePhoto>, matches: List<EyeMatch>): List<DuplicateGroup> {
    val parent = photos.associate { it.image to it.image }.toMutableMap()
    fun root(image: Long): Long {
        var cursor = image
        while (parent.getValue(cursor) != cursor) cursor = parent.getValue(cursor)
        var previous = image
        while (previous != cursor) {
            val next = parent.getValue(previous)
            parent[previous] = cursor
            previous = next
        }
        return cursor
    }

    val availableMatches = matches.filter { it.left in parent && it.right in parent }
    availableMatches.forEach { match ->
        val left = root(match.left)
        val right = root(match.right)
        if (left != right) parent[maxOf(left, right)] = minOf(left, right)
    }
    val similarity = mutableMapOf<Long, Double>()
    availableMatches.forEach { match -> similarity.merge(root(match.left), match.similarity, ::maxOf) }
    val rank = compareByDescending<DuplicatePhoto> { it.keeper ?: -1.0 }
        .thenByDescending { it.aesthetic ?: -1.0 }.thenByDescending { it.bytes }.thenBy { it.uri }
    return photos.groupBy { root(it.image) }.entries.filter { it.value.size > 1 }.map { (group, members) ->
        DuplicateGroup(members.sortedWith(rank), similarity[group])
    }.sortedBy { it.photos.first().uri }
}
