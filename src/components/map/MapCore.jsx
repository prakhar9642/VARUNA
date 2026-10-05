import { useRef, useEffect, useState, useCallback } from 'react';
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../../store/useStore';
import { MapContext, BASEMAP_STYLES } from './mapContext';

if (typeof window !== 'undefined' && typeof setWorkerUrl === 'function') {
  try {
    setWorkerUrl(maplibreWorkerUrl);
  } catch {
    // Ignore worker registration fallback
  }
}

export default function MapCore({ children }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const basemap = useStore((s) => s.basemap);
  const setBasemap = useStore((s) => s.setBasemap);

  const [viewCoords, setViewCoords] = useState({ lat: '22.59', lng: '78.96', zoom: '4.5' });

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    try {
      const initialStyle = BASEMAP_STYLES[basemap] || BASEMAP_STYLES.satellite;

      const map = new MapLibreMap({
        container: containerRef.current,
        style: initialStyle,
        center: [78.9629, 22.5937], // India Center
        zoom: 4.5,
        attributionControl: false,
      });

      map.addControl(new NavigationControl({ showCompass: true }), 'top-right');

      map.on('load', () => {
        mapRef.current = map;
        setMapInstance(map);
        setMapReady(true);
      });

      map.on('move', () => {
        const c = map.getCenter();
        const z = map.getZoom();
        setViewCoords({
          lat: c.lat.toFixed(2),
          lng: c.lng.toFixed(2),
          zoom: z.toFixed(1),
        });
      });
    } catch (err) {
      console.warn('MapLibre init error:', err);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [basemap]);

  // Handle basemap changes
  const changeBasemap = useCallback(
    (styleId) => {
      setBasemap(styleId);
      if (!mapRef.current) return;
      const targetStyle = BASEMAP_STYLES[styleId];
      if (targetStyle) {
        mapRef.current.setStyle(targetStyle);
      }
    },
    [setBasemap]
  );

  const flyTo = useCallback((coords, zoom = 8) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: coords,
      zoom,
      duration: 1200,
    });
  }, []);

  return (
    <MapContext.Provider
      value={{
        map: mapInstance,
        mapReady,
        flyTo,
        changeBasemap,
        basemap,
        viewCoords,
      }}
    >
      <div className="relative w-full h-full min-h-0 overflow-hidden">
        <div ref={containerRef} className="w-full h-full min-h-0 bg-[#0a0e17]" />
        {children}
      </div>
    </MapContext.Provider>
  );
}
