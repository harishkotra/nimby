package dev.nimby.gallery

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

internal data class MapViewport(val south: Double, val west: Double, val north: Double, val east: Double) {
    init {
        require(south in -90.0..90.0 && north in south..90.0 && west in -180.0..180.0 && east in -180.0..180.0) {
            "Invalid photo map bounds"
        }
    }

    fun bridge() = mapOf("south" to south, "west" to west, "north" to north, "east" to east)
}

internal fun normalizeMapLongitude(longitude: Double): Double =
    ((longitude + 180) % 360 + 360) % 360 - 180

internal fun mapCellId(latitude: Double, longitude: Double, zoom: Double): String {
    val level = floor(if (zoom.isFinite()) zoom else 0.0).toInt().coerceIn(0, 7) + 2
    val columns = 1 shl level
    val step = 360.0 / columns
    // Half a cell straddles the date line, so nearby photos on either side may cluster together.
    val col = floor((normalizeMapLongitude(longitude) + 180 + step / 2) / step).toInt() % columns
    val row = floor((latitude + 90) / step).toInt().coerceAtMost(columns / 2 - 1)
    return "$level:$col:$row"
}

internal class PhotoMapCoordinates {
    private val longitudes = mutableListOf<Double>()
    private var south = 90.0
    private var north = -90.0

    fun add(lat: Double, lon: Double) {
        south = minOf(south, lat)
        north = maxOf(north, lat)
        longitudes.add(normalizeMapLongitude(lon))
    }

    fun fit(): MapViewport? {
        if (longitudes.isEmpty()) return null
        longitudes.sort()
        // Largest gap on the longitude circle lies outside the shortest bound containing every point.
        var largest = longitudes.first() + 360 - longitudes.last()
        var west = longitudes.first()
        var east = longitudes.last()
        for (i in 1 until longitudes.size) {
            val gap = longitudes[i] - longitudes[i - 1]
            if (gap > largest) {
                largest = gap
                west = longitudes[i]
                east = longitudes[i - 1]
            }
        }
        return MapViewport(south, west, north, east)
    }
}

internal data class PhotoMapCluster(val id: String, val count: Int, val lat: Double, val lon: Double) {
    fun bridge() = mapOf("id" to id, "count" to count, "lat" to lat, "lon" to lon)
}

internal class PhotoMapClusterer(private val zoom: Double) {
    private class Cell(var count: Int = 0, var latitudeSum: Double = 0.0, var x: Double = 0.0, var y: Double = 0.0)
    private val cells = mutableMapOf<String, Cell>()
    private val coordinates = PhotoMapCoordinates()
    private var total = 0

    fun add(lat: Double, lon: Double) {
        val id = mapCellId(lat, lon, zoom)
        val cell = cells.getOrPut(id) { Cell() }
        cell.count++
        cell.latitudeSum += lat
        cell.x += cos(Math.toRadians(lon))
        cell.y += sin(Math.toRadians(lon))
        total++
        coordinates.add(lat, lon)
    }

    fun result(): PhotoMapClusters = PhotoMapClusters(cells.map { (id, cell) ->
        PhotoMapCluster(id, cell.count, cell.latitudeSum / cell.count, Math.toDegrees(atan2(cell.y, cell.x)))
    }, total, coordinates.fit())
}

internal data class PhotoMapClusters(val clusters: List<PhotoMapCluster>, val total: Int, val bounds: MapViewport?) {
    fun bridge() = mapOf("clusters" to clusters.map { it.bridge() }, "total" to total, "bounds" to bounds?.bridge())
}
