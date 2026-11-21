package dev.nimby.gallery

internal fun photoMapClusters(memory: GalleryMemory, bounds: MapViewport, zoom: Double, start: Long?, end: Long?): PhotoMapClusters {
    val clusterer = PhotoMapClusterer(zoom)
    memory.forEachMapPhoto(bounds.south, bounds.west, bounds.north, bounds.east, start, end) { photo ->
        clusterer.add(photo.lat, photo.lon)
        true
    }
    return clusterer.result()
}

internal data class PhotoMapPage(val photos: List<Map<String, Any?>>, val nextOffset: Int?) {
    fun bridge() = mapOf("photos" to photos, "nextOffset" to nextOffset)
}

internal fun photoMapPage(memory: GalleryMemory, bounds: MapViewport, zoom: Double, start: Long?, end: Long?,
                          clusterId: String?, offset: Int): PhotoMapPage {
    require(offset >= 0) { "Invalid photo map page" }
    if (clusterId != null) require(clusterId.matches(Regex("[0-9]+:[0-9]+:[0-9]+"))) { "Invalid photo map cluster" }
    val page = mutableListOf<Map<String, Any?>>()
    var skipped = 0
    var next: Int? = null
    val pageSize = 30
    memory.forEachMapPhoto(bounds.south, bounds.west, bounds.north, bounds.east, start, end) { photo ->
        if (clusterId != null && mapCellId(photo.lat, photo.lon, zoom) != clusterId) return@forEachMapPhoto true
        if (skipped < offset) {
            skipped++
            return@forEachMapPhoto true
        }
        if (page.size >= pageSize) {
            next = skipped
            return@forEachMapPhoto false
        }
        memory.mapPhotoResult(photo)?.let { page.add(it + ("captured" to photo.captured)) }
        skipped++
        true
    }
    return PhotoMapPage(page, next)
}
