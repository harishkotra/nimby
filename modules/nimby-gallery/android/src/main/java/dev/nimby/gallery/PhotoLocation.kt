package dev.nimby.gallery

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import java.io.IOException

internal data class PhotoCoordinates(val latitude: Double, val longitude: Double)

internal fun hasPhotoLocationPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < 29 ||
        context.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED

/** Read only embedded metadata through an existing photo grant. */
internal fun readPhotoCoordinates(context: Context, uri: Uri): PhotoCoordinates? {
    if (uri.scheme != ContentResolver.SCHEME_CONTENT || !hasPhotoLocationPermission(context)) return null
    return try {
        val original = if (Build.VERSION.SDK_INT >= 29 && uri.authority == MediaStore.AUTHORITY &&
            uri.pathSegments.let { it.size == 4 && it[1] == "images" && it[2] == "media" }
        ) MediaStore.setRequireOriginal(uri) else uri
        context.contentResolver.openInputStream(original)?.use { input ->
            val coordinates = ExifInterface(input).latLong ?: return null
            val latitude = coordinates[0]
            val longitude = coordinates[1]
            // Cameras and exporters sometimes write (0, 0) as a missing-location sentinel.
            if (latitude !in -90.0..90.0 || longitude !in -180.0..180.0 || (latitude == 0.0 && longitude == 0.0)) {
                null
            } else PhotoCoordinates(latitude, longitude)
        }
    } catch (_: IOException) {
        null
    } catch (_: SecurityException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    } catch (_: UnsupportedOperationException) {
        null
    }
}
