package dev.nimby.gallery

import android.content.Context
import android.graphics.Color
import android.graphics.RectF
import android.view.View.OnLayoutChangeListener
import android.widget.LinearLayout
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.style.sources.GeoJsonSource
import kotlin.math.PI
import kotlin.math.asinh
import kotlin.math.atan
import kotlin.math.log2
import kotlin.math.sinh
import kotlin.math.tan

class PhotoMapModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NimbyPhotoMap")
        View(PhotoMapView::class) {
            Events("onViewport", "onCluster", "onMapError")
            Prop("points") { view: PhotoMapView, points: String -> view.renderPoints(points) }
            Prop("fit") { view: PhotoMapView, bounds: String? -> view.fitPhotos(bounds) }
        }
    }
}

internal class PhotoMapView(context: Context, appContext: AppContext) : ExpoView(context, appContext), LifecycleEventListener {
    override val shouldUseAndroidLayout = true
    private val onViewport by EventDispatcher()
    private val onCluster by EventDispatcher()
    private val onMapError by EventDispatcher()
    private var mapView: MapView? = null
    private var map: MapLibreMap? = null
    private var running = false
    private var points: String? = null
    private var fit: String? = null
    private var pendingFit = true
    private val mapLayoutListener = OnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
        if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) {
            applyFit()
            emitViewport()
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        val react = appContext.reactContext as? ReactContext
        MapLibre.getInstance(context)
        MapLibre.setConnected(false)
        val surface = MapView(context, MapLibreMapOptions.createFromAttributes(context)
            .camera(CameraPosition.Builder().target(LatLng(12.0, 0.0)).zoom(0.0).build())
            .minZoomPreference(0.0).maxZoomPreference(7.0).textureMode(true)
            .foregroundLoadColor(Color.parseColor("#142128"))
            .logoEnabled(false).attributionEnabled(false).compassEnabled(false)
            .rotateGesturesEnabled(false).tiltGesturesEnabled(false))
        addView(surface, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        mapView = surface
        surface.onCreate(null)
        surface.addOnDidFailLoadingMapListener { onMapError(mapOf("message" to "The offline map could not load.")) }
        surface.getMapAsync { loaded ->
            if (mapView !== surface) return@getMapAsync
            map = loaded
            loaded.addOnCameraIdleListener { emitViewport() }
            loaded.addOnMapClickListener { coordinate ->
                val p = loaded.projection.toScreenLocation(coordinate)
                val hit = 14f * resources.displayMetrics.density
                val box = RectF(p.x - hit, p.y - hit, p.x + hit, p.y + hit)
                val id = loaded.queryRenderedFeatures(box, "photo-pins").firstOrNull()?.getStringProperty("clusterId")
                if (id != null) onCluster(mapOf("id" to id))
                id != null
            }
            loaded.setStyle("asset://photo-map/style.json") {
                applyPoints()
                applyFit()
                emitViewport()
            }
        }
        pendingFit = true
        react?.addLifecycleEventListener(this)
        if (react?.lifecycleState == LifecycleState.RESUMED) onHostResume()
        addOnLayoutChangeListener(mapLayoutListener)
    }

    override fun onDetachedFromWindow() {
        removeOnLayoutChangeListener(mapLayoutListener)
        (appContext.reactContext as? ReactContext)?.removeLifecycleEventListener(this)
        releaseMap()
        super.onDetachedFromWindow()
    }

    override fun onHostResume() {
        val surface = mapView ?: return
        if (running) return
        surface.onStart()
        surface.onResume()
        running = true
    }

    override fun onHostPause() {
        val surface = mapView ?: return
        if (!running) return
        surface.onPause()
        surface.onStop()
        running = false
    }

    override fun onHostDestroy() = releaseMap()

    private fun releaseMap() {
        val surface = mapView ?: return
        onHostPause()
        map = null
        mapView = null
        surface.onDestroy()
        removeView(surface)
    }

    fun renderPoints(geoJson: String) {
        points = geoJson
        applyPoints()
    }

    private fun applyPoints() {
        val value = points ?: return
        map?.style?.getSourceAs<GeoJsonSource>("photos")?.setGeoJson(value)
    }

    fun fitPhotos(value: String?) {
        fit = value
        pendingFit = true
        applyFit()
    }

    private fun applyFit() {
        val view = map ?: return
        val value = fit ?: return
        if (!pendingFit || width <= 0 || height <= 0) return
        val bounds = JSONObject(value)
        val west = bounds.getDouble("west")
        val adjustedEast = bounds.getDouble("east").let { if (it < west) it + 360.0 else it }
        val south = projectionY(bounds.getDouble("south"))
        val north = projectionY(bounds.getDouble("north"))
        val center = LatLng(Math.toDegrees(atan(sinh((south + north) / 2))), normalizeMapLongitude((west + adjustedEast) / 2))
        val widthDp = width / resources.displayMetrics.density
        val heightDp = height / resources.displayMetrics.density
        val xZoom = log2((widthDp - 64).coerceAtLeast(1f) / (512.0 * (adjustedEast - west) / 360.0))
        val yZoom = log2((heightDp - 64).coerceAtLeast(1f) / (512.0 * (north - south) / (2 * PI)))
        val zoom = minOf(xZoom, yZoom).coerceIn(0.0, 4.8)
        pendingFit = false
        view.moveCamera(CameraUpdateFactory.newLatLngZoom(center, zoom))
    }

    private fun projectionY(lat: Double): Double = asinh(tan(Math.toRadians(lat.coerceIn(-85.05112878, 85.05112878))))

    private fun emitViewport() {
        val view = map ?: return
        if (width == 0 || height == 0) return
        val bounds = view.projection.visibleRegion.latLngBounds
        val fullWidth = bounds.longitudeEast - bounds.longitudeWest >= 359.0
        onViewport(mapOf(
            "south" to if (bounds.latitudeSouth <= -85.05) -90.0 else bounds.latitudeSouth.coerceAtMost(90.0),
            "west" to if (fullWidth) -180.0 else normalizeMapLongitude(bounds.longitudeWest),
            "north" to if (bounds.latitudeNorth >= 85.05) 90.0 else bounds.latitudeNorth.coerceAtLeast(-90.0),
            "east" to if (fullWidth) 180.0 else normalizeMapLongitude(bounds.longitudeEast),
            "zoom" to view.cameraPosition.zoom,
        ))
    }
}
