package dev.nimby.gallery

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

internal class RecallSearchOptions : Record {
    @Field var terms: String = ""
    @Field var category: String? = null
    @Field var start: Long? = null
    @Field var end: Long? = null
    @Field var month: Int? = null
    @Field var place: String? = null
    @Field var placeHint: RecallPlaceHint? = null
    @Field var textOnly: Boolean = false
    @Field var source: String? = null
}

internal class RecallPlaceHint : Record {
    @Field var name: String = ""
    @Field var terms: String = ""
}

internal class VisualSearchOptions : Record {
    @Field var start: Long? = null
    @Field var end: Long? = null
    @Field var month: Int? = null
    @Field var place: String? = null
    @Field var source: String? = null
}
