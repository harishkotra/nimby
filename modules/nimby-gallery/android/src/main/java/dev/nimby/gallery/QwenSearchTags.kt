package dev.nimby.gallery

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

private val fence = Regex("^```(?:json)?\\s*([\\s\\S]*?)\\s*```$", RegexOption.IGNORE_CASE)
private val tagShape = Regex("[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}]*(?:[ -][\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}]*){0,3}")

internal fun normalizedQwenTags(unclean: List<String>): List<String> = unclean.asSequence().take(16)
    .map { it.trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ") }
    .filter { it.length in 2..48 && it.any(Char::isLetter) && tagShape.matches(it) }
    .distinct().take(8).toList()

internal fun readQwenTags(value: String?): List<String> = runCatching {
    val tags = JSONArray(value ?: "[]")
    normalizedQwenTags((0 until minOf(tags.length(), 16)).mapNotNull { tags.opt(it) as? String })
}.getOrDefault(emptyList())

internal fun parseQwenSearchTags(reply: String): List<String> = runCatching {
    val value = reply.trim()
    val tags = JSONObject(fence.matchEntire(value)?.groupValues?.get(1) ?: value).getJSONArray("tags")
    readQwenTags(tags.toString())
}.getOrDefault(emptyList())
