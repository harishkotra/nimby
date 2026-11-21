package dev.nimby.gallery

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.Uri
import android.os.Build
import kotlinx.coroutines.ensureActive
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.PriorityQueue
import kotlin.math.sqrt

internal data class Analysis(
    val json: String, val kind: String?, val confidence: Double?, val tags: JSONArray,
    val category: String?, val embedding: FloatArray
)

internal const val ARCHIVE_WAIT_MS = 30L * 24 * 60 * 60 * 1_000
internal fun lowQuality(tags: JSONObject?): Boolean =
    listOf("unusable", "technical_flaw", "blurry").any { (tags?.optDouble(it) ?: 0.0) >= 0.9 }
internal data class ArchivedPhoto(val uri: String, val name: String, val album: String,
    val bytes: Long, val version: String, val archived: Long, val eligible: Long)
internal class GalleryMemory(context: Context, private val gallery: GallerySource) :
    SQLiteOpenHelper(context, "nimby-gallery.db", null, 6) {

    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE images (
                id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending', error TEXT,
                engine TEXT, result TEXT, kind TEXT, confidence REAL, tags TEXT,
                category TEXT, embedding BLOB, analyzed INTEGER NOT NULL DEFAULT 0,
                decision TEXT NOT NULL DEFAULT 'new', collection TEXT
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE sources (
                uri TEXT PRIMARY KEY, image_id INTEGER REFERENCES images(id), name TEXT NOT NULL,
                album TEXT NOT NULL, bucket TEXT NOT NULL, source TEXT NOT NULL, media_id INTEGER NOT NULL,
                captured INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
                bytes INTEGER NOT NULL, modified INTEGER NOT NULL, version TEXT NOT NULL, error TEXT
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX image_sources ON sources(image_id)")
        db.execSQL("CREATE INDEX image_feed ON images(status, analyzed DESC, id DESC)")
        db.execSQL("CREATE INDEX image_collections ON images(decision, collection)")
        createSettingsTables(db)
        createArchiveTables(db)
        addInsightColumns(db)
        addScanScope(db)
        createScanResults(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) createSettingsTables(db)
        if (oldVersion < 3) createArchiveTables(db)
        if (oldVersion < 4) {
            addInsightColumns(db)
            var after = 0L
            while (true) {
                val rows = db.rawQuery("SELECT id, result FROM images WHERE id > ? AND status = 'complete' ORDER BY id LIMIT 100",
                    arrayOf(after.toString())).use { row ->
                    buildList { while (row.moveToNext()) add(row.getLong(0) to row.getString(1)) }
                }
                if (rows.isEmpty()) break
                rows.forEach { (id, result) ->
                    val json = result?.let { runCatching { JSONObject(it) }.getOrNull() }
                    val scores = json?.optJSONObject("scores")
                    db.update("images", ContentValues().apply {
                        put("low_quality", if (lowQuality(json?.optJSONObject("tags"))) 1 else 0)
                        put("keeper", scores?.optDouble("keeper")?.takeIf { it in 0.0..1.0 })
                        put("aesthetic", scores?.optDouble("aesthetic")?.takeIf { it in 0.0..1.0 })
                    }, "id = ?", arrayOf(id.toString()))
                }
                after = rows.last().first
            }
        }
        if (oldVersion < 5) addScanScope(db)
        if (oldVersion < 6) createScanResults(db)
    }

    private fun createScanResults(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE scan_results (
            scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
            uri TEXT NOT NULL, image_id INTEGER NOT NULL,
            PRIMARY KEY(scan_id, uri)
        )""")
    }

    private fun addScanScope(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE scans ADD COLUMN scope TEXT")
    }

    private fun addInsightColumns(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE images ADD COLUMN low_quality INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE images ADD COLUMN keeper REAL")
        db.execSQL("ALTER TABLE images ADD COLUMN aesthetic REAL")
        db.execSQL("CREATE INDEX source_capture ON sources(captured)")
        db.execSQL("""CREATE TABLE near_matches (left_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
            right_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE, similarity REAL NOT NULL,
            PRIMARY KEY (left_id, right_id))""")
        db.execSQL("ALTER TABLE images ADD COLUMN linked INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE archive ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0")
    }

    private fun createArchiveTables(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE archive (uri TEXT PRIMARY KEY, name TEXT NOT NULL, album TEXT NOT NULL,
            bytes INTEGER NOT NULL, version TEXT NOT NULL, archived INTEGER NOT NULL, eligible INTEGER NOT NULL)""")
        db.execSQL("CREATE INDEX archive_date ON archive(archived DESC)")
        db.execSQL("""CREATE TABLE confirmed_deletions (id INTEGER PRIMARY KEY, uri TEXT NOT NULL,
            bytes INTEGER NOT NULL, finished INTEGER NOT NULL)""")
    }

    private val visible = """EXISTS (SELECT 1 FROM sources s WHERE s.image_id = images.id
        AND NOT EXISTS (SELECT 1 FROM archive a WHERE a.uri = s.uri))""".trimIndent()

    fun archive(uris: List<String>): Int {
        require(uris.size in 1..200)
        val photos = uris.distinct().map { gallery.chosen(Uri.parse(it)) }
        val now = System.currentTimeMillis()
        val db = writableDatabase
        db.beginTransaction()
        try {
            val added = photos.count { photo ->
                db.insertWithOnConflict("archive", null, ContentValues().apply {
                    put("uri", photo.uri.toString())
                    put("name", photo.name)
                    put("album", photo.album)
                    put("bytes", photo.bytes.coerceAtLeast(0))
                    put("version", photo.version)
                    put("archived", now)
                    put("eligible", now + ARCHIVE_WAIT_MS)
                }, SQLiteDatabase.CONFLICT_IGNORE) != -1L
            }
            db.setTransactionSuccessful()
            return added
        } finally { db.endTransaction() }
    }

    private fun archiveRows(selection: String?, args: Array<String>?, limit: String?) =
        readableDatabase.query("archive", arrayOf("uri", "name", "album", "bytes", "version", "archived", "eligible"),
            selection, args, null, null, "archived DESC, uri", limit).use { row ->
            buildList {
                while (row.moveToNext()) add(ArchivedPhoto(row.getString(0), row.getString(1), row.getString(2),
                    row.getLong(3), row.getString(4), row.getLong(5), row.getLong(6)))
            }
        }

    fun isArchived(uri: String): Boolean = readableDatabase.rawQuery("SELECT 1 FROM archive WHERE uri = ?", arrayOf(uri))
        .use { it.moveToFirst() }

    fun archivedUris(): Set<String> = readableDatabase.rawQuery("SELECT uri FROM archive", null).use { row ->
        buildSet { while (row.moveToNext()) add(row.getString(0)) }
    }

    fun archivePage(offset: Int): List<Map<String, Any?>> = archiveRows(null, null, "40 OFFSET $offset").map { photo ->
        val readable = gallery.readable(Uri.parse(photo.uri))
        mapOf("id" to photo.uri, "uri" to photo.uri.takeIf { readable }, "name" to photo.name, "album" to photo.album,
            "bytes" to photo.bytes, "archived" to photo.archived, "eligible" to photo.eligible,
            "canDelete" to (readable && Build.VERSION.SDK_INT >= 30 && photo.version.isNotEmpty()
                && photo.eligible <= System.currentTimeMillis()))
    }

    fun restore(uris: List<String>): Int {
        require(uris.size in 1..200)
        return writableDatabase.delete("archive", "uri IN (${uris.joinToString(",") { "?" }})", uris.toTypedArray())
    }

    fun markReviewed(uris: List<String>) {
        require(uris.size in 1..50)
        writableDatabase.execSQL("UPDATE archive SET reviewed=1 WHERE eligible <= ? AND version != '' AND uri IN (${uris.joinToString(",") { "?" }})",
            arrayOf<Any>(System.currentTimeMillis(), *uris.toTypedArray()))
    }

    fun duplicateGroups(): List<DuplicateGroup> {
        val db = readableDatabase
        val photos = db.rawQuery("""
            SELECT s.image_id, s.uri, s.name, s.album, s.bytes, i.keeper, i.aesthetic, s.version, s.source
            FROM sources s JOIN images i ON s.image_id=i.id
            WHERE (s.source='gallery' OR (s.source='picker' AND NOT EXISTS (
                SELECT 1 FROM sources g WHERE g.image_id=s.image_id AND g.source='gallery'
            ) AND s.uri=(SELECT MIN(p.uri) FROM sources p WHERE p.image_id=s.image_id AND p.source='picker'
                AND NOT EXISTS (SELECT 1 FROM archive a WHERE a.uri=p.uri)))) AND s.image_id IN (
                SELECT image_id FROM sources WHERE source='gallery' AND image_id IS NOT NULL GROUP BY image_id HAVING COUNT(*) > 1
                UNION SELECT left_id FROM near_matches
                UNION SELECT right_id FROM near_matches
            ) AND NOT EXISTS (SELECT 1 FROM archive a WHERE a.uri=s.uri)
        """.trimIndent(), null).use { row ->
            buildList {
                while (row.moveToNext()) {
                    val uri = row.getString(1)
                    val local = row.getString(8) == "gallery"
                    val readable = if (local) {
                        val current = runCatching { gallery.chosen(Uri.parse(uri)) }.getOrNull()
                        current?.version == row.getString(7)
                    } else gallery.readable(Uri.parse(uri))
                    if (readable) add(DuplicatePhoto(row.getLong(0), uri, row.getString(2),
                        row.getString(3), row.getLong(4).takeIf { local } ?: 0L, row.getDouble(5).takeUnless { row.isNull(5) },
                        row.getDouble(6).takeUnless { row.isNull(6) }))
                }
            }
        }
        val matches = db.rawQuery("SELECT left_id, right_id, similarity FROM near_matches", null).use { row ->
            buildList {
                while (row.moveToNext()) add(EyeMatch(row.getLong(0), row.getLong(1), row.getDouble(2)))
            }
        }
        return groupDuplicatePhotos(photos, matches)
    }

    suspend fun refreshDuplicateLinks() {
        while (true) {
            kotlinx.coroutines.currentCoroutineContext().ensureActive()
            val ids = readableDatabase.rawQuery("""SELECT id FROM images
                WHERE linked=0 AND status='complete' AND embedding IS NOT NULL ORDER BY id LIMIT 32""", null).use { row ->
                buildList { while (row.moveToNext()) add(row.getLong(0)) }
            }
            if (ids.isEmpty()) return
            ids.forEach { id ->
                kotlinx.coroutines.currentCoroutineContext().ensureActive()
                linkImage(id)
            }
        }
    }

    @Synchronized
    private fun linkImage(id: Long) {
        val db = writableDatabase
        val original = db.rawQuery("""SELECT embedding, result, engine, COALESCE(
            (SELECT MAX(captured) FROM sources WHERE image_id=images.id AND source='gallery'), 0)
            FROM images WHERE id=? AND linked=0 AND status='complete' AND embedding IS NOT NULL""",
            arrayOf(id.toString())).use { row ->
            if (!row.moveToFirst()) return
            LinkInput(vector(row.getBlob(0)), row.getString(1), row.getString(2), row.getLong(3))
        }
        val rule = runCatching { JSONObject(original.result).optJSONObject("duplicates") }.getOrNull()
        val seconds = rule?.optDouble("window_seconds")?.takeIf { it in 1.0..120.0 } ?: 30.0
        val threshold = rule?.optDouble("similarity")?.takeIf { it in 0.0..1.0 } ?: 0.97
        val window = (seconds * 1_000).toLong()
        val matches = mutableMapOf<Long, Double>()
        fun compare(query: String, args: Array<String>, cutoff: Double) {
            db.rawQuery(query, args).use { row ->
                while (row.moveToNext()) {
                    val score = cosine(original.vector, vector(row.getBlob(1)))
                    if (score >= cutoff) matches.merge(row.getLong(0), score, ::maxOf)
                }
            }
        }
        if (original.captured > 0) {
            compare("""SELECT DISTINCT i.id, i.embedding FROM sources s JOIN images i ON i.id=s.image_id
                WHERE i.id != ? AND i.engine = ? AND i.status='complete' AND i.embedding IS NOT NULL
                AND s.source='gallery' AND s.captured BETWEEN ? AND ? LIMIT 96""",
                arrayOf(id.toString(), original.engine, (original.captured - window).toString(), (original.captured + window).toString()),
                threshold)
        }
        compare("""SELECT id, embedding FROM images WHERE id != ? AND engine = ? AND status='complete'
            AND embedding IS NOT NULL ORDER BY analyzed DESC, id DESC LIMIT 48""",
            arrayOf(id.toString(), original.engine), maxOf(0.97, threshold))
        db.beginTransaction()
        try {
            if (db.update("images", ContentValues().apply { put("linked", 1) },
                "id = ? AND status = 'complete' AND engine = ?", arrayOf(id.toString(), original.engine)) > 0) {
                matches.entries.sortedByDescending { it.value }.take(3).forEach { (match, score) ->
                    db.execSQL("""INSERT OR IGNORE INTO near_matches(left_id, right_id, similarity)
                        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM images WHERE id = ? AND status='complete' AND engine=?)""",
                        arrayOf<Any>(minOf(id, match), maxOf(id, match), score, match, original.engine))
                }
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    private data class LinkInput(val vector: FloatArray, val result: String, val engine: String, val captured: Long)

    fun cachedPhotos(photos: List<Photo>): Set<String> {
        if (photos.isEmpty()) return emptySet()
        val versions = photos.associate { it.uri.toString() to it.version }
        val keys = versions.keys.joinToString(",") { "?" }
        return readableDatabase.rawQuery("""SELECT s.uri, s.version FROM sources s JOIN images i ON i.id=s.image_id
            WHERE i.status='complete' AND i.engine=? AND s.error IS NULL AND s.uri IN ($keys)""",
            arrayOf(EYE_VERSION, *versions.keys.toTypedArray())).use { row ->
            buildSet { while (row.moveToNext()) if (versions[row.getString(0)] == row.getString(1)) add(row.getString(0)) }
        }
    }

    fun overview(currentId: Long?): Map<String, Any?> {
        val db = readableDatabase
        val local = db.rawQuery("""SELECT COUNT(*), COALESCE(SUM(CASE WHEN decision='new' AND category IS NOT NULL
            AND $visible THEN 1 ELSE 0 END), 0)
            FROM images WHERE status='complete' AND EXISTS (SELECT 1 FROM sources s WHERE s.image_id=images.id)""", null).use { row ->
            row.moveToFirst(); row.getInt(0) to row.getInt(1)
        }
        val archiveStats = db.rawQuery("""SELECT COUNT(*), COALESCE(SUM(bytes),0), COALESCE(SUM(
            length(CAST(uri AS BLOB)) + length(CAST(name AS BLOB)) + length(CAST(album AS BLOB)) +
            length(CAST(version AS BLOB)) + 25),0) FROM archive""", null).use {
            it.moveToFirst(); Triple(it.getInt(0), it.getLong(1), it.getLong(2))
        }
        val reclaimed = db.rawQuery("SELECT COALESCE(SUM(bytes),0) FROM confirmed_deletions", null).use {
            it.moveToFirst(); it.getLong(0)
        }
        val reviewed = db.rawQuery("SELECT uri, version, bytes FROM archive WHERE reviewed=1 AND eligible <= ?",
            arrayOf(System.currentTimeMillis().toString())).use { row ->
            var bytes = 0L
            while (row.moveToNext()) {
                val photo = runCatching { gallery.chosen(Uri.parse(row.getString(0))) }.getOrNull()
                if (photo?.version == row.getString(1)) bytes += row.getLong(2)
            }
            bytes
        }
        val duplicates = duplicateGroups()
        val alternatives = duplicates.flatMap { it.photos.drop(1) }.associate { it.uri to it.bytes }
        val archived = archivedUris()
        var total = 0
        var analyzed = 0
        var screenshots = 0
        var knownSizes = 0
        var size = 0L
        var lowCount = 0
        var lowBytes = 0L
        var uniqueLowBytes = 0L
        val categories = mutableMapOf<String, Int>()
        var accessible = gallery.access() != "none"
        val batch = ArrayList<Photo>(160)
        fun measureBatch() {
            if (batch.isEmpty()) return
            val byUri = batch.associateBy { it.uri.toString() }
            val placeholders = batch.joinToString(",") { "?" }
            db.rawQuery("""SELECT s.uri, s.version, i.category, i.kind, i.low_quality FROM sources s
                JOIN images i ON s.image_id=i.id WHERE i.status='complete' AND s.uri IN ($placeholders)""",
                byUri.keys.toTypedArray()).use { row ->
                while (row.moveToNext()) {
                    val uri = row.getString(0)
                    val photo = byUri[uri] ?: continue
                    if (row.getString(1) != photo.version) continue
                    analyzed++
                    if (uri in archived) continue
                    if (row.getString(3) == "screenshot") screenshots++
                    row.getString(2)?.let { category -> categories.merge(category, 1, Int::plus) }
                    if (row.getInt(4) == 1) {
                        lowCount++
                        lowBytes += photo.bytes.coerceAtLeast(0)
                        if (uri !in alternatives) uniqueLowBytes += photo.bytes.coerceAtLeast(0)
                    }
                }
            }
            batch.clear()
        }
        if (accessible) {
            try {
                gallery.forEachPhoto {
                    total++
                    if (it.bytes > 0) { knownSizes++; size += it.bytes }
                    batch.add(it)
                    if (batch.size == 160) measureBatch()
                }
                measureBatch()
            } catch (_: SecurityException) { accessible = false }
            catch (_: java.io.IOException) { accessible = false }
        }
        val duplicateBytes = alternatives.values.sumOf { it.coerceAtLeast(0) }
        return mapOf("localAnalyzed" to local.first, "worth" to local.second, "archived" to archiveStats.first,
            "archivedOriginalBytes" to archiveStats.second, "archiveBytes" to 0,
            "archiveMetadataBytes" to archiveStats.third, "reclaimed" to reclaimed,
            "reviewedBytes" to reviewed, "duplicateGroups" to duplicates.size,
            "duplicateBytes" to duplicateBytes.takeIf { accessible || it > 0 },
            "accessible" to total.takeIf { accessible }, "analyzed" to analyzed.takeIf { accessible },
            "awaiting" to (total - analyzed).coerceAtLeast(0).takeIf { accessible },
            "screenshots" to screenshots.takeIf { accessible }, "lowQuality" to lowCount.takeIf { accessible },
            "galleryBytes" to size.takeIf { accessible && (knownSizes > 0 || total == 0) },
            "unknownSizes" to (total - knownSizes).takeIf { accessible }, "lowQualityBytes" to lowBytes.takeIf { accessible },
            "potentialBytes" to (duplicateBytes + if (accessible) uniqueLowBytes else 0).takeIf { accessible || it > 0 },
            "categories" to if (accessible) categories.entries.sortedByDescending { it.value }.map {
                mapOf("name" to it.key, "count" to it.value)
            } else emptyList(), "history" to scanHistory(currentId).take(5))
    }

    fun deletionCandidates(uris: List<String>): List<ArchivedPhoto> {
        require(Build.VERSION.SDK_INT >= 30) { "Nimby’s deletion review requires Android 11 or newer." }
        val unique = uris.distinct()
        require(unique.size in 1..50) { "Review up to 50 photos at a time." }
        val rows = archiveRows("uri IN (${unique.joinToString(",") { "?" }})", unique.toTypedArray(), null)
        check(rows.size == unique.size) { "The archive selection changed. Review it again." }
        val now = System.currentTimeMillis()
        return rows.map { item ->
            check(item.eligible <= now && item.version.isNotEmpty()) { "Only eligible Android gallery photos can be deleted here." }
            val current = gallery.chosen(Uri.parse(item.uri))
            check(current.source == "gallery" && current.version == item.version) {
                "An original changed since it was archived. Restore it and review it again."
            }
            item.copy(bytes = current.bytes.coerceAtLeast(0))
        }
    }

    fun recordConfirmedDeletion(items: List<ArchivedPhoto>): Int {
        val confirmed = items.filter { gallery.confirmAbsent(Uri.parse(it.uri)) }
        val db = writableDatabase
        db.beginTransaction()
        try {
            confirmed.forEach { item ->
                val key = arrayOf(item.uri, item.version)
                if (db.delete("archive", "uri = ? AND version = ?", key) > 0) {
                    db.delete("sources", "uri = ? AND version = ?", key)
                    db.insertOrThrow("confirmed_deletions", null, ContentValues().apply {
                        put("uri", item.uri)
                        put("bytes", item.bytes)
                        put("finished", System.currentTimeMillis())
                    })
                }
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        return confirmed.size
    }

    private fun createSettingsTables(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE scans (
            id INTEGER PRIMARY KEY, started INTEGER NOT NULL, finished INTEGER, phase TEXT NOT NULL,
            total INTEGER NOT NULL DEFAULT 0, analyzed INTEGER NOT NULL DEFAULT 0,
            cached INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0
        )""")
        db.execSQL("CREATE TABLE excluded_albums (bucket TEXT PRIMARY KEY, name TEXT NOT NULL)")
    }

    fun beginScan(buckets: List<String>, uris: List<String>): Long {
        val db = writableDatabase
        db.execSQL("UPDATE scans SET phase = 'interrupted' WHERE phase = 'running'")
        return db.insertOrThrow("scans", null, ContentValues().apply {
            put("started", System.currentTimeMillis())
            put("phase", "running")
            put("scope", JSONObject().put("albums", JSONArray(buckets)).put("uris", JSONArray(uris)).toString())
        })
    }

    fun interruptedScope(): Pair<List<String>, List<String>>? = readableDatabase.rawQuery("""
        SELECT scope, phase FROM scans ORDER BY id DESC LIMIT 1
    """.trimIndent(), null).use { row ->
        if (!row.moveToFirst() || row.isNull(0) || row.getString(1) !in setOf("running", "interrupted")) return@use null
        val scope = JSONObject(row.getString(0))
        fun items(key: String) = scope.getJSONArray(key).let { array -> List(array.length()) { array.getString(it) } }
        items("albums") to items("uris")
    }

    fun saveScan(id: Long, progress: ScanProgress, terminal: Boolean) {
        writableDatabase.update("scans", ContentValues().apply {
            put("total", progress.total)
            put("analyzed", progress.analyzed)
            put("cached", progress.cached)
            put("failed", progress.failed)
            if (terminal) {
                put("phase", progress.phase)
                put("finished", System.currentTimeMillis())
            }
        }, "id = ?", arrayOf(id.toString()))
    }

    fun recordScanResults(scanId: Long, uris: Collection<String>) {
        if (uris.isEmpty()) return
        val slots = uris.joinToString(",") { "?" }
        writableDatabase.execSQL(
            """INSERT OR REPLACE INTO scan_results(scan_id, uri, image_id)
                SELECT ?, uri, image_id FROM sources WHERE uri IN ($slots) AND image_id IS NOT NULL""",
            arrayOf(scanId.toString(), *uris.toTypedArray())
        )
    }

    fun scanHistory(currentId: Long?): List<Map<String, Any?>> = readableDatabase.rawQuery(
        """SELECT id, started, finished, phase, total, analyzed, cached, failed, scope IS NOT NULL,
            EXISTS (SELECT 1 FROM scan_results WHERE scan_id = scans.id)
            FROM scans ORDER BY id DESC LIMIT 20""", null
    ).use { row ->
        buildList {
            while (row.moveToNext()) {
                val id = row.getLong(0)
                val phase = row.getString(3)
                add(mapOf("id" to id.toString(), "started" to row.getLong(1),
                    "finished" to row.getLong(2).takeUnless { row.isNull(2) },
                    "phase" to (if (phase == "running" && id != currentId) "interrupted" else phase),
                    "total" to row.getInt(4), "analyzed" to row.getInt(5), "cached" to row.getInt(6), "failed" to row.getInt(7),
                    "resumable" to (id != currentId && phase in setOf("running", "interrupted") && row.getInt(8) == 1),
                    "hasResults" to (row.getInt(9) == 1)))
            }
        }
    }

    fun processing(currentId: Long?): Map<String, Any?> {
        val stats = readableDatabase.rawQuery("""
            SELECT COUNT(*), COALESCE(SUM(COALESCE(length(CAST(result AS BLOB)), 0) +
                COALESCE(length(CAST(tags AS BLOB)), 0) + COALESCE(length(embedding), 0)), 0) FROM images
        """.trimIndent(), null).use { row -> row.moveToFirst(); row.getLong(0) to row.getLong(1) }
        val last = readableDatabase.rawQuery("SELECT MAX(finished) FROM scans WHERE phase = 'complete'", null).use {
            it.moveToFirst(); it.getLong(0).takeUnless { _ -> it.isNull(0) }
        }
        return mapOf("indexed" to stats.first, "cacheBytes" to stats.second, "lastScan" to last,
            "history" to scanHistory(currentId), "excluded" to excludedAlbums())
    }

    fun excludedAlbums(): List<Map<String, String>> = readableDatabase.rawQuery(
        "SELECT bucket, name FROM excluded_albums ORDER BY name", null
    ).use { row -> buildList { while (row.moveToNext()) add(mapOf("id" to row.getString(0), "name" to row.getString(1))) } }

    fun excludeAlbum(bucket: String, name: String, excluded: Boolean) {
        val db = writableDatabase
        if (excluded) db.insertWithOnConflict("excluded_albums", null, ContentValues().apply {
            put("bucket", bucket)
            put("name", name)
        }, SQLiteDatabase.CONFLICT_REPLACE)
        else db.delete("excluded_albums", "bucket = ?", arrayOf(bucket))
    }

    fun clearAnalysis(all: Boolean) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            if (all) {
                db.delete("sources", null, null)
                db.delete("images", null, null)
                db.delete("scans", null, null)
            } else {
                db.delete("near_matches", null, null)
                db.execSQL("""UPDATE images SET status='pending', error=NULL, engine=NULL, result=NULL,
                    kind=NULL, confidence=NULL, tags=NULL, category=NULL, embedding=NULL, analyzed=0,
                    low_quality=0, keeper=NULL, aesthetic=NULL, linked=0""")
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    // A picker URI has no reliable change token. Hash it again when explicitly selected.
    fun knownImage(photo: Photo): Long? {
        if (photo.version.isEmpty()) return null
        return readableDatabase.rawQuery(
            "SELECT image_id FROM sources WHERE uri = ? AND version = ? AND image_id IS NOT NULL",
            arrayOf(photo.uri.toString(), photo.version)
        ).use { if (it.moveToFirst()) it.getLong(0) else null }
    }

    fun attach(photo: Photo, fingerprint: String): Long {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.insertWithOnConflict("images", null, ContentValues().apply {
                put("fingerprint", fingerprint)
            }, SQLiteDatabase.CONFLICT_IGNORE)
            val id = db.rawQuery("SELECT id FROM images WHERE fingerprint = ?", arrayOf(fingerprint)).use {
                check(it.moveToFirst())
                it.getLong(0)
            }
            db.insertWithOnConflict("sources", null, photo.values().apply { put("image_id", id) }, SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
            return id
        } finally {
            db.endTransaction()
        }
    }

    private fun Photo.values() = ContentValues().apply {
        put("uri", uri.toString())
        put("name", name)
        put("album", album)
        put("bucket", bucket)
        put("source", source)
        put("media_id", id)
        put("captured", taken)
        put("width", width)
        put("height", height)
        put("bytes", bytes)
        put("modified", modified)
        put("version", version)
    }

    fun isCached(id: Long): Boolean = readableDatabase.rawQuery(
        "SELECT 1 FROM images WHERE id = ? AND status = 'complete' AND engine = ?",
        arrayOf(id.toString(), EYE_VERSION)
    ).use { it.moveToFirst() }

    fun recordFailure(uri: Uri, photo: Photo?, id: Long?, reason: String) {
        val db = writableDatabase
        val error = ContentValues().apply { put("error", reason) }
        val reference = photo ?: Photo(0, uri, "Unavailable photo", "", "", 0, 0, 0, 0, 0, "", "unavailable")
        db.insertWithOnConflict("sources", null, reference.values(), SQLiteDatabase.CONFLICT_IGNORE)
        db.update("sources", error, "uri = ?", arrayOf(uri.toString()))
        if (id != null) db.update("images", ContentValues(error).apply {
            put("status", "failed")
        }, "id = ? AND status != 'complete'", arrayOf(id.toString()))
    }

    fun clearSourceError(uri: Uri) {
        writableDatabase.update("sources", ContentValues().apply { putNull("error") }, "uri = ?", arrayOf(uri.toString()))
    }

    fun complete(id: Long, analysis: Analysis) {
        val json = JSONObject(analysis.json)
        val scores = json.optJSONObject("scores")
        val bytes = ByteBuffer.allocate(analysis.embedding.size * Float.SIZE_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        analysis.embedding.forEach { bytes.putFloat(it) }
        writableDatabase.update("images", ContentValues().apply {
            put("status", "complete")
            putNull("error")
            put("engine", EYE_VERSION)
            put("result", analysis.json)
            put("kind", analysis.kind)
            put("confidence", analysis.confidence)
            put("tags", analysis.tags.toString())
            put("category", analysis.category)
            put("low_quality", if (lowQuality(json.optJSONObject("tags"))) 1 else 0)
            put("keeper", scores?.optDouble("keeper")?.takeIf { it in 0.0..1.0 })
            put("aesthetic", scores?.optDouble("aesthetic")?.takeIf { it in 0.0..1.0 })
            if (analysis.embedding.isNotEmpty()) put("embedding", bytes.array()) else putNull("embedding")
            put("analyzed", System.currentTimeMillis())
        }, "id = ?", arrayOf(id.toString()))
    }

    fun decide(id: Long, decision: String, collection: String?) {
        require(decision in setOf("new", "kept", "dismissed"))
        val name = collection?.trim()?.take(60)?.takeIf { it.isNotEmpty() }
        writableDatabase.update("images", ContentValues().apply {
            put("decision", decision)
            put("collection", if (decision == "kept") name else null)
        }, "id = ?", arrayOf(id.toString()))
    }

    fun available(id: Long, source: String? = null): Uri? = primarySource(id, source)?.first

    private fun primarySource(id: Long, source: String? = null): Triple<Uri, String, String>? = readableDatabase.rawQuery(
        """SELECT uri, name, album FROM sources WHERE image_id = ?
            AND (${if (source == null) "1 = 1" else "uri = ?"})
            AND NOT EXISTS (SELECT 1 FROM archive WHERE archive.uri = sources.uri)
            ORDER BY source, captured DESC""",
        listOfNotNull(id.toString(), source).toTypedArray()
    ).use { row ->
        while (row.moveToNext()) {
            val uri = Uri.parse(row.getString(0))
            if (gallery.readable(uri)) return Triple(uri, row.getString(1), row.getString(2))
        }
        null
    }

    private fun entry(id: Long, kind: String?, confidence: Double?, tags: String, category: String?,
                      decision: String, collection: String?, photo: Triple<Uri, String, String>? = primarySource(id)): Map<String, Any?> {
        val labels = JSONArray(tags)
        return mapOf(
            "id" to id.toString(), "uri" to photo?.first?.toString(), "name" to (photo?.second ?: "Unavailable photo"),
            "album" to photo?.third, "kind" to kind, "confidence" to confidence, "category" to category,
            "decision" to decision, "collection" to collection,
            "tags" to List(labels.length()) { index ->
                val label = labels.getJSONObject(index)
                mapOf("label" to label.getString("label"), "confidence" to label.getDouble("confidence"))
            }
        )
    }

    private val reviewCategory = """COALESCE(images.category, CASE images.kind
        WHEN 'screenshot' THEN 'Screenshots' WHEN 'photo' THEN 'Photos'
        WHEN 'selfie' THEN 'Selfies' WHEN 'document' THEN 'Documents' WHEN 'receipt' THEN 'Receipts'
        ELSE images.kind END, 'Other')""".trimIndent()
    private val scanReviewRows = """FROM scan_results r JOIN sources s ON s.uri = r.uri AND s.image_id = r.image_id
        JOIN images ON images.id = r.image_id
        WHERE r.scan_id = ? AND images.status = 'complete'
        AND NOT EXISTS (SELECT 1 FROM archive a WHERE a.uri = r.uri)""".trimIndent()

    fun reviewCategories(scanId: Long?): List<Map<String, Any?>> {
        val db = readableDatabase
        val scan = scanId != null
        val category = if (scan) reviewCategory else "category"
        val rows = if (scan) scanReviewRows else
            "FROM images WHERE status = 'complete' AND decision = 'new' AND category IS NOT NULL AND $visible"
        val args = scanId?.let { arrayOf(it.toString()) } ?: emptyArray()
        val groups = db.rawQuery(
            "SELECT $category, COUNT(*) $rows GROUP BY $category ORDER BY COUNT(*) DESC, $category",
            args
        ).use { row -> buildList { while (row.moveToNext()) add(row.getString(0) to row.getInt(1)) } }
        return groups.map { (name, count) ->
            val results = if (scanId != null) scanFeed(scanId, name, 0, 3) else feed("suggestions", name, 0, 3)
            mapOf("name" to name, "count" to count, "previews" to results.mapNotNull { it["uri"] })
        }
    }

    fun scanFeed(scanId: Long, category: String?, offset: Int, limit: Int): List<Map<String, Any?>> {
        val filter = if (category == null) "" else " AND $reviewCategory = ?"
        val args = listOfNotNull(scanId.toString(), category).toTypedArray()
        return readableDatabase.rawQuery(
            """SELECT images.id, images.kind, images.confidence, images.tags, $reviewCategory,
                images.decision, images.collection, s.uri, s.name, s.album
                $scanReviewRows$filter ORDER BY s.captured DESC, s.uri LIMIT $limit OFFSET $offset""",
            args
        ).use { row -> buildList {
            while (row.moveToNext()) {
                val uri = Uri.parse(row.getString(7))
                val photo = if (gallery.readable(uri)) Triple(uri, row.getString(8), row.getString(9)) else null
                add(entry(row.getLong(0), row.getString(1), row.getDouble(2).takeUnless { row.isNull(2) },
                    row.getString(3), row.getString(4), row.getString(5), row.getString(6), photo) +
                    ("sourceKey" to row.getString(7)))
            }
        } }
    }

    fun revisitPicks(seen: List<String>): List<Map<String, Any?>> {
        val db = readableDatabase
        val excluded = seen.takeLast(96).distinct().toTypedArray()
        val filter = if (excluded.isEmpty()) "" else "AND id NOT IN (${excluded.joinToString(",") { "?" }})"
        val eligible = """FROM images WHERE status = 'complete' AND decision = 'new'
            AND category IS NOT NULL AND $visible $filter""".trimIndent()
        // Specific references lead. Each category, including generic screenshots, gets at most one slot.
        val categories = db.rawQuery("""SELECT category $eligible GROUP BY category
            ORDER BY CASE WHEN category = 'Screenshots' THEN 1 ELSE 0 END, MAX(analyzed) DESC, category""", excluded
        ).use { row -> buildList { while (row.moveToNext()) add(row.getString(0)) } }
        val picks = mutableListOf<Map<String, Any?>>()
        val ids = mutableListOf<Long>()
        for (category in categories) {
            if (picks.size == 3) break
            db.rawQuery("""SELECT id, kind, confidence, tags, category, decision, collection $eligible AND category = ?
                ORDER BY low_quality, analyzed DESC, id DESC LIMIT 24""", arrayOf(*excluded, category)).use { row ->
                while (row.moveToNext()) {
                    val id = row.getLong(0)
                    if (ids.any { picked -> db.rawQuery(
                            "SELECT 1 FROM near_matches WHERE left_id = ? AND right_id = ?",
                            arrayOf(minOf(id, picked).toString(), maxOf(id, picked).toString())
                        ).use { it.moveToFirst() } }) continue
                    val photo = primarySource(id) ?: continue
                    picks.add(entry(id, row.getString(1), row.getDouble(2).takeUnless { row.isNull(2) },
                        row.getString(3), category, row.getString(5), row.getString(6), photo))
                    ids.add(id)
                    break
                }
            }
        }
        return picks
    }

    fun feed(mode: String, category: String?, offset: Int, limit: Int): List<Map<String, Any?>> {
        val selection = mutableListOf("status = 'complete'", visible)
        val args = mutableListOf<String>()
        when (mode) {
            "suggestions" -> selection.add("decision = 'new' AND category IS NOT NULL")
            "kept" -> selection.add("decision = 'kept'")
            "dismissed" -> selection.add("decision = 'dismissed'")
            "quality" -> selection.add("low_quality = 1 AND decision != 'dismissed'")
            "screenshots" -> selection.add("kind = 'screenshot' AND decision != 'dismissed'")
            else -> selection.add("decision != 'dismissed'")
        }
        if (category != null) {
            selection.add(if (mode == "kept") "collection = ?" else "category = ?")
            args.add(category)
        }
        return readableDatabase.query("images", arrayOf("id", "kind", "confidence", "tags", "category", "decision", "collection"),
            selection.joinToString(" AND "), args.toTypedArray(), null, null, "analyzed DESC, id DESC", "$limit OFFSET $offset"
        ).use { row ->
            buildList {
                while (row.moveToNext()) add(entry(row.getLong(0), row.getString(1), row.getDouble(2).takeUnless { row.isNull(2) },
                    row.getString(3), row.getString(4), row.getString(5), row.getString(6)))
            }
        }
    }

    fun groups(kept: Boolean): List<String> {
        val column = if (kept) "collection" else "category"
        val decision = if (kept) "kept" else "new"
        return readableDatabase.rawQuery(
            "SELECT DISTINCT $column FROM images WHERE status = 'complete' AND decision = ? AND $column IS NOT NULL AND $visible ORDER BY $column",
            arrayOf(decision)
        ).use { row -> buildList { while (row.moveToNext()) add(row.getString(0)) } }
    }

    fun similar(id: Long): List<Map<String, Any?>> {
        val db = readableDatabase
        val original = db.rawQuery("SELECT engine, embedding, result FROM images WHERE id = ? AND embedding IS NOT NULL",
            arrayOf(id.toString())).use {
            if (it.moveToFirst()) Triple(it.getString(0), vector(it.getBlob(1)), it.getString(2)) else null
        }
            ?: return emptyList()
        val duplicateThreshold = JSONObject(original.third).optJSONObject("duplicates")?.optDouble("similarity")
            ?.takeIf { it in 0.0..1.0 } ?: 0.97
        data class Match(val id: Long, val score: Double)
        val best = PriorityQueue<Match>(compareBy { it.score })
        db.rawQuery(
            "SELECT id, embedding FROM images WHERE id != ? AND engine = ? AND status = 'complete' AND embedding IS NOT NULL AND decision != 'dismissed' AND $visible",
            arrayOf(id.toString(), original.first)
        ).use { row ->
            while (row.moveToNext()) {
                val score = cosine(original.second, vector(row.getBlob(1)))
                if (score < 0.60) continue
                best.add(Match(row.getLong(0), score))
                if (best.size > 24) best.poll()
            }
        }
        return best.sortedByDescending { it.score }.mapNotNull { match ->
            db.rawQuery("SELECT kind, confidence, tags, category, decision, collection FROM images WHERE id = ?",
                arrayOf(match.id.toString())).use { row ->
                if (!row.moveToFirst()) return@use null
                val photo = entry(match.id, row.getString(0), row.getDouble(1).takeUnless { row.isNull(1) },
                    row.getString(2), row.getString(3), row.getString(4), row.getString(5))
                if (photo["uri"] == null) null
                else photo + mapOf("similarity" to match.score, "nearDuplicate" to (match.score >= duplicateThreshold))
            }
        }.take(8)
    }

    private fun vector(bytes: ByteArray): FloatArray {
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        return FloatArray(buffer.remaining()).also { buffer.get(it) }
    }

    private fun cosine(a: FloatArray, b: FloatArray): Double {
        if (a.size != b.size) return 0.0
        var dot = 0.0
        var left = 0.0
        var right = 0.0
        for (i in a.indices) {
            dot += a[i].toDouble() * b[i]
            left += a[i].toDouble() * a[i]
            right += b[i].toDouble() * b[i]
        }
        return if (left > 0 && right > 0) (dot / sqrt(left * right)).coerceIn(-1.0, 1.0) else 0.0
    }
}
