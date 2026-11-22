package dev.nimby.gallery

fun main() {
    check(recallMatch("Show me my electricity bill") == RecallMatch(
        "\"electricity\" \"bill\"", "electricity bill", listOf("electricity", "bill")
    ))
    check(recallMatch("A AND OR ?") == null)
    check(recallMatch("ACME ) OR neAr(42)/ *")?.expression == "\"acme\" \"near\" \"42\"")
    check(recallMatch("ＣＡＦＥ́ 東京")?.terms == listOf("café", "東京"))
    check(recallMatch((1..60).joinToString(" ") { "word$it" })?.terms?.size == 16)
    val coast = checkNotNull(recallMatch("coastal walk"))
    check(coast.matchesVisualTag("bright Coastal_Walk by the sea"))
    check(!coast.matchesVisualTag("coastal village and long walk"))
    check(!checkNotNull(recallMatch("art")).matchesVisualTag("apartment"))
}
