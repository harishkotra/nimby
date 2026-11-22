package dev.nimby.gallery

import java.text.Normalizer
import java.util.Locale

internal data class RecallMatch(val expression: String, val phrase: String, val terms: List<String>)

private val recallTerms = Regex("[\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M}]*")
private val recallFillers = setOf(
    "a", "about", "an", "and", "are", "find", "for", "from", "i", "in", "is", "looking", "me", "my",
    "of", "on", "or", "please", "show", "that", "the", "to", "with", "you"
)

internal fun recallMatch(query: String): RecallMatch? {
    val normalized = Normalizer.normalize(query.take(256), Normalizer.Form.NFKC).lowercase(Locale.ROOT)
    val terms = recallTerms.findAll(normalized).map { it.value }.filterNot { it in recallFillers }
        .distinct().take(16).toList()
    if (terms.isEmpty()) return null

    // Quoted tokenizer output contains no FTS syntax. A space between terms is implicit AND.
    return RecallMatch(terms.joinToString(" ") { "\"$it\"" }, terms.joinToString(" "), terms)
}

internal fun RecallMatch.matchesVisualTag(tag: String): Boolean {
    val normalized = Normalizer.normalize(tag, Normalizer.Form.NFKC).lowercase(Locale.ROOT)
    val words = recallTerms.findAll(normalized).map { it.value }.filterNot { it in recallFillers }.toList()
    return words.windowed(terms.size).any { it == terms }
}
