package dev.nimby.gallery

import android.database.sqlite.SQLiteDatabase
import android.net.Uri

internal data class MapPhoto(
    val id: String, val uri: String, val name: String, val album: String,
    val lat: Double, val lon: Double, val captured: Long?
)

internal data class PendingOcr(val id: Long, val fingerprint: String)
internal data class PendingLocation(val uri: Uri, val version: String, val after: Long)

internal const val OCR_ELIGIBLE = """(images.kind IN ('screenshot','receipt','document','whiteboard') OR
    images.category IN ('Screenshots','Receipts','Documents','Notes and whiteboards'))"""

internal fun createMemorySchema(db: SQLiteDatabase) {
    db.execSQL("""CREATE TABLE memory_details (
        image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
        ocr_text TEXT, place TEXT
    )""")
    db.execSQL("""CREATE TABLE photo_locations (
        uri TEXT PRIMARY KEY REFERENCES sources(uri) ON DELETE CASCADE,
        version TEXT NOT NULL,
        latitude REAL, longitude REAL,
        CHECK ((latitude IS NULL AND longitude IS NULL) OR
            (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90
                AND longitude BETWEEN -180 AND 180))
    )""")
    db.execSQL("CREATE INDEX photo_location_range ON photo_locations(latitude, longitude)")
    db.execSQL("""CREATE VIRTUAL TABLE memory_search USING fts4(
        labels, text, place, collection, tokenize=unicode61, prefix='2,3'
    )""")
    val insert = """INSERT INTO memory_search(docid, labels, text, place, collection)
        SELECT images.id, replace(COALESCE(images.kind, '') || ' ' || COALESCE(images.category, '') ||
            ' ' || COALESCE(images.tags, ''), '_', ' '), COALESCE(details.ocr_text, ''),
            COALESCE(details.place, ''), COALESCE(images.collection, '')
        FROM images LEFT JOIN memory_details details ON details.image_id = images.id
        WHERE images.status = 'complete'"""
    db.execSQL(insert)
    db.execSQL("""CREATE TRIGGER memory_image_insert AFTER INSERT ON images
        BEGIN $insert AND images.id = NEW.id; END""")
    db.execSQL("""CREATE TRIGGER memory_image_update AFTER UPDATE OF status, kind, category, tags, collection ON images
        BEGIN
            DELETE FROM memory_search WHERE docid = NEW.id;
            $insert AND images.id = NEW.id;
        END""")
    db.execSQL("""CREATE TRIGGER memory_image_delete AFTER DELETE ON images
        BEGIN DELETE FROM memory_search WHERE docid = OLD.id; END""")
    for (action in listOf("INSERT", "UPDATE", "DELETE")) {
        val row = if (action == "DELETE") "OLD" else "NEW"
        db.execSQL("""CREATE TRIGGER memory_details_${action.lowercase()} AFTER $action ON memory_details
            BEGIN
                DELETE FROM memory_search WHERE docid = $row.image_id;
                $insert AND images.id = $row.image_id;
            END""")
    }
}
