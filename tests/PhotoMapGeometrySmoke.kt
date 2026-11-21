package dev.nimby.gallery

internal fun main() {
    val aroundDateLine = PhotoMapClusterer(4.0)
    aroundDateLine.add(10.0, 179.8)
    aroundDateLine.add(10.0, -179.7)
    val dateLine = aroundDateLine.result()
    check(dateLine.total == 2)
    check(dateLine.clusters.single().count == 2)
    check(kotlin.math.abs(dateLine.clusters.single().lon) > 179)
    val bounds = checkNotNull(dateLine.bounds)
    check(bounds.south == 10.0 && bounds.north == 10.0)
    check(kotlin.math.abs(bounds.west - 179.8) < 1e-8)
    check(kotlin.math.abs(bounds.east + 179.7) < 1e-8)

    val globe = PhotoMapClusterer(2.0)
    repeat(10000) { globe.add(55.6, 12.6) }
    globe.add(-33.9, 151.2)
    val clustered = globe.result()
    check(clustered.clusters.size == 2)
    check(clustered.clusters.sumOf { it.count } == 10001)
    check(clustered.bounds?.south == -33.9)
    check(PhotoMapClusterer(0.0).result().bounds == null)
    check(normalizeMapLongitude(184.0) == -176.0)
    check(runCatching { MapViewport(95.0, 0.0, 45.0, 90.0) }.isFailure)
}
