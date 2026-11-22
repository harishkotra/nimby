package dev.nimby.gallery

import android.content.Context
import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale
import kotlin.math.cos

internal data class RecallPlaceBounds(val south: Double, val west: Double, val north: Double, val east: Double)
internal data class RecallPlace(val name: String, val bounds: List<RecallPlaceBounds>)

internal class RecallPlaces(context: Context) {
    private val index by lazy {
        val json = context.assets.open("photo-map/recall-places.json").bufferedReader().use { JSONObject(it.readText()) }
        json.keys().asSequence().groupBy { normalize(it) }.mapValues { (_, names) ->
            RecallPlace(names.first(), names.flatMap { name ->
                val centers = json.getJSONArray(name)
                List(centers.length()) { index ->
                    val point = centers.getJSONArray(index)
                    near(point.getDouble(0), point.getDouble(1))
                }
            }.distinct())
        }
    }

    fun find(value: String): RecallPlace? = index[normalize(value)]

    private fun normalize(value: String) = Normalizer.normalize(value.trim(), Normalizer.Form.NFC)
        .lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")

    private fun near(latitude: Double, longitude: Double): RecallPlaceBounds {
        val latitudeDelta = 0.24
        val longitudeDelta = latitudeDelta / cos(Math.toRadians(latitude)).coerceAtLeast(0.1)
        fun wrap(value: Double) = (value + 540) % 360 - 180
        return RecallPlaceBounds((latitude - latitudeDelta).coerceAtLeast(-90.0), wrap(longitude - longitudeDelta),
            (latitude + latitudeDelta).coerceAtMost(90.0), wrap(longitude + longitudeDelta))
    }
}
