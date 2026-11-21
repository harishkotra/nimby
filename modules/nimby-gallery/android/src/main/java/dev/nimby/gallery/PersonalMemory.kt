package dev.nimby.gallery

import android.content.Context

internal class PersonalMemory(context: Context, private val memory: GalleryMemory) {
    private val preferences = context.getSharedPreferences("nimby-personal-memory", Context.MODE_PRIVATE)

    private val sections = setOf("connect", "patterns", "evolve")

    fun read(section: String): String? {
        require(section in sections)
        return preferences.getString(section, null)
    }

    fun save(section: String, data: String?) {
        require(section in sections)
        require(data == null || data.length <= 750_000) { "This list is too large to save." }
        check(preferences.edit().putString(section, data).commit()) { "Nimby could not save your changes." }
    }

    fun clear() {
        check(preferences.edit().clear().commit()) { "Nimby could not clear the saved feedback." }
    }

    fun candidates(start: Long, end: Long, includeLocations: Boolean): Map<String, Any?> {
        require(start < end)
        val hits = mutableListOf<Map<*, *>>()
        var offset = 0
        var more = false
        do {
            val page = memory.searchMemory("", null, start, end, null, null, false, offset)
            val items = (page["items"] as? List<*>)?.filterIsInstance<Map<*, *>>().orEmpty()
            val remaining = MAX_ITEMS - hits.size
            hits.addAll(items.take(remaining))
            val next = (page["next"] as? Number)?.toInt()
            more = next != null || items.size > remaining
            if (next == null || next <= offset) break
            offset = next
        } while (hits.size < MAX_ITEMS)
        val ids = hits.mapNotNull { (it["photo"] as? Map<*, *>)?.get("id") as? String }.distinct()
        val sources = hits.mapNotNull { (it["photo"] as? Map<*, *>)?.get("sourceKey") as? String }.distinct()
        val links = if (ids.isEmpty()) emptyMap() else links(ids)
        val locations = if (!includeLocations || sources.isEmpty()) emptyMap() else locations(sources)
        val items = hits.mapNotNull { item ->
            val photo = item["photo"] as? Map<*, *> ?: return@mapNotNull null
            val id = photo["id"] as? String ?: return@mapNotNull null
            val date = item["captured"] as? Number ?: return@mapNotNull null
            val gps = locations[photo["sourceKey"]]
            mapOf("photo" to photo, "captured" to date, "place" to item["place"],
                "lat" to gps?.first, "lon" to gps?.second, "related" to links[id].orEmpty(),
                "aesthetic" to item["aesthetic"], "keeper" to item["keeper"])
        }
        return mapOf("items" to items, "truncated" to more)
    }

    private fun links(ids: List<String>): Map<String, List<String>> {
        val slots = ids.joinToString(",") { "?" }
        return memory.readableDatabase.rawQuery(
            "SELECT left_id, right_id FROM near_matches WHERE left_id IN ($slots) AND right_id IN ($slots)",
            (ids + ids).toTypedArray()
        ).use { cursor ->
            val matches = mutableMapOf<String, MutableList<String>>()
            while (cursor.moveToNext()) {
                val left = cursor.getString(0)
                val right = cursor.getString(1)
                matches.getOrPut(left) { mutableListOf() }.add(right)
                matches.getOrPut(right) { mutableListOf() }.add(left)
            }
            matches
        }
    }

    private fun locations(sources: List<String>): Map<String, Pair<Double, Double>> {
        val slots = sources.joinToString(",") { "?" }
        return memory.readableDatabase.rawQuery(
            """SELECT g.uri, g.latitude, g.longitude FROM photo_locations g
                JOIN sources s ON s.uri=g.uri AND s.version=g.version
                WHERE g.uri IN ($slots) AND g.latitude IS NOT NULL AND g.longitude IS NOT NULL""",
            sources.toTypedArray()
        ).use { cursor ->
            buildMap {
                while (cursor.moveToNext()) put(cursor.getString(0), cursor.getDouble(1) to cursor.getDouble(2))
            }
        }
    }

    private companion object { const val MAX_ITEMS = 240 }
}
