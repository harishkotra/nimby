package dev.nimby.gallery

fun main() {
    check(recallMatch("Show me my electricity bill") == RecallMatch(
        "\"electricity\" \"bill\"", "electricity bill", listOf("electricity", "bill")
    ))
    check(recallMatch("A AND OR ?") == null)
    check(recallMatch("ACME ) OR neAr(42)/ *")?.expression == "\"acme\" \"near\" \"42\"")
    check(recallMatch("ＣＡＦＥ́ 東京")?.terms == listOf("café", "東京"))
    check(recallMatch((1..60).joinToString(" ") { "word$it" })?.terms?.size == 16)
}
