package dev.nimby.gallery

import android.Manifest
import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.MediaStore.Images.Media
import android.provider.OpenableColumns
import java.io.IOException

internal data class Photo(
    val id: Long, val uri: Uri, val name: String, val album: String, val bucket: String,
    val taken: Long, val width: Int, val height: Int, val bytes: Long,
    val modified: Long, val version: String, val source: String
) {
    fun bridge() = mapOf("uri" to uri.toString(), "name" to name, "album" to album)
}

internal class GallerySource(private val context: Context) {
    private val resolver = context.contentResolver
    private val permissionHistory = context.getSharedPreferences("gallery-permissions", Context.MODE_PRIVATE)
    private val volumeAware = Build.VERSION.SDK_INT >= 29
    private val images = if (volumeAware) Media.getContentUri(MediaStore.VOLUME_EXTERNAL) else Media.EXTERNAL_CONTENT_URI
    private val generationAware = Build.VERSION.SDK_INT >= 30
    private val columns = listOf(
        Media._ID, Media.DISPLAY_NAME, Media.BUCKET_DISPLAY_NAME, Media.BUCKET_ID,
        Media.DATE_TAKEN, Media.DATE_ADDED, Media.WIDTH, Media.HEIGHT, Media.SIZE, Media.DATE_MODIFIED
    ) + (if (volumeAware) listOf(Media.VOLUME_NAME) else emptyList()) +
        (if (generationAware) listOf(Media.GENERATION_MODIFIED) else emptyList())

    private fun granted(permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    fun access(): String = when {
        Build.VERSION.SDK_INT >= 33 && granted(Manifest.permission.READ_MEDIA_IMAGES) -> "full"
        Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> "limited"
        Build.VERSION.SDK_INT < 33 && granted(Manifest.permission.READ_EXTERNAL_STORAGE) -> "full"
        else -> "none"
    }

    fun permissionStatus(requested: Boolean): String {
        val access = access()
        if (access != "none") {
            if (!permissionHistory.getBoolean("granted", false)) {
                permissionHistory.edit().putBoolean("granted", true).apply()
            }
            return access
        }
        if (requested) permissionHistory.edit().putBoolean("requested", true).apply()
        if (permissionHistory.getBoolean("granted", false)) return "revoked"
        return if (permissionHistory.getBoolean("requested", false)) "denied" else "unrequested"
    }

    private fun requireAccess() {
        if (access() == "none") throw SecurityException("Gallery access is off. Update access in Gallery or select photos manually.")
    }

    private fun query(buckets: List<String>, before: Long = Long.MAX_VALUE, limit: Int? = null,
                      projection: List<String> = columns): Cursor {
        requireAccess()
        val where = mutableListOf<String>()
        val args = mutableListOf<String>()
        if (before != Long.MAX_VALUE) {
            where.add("${Media._ID} < ?")
            args.add(before.toString())
        }
        if (buckets.isNotEmpty()) {
            val conditions = buckets.distinct().map { key ->
                val (volume, bucket) = key.split('|', limit = 2)
                val parts = mutableListOf<String>()
                if (volumeAware) {
                    parts.add("${Media.VOLUME_NAME} = ?")
                    args.add(volume)
                }
                if (bucket.isEmpty()) parts.add("${Media.BUCKET_ID} IS NULL")
                else {
                    parts.add("${Media.BUCKET_ID} = ?")
                    args.add(bucket)
                }
                "(${parts.joinToString(" AND ")})"
            }
            where.add("(${conditions.joinToString(" OR ")})")
        }
        val selection = where.joinToString(" AND ").ifEmpty { null }
        val sort = "${Media._ID} DESC"
        val cursor = if (Build.VERSION.SDK_INT >= 26) {
            resolver.query(images, projection.toTypedArray(), Bundle().apply {
                if (selection != null) {
                    putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
                    putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args.toTypedArray())
                }
                putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, sort)
                if (limit != null) putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
            }, null)
        } else resolver.query(images, projection.toTypedArray(), selection, args.toTypedArray(), sort)
        return cursor ?: throw IOException("Android could not read the gallery.")
    }

    private fun mediaPhoto(row: Cursor): Photo {
        val id = row.getLong(0)
        val volume = if (volumeAware) row.getString(10) ?: MediaStore.VOLUME_EXTERNAL else ""
        val base = if (volumeAware) Media.getContentUri(volume) else images
        val taken = row.getLong(4).takeIf { it > 0 } ?: row.getLong(5) * 1000
        val modified = row.getLong(9)
        val bytes = row.getLong(8)
        val generation = if (generationAware) row.getLong(11) else 0
        return Photo(id, ContentUris.withAppendedId(base, id), row.getString(1) ?: "Photo",
            row.getString(2) ?: "Other", "$volume|${row.getString(3).orEmpty()}",
            taken, row.getInt(6), row.getInt(7), bytes, modified, "$modified:$bytes:$generation", "gallery")
    }

    fun page(buckets: List<String>, before: Long, limit: Int): List<Photo> =
        query(buckets, before, limit).use { row ->
            buildList { while (size < limit && row.moveToNext()) add(mediaPhoto(row)) }
        }

    fun count(buckets: List<String>): Int = query(buckets, projection = listOf(Media._ID)).use { it.count }

    fun forEachPhoto(visit: (Photo) -> Unit) {
        query(emptyList()).use { row -> while (row.moveToNext()) visit(mediaPhoto(row)) }
    }

    fun albums(hidden: Set<String> = emptySet()): List<Map<String, Any>> {
        data class Album(val name: String, val uri: String, var count: Int = 0)
        val albums = linkedMapOf<String, Album>()
        query(emptyList()).use { row ->
            while (row.moveToNext()) {
                val photo = mediaPhoto(row)
                if (photo.uri.toString() in hidden) continue
                albums.getOrPut(photo.bucket) { Album(photo.album, photo.uri.toString()) }.count++
            }
        }
        return albums.map { (id, album) ->
            mapOf("id" to id, "name" to album.name, "uri" to album.uri, "count" to album.count)
        }.sortedBy { it["name"].toString().lowercase() }
    }

    fun chosen(uri: Uri): Photo {
        require(uri.scheme == ContentResolver.SCHEME_CONTENT) { "Android did not return a photo URI." }
        if (uri.authority == MediaStore.AUTHORITY && uri.pathSegments.let { it.size == 4 && it[1] == "images" && it[2] == "media" }) {
            return resolver.query(uri, columns.toTypedArray(), null, null, null)?.use { row ->
                if (row.moveToFirst()) mediaPhoto(row) else null
            } ?: throw IOException("This photo is no longer accessible.")
        }
        var name = "Selected photo"
        var bytes = 0L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { row ->
            if (row.moveToFirst()) {
                name = row.getString(0) ?: name
                bytes = row.getLong(1)
            }
        }
        return Photo(0, uri, name, "Selected photos", "", 0, 0, 0, bytes, 0, "", "picker")
    }

    fun readable(uri: Uri): Boolean = try {
        resolver.openAssetFileDescriptor(uri, "r")?.use { true } ?: false
    } catch (_: IOException) {
        false
    } catch (_: SecurityException) {
        false
    } catch (_: IllegalArgumentException) {
        false
    }

    fun confirmAbsent(uri: Uri): Boolean = try {
        access() != "none" && resolver.query(uri, arrayOf(Media._ID), null, null, null)
            ?.use { !it.moveToFirst() } == true
    } catch (_: SecurityException) {
        false
    } catch (_: IllegalArgumentException) {
        false
    }
}
