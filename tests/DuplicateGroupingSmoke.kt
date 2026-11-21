package dev.nimby.gallery

fun main() {
    val exact = listOf(
        DuplicatePhoto(1, "original-a", "Camera A", "Camera", 400, 0.8, 0.7),
        DuplicatePhoto(1, "copy-a", "Copy A", "Downloads", 400, 0.8, 0.7),
    )
    check(groupDuplicatePhotos(exact, emptyList()).single().similarity == null)
    val visual = DuplicatePhoto(2, "original-b", "Camera B", "Camera", 600, 0.91, 0.72)
    val independent = DuplicatePhoto(3, "original-c", "Camera C", "Camera", 700, null, null)
    val combined = groupDuplicatePhotos(exact + visual + independent, listOf(EyeMatch(1, 2, 0.98), EyeMatch(1, 50, 0.99)))
    val group = combined.single()
    check(group.similarity == 0.98)
    check(group.photos.first() == visual)
    check(group.photos.map { it.uri }.toSet().size == 3)
    check(group.photos.drop(1).sumOf { it.bytes } == 800L)
    check(groupDuplicatePhotos(listOf(visual, independent), listOf(EyeMatch(1, 2, 0.98))).isEmpty())
    println("Exact copies, Eye links, keeper ranking, unavailable sources, and alternative byte totals passed")
}
