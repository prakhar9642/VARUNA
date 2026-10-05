import { useEffect, useRef } from 'react';
import { Marker, Popup } from 'maplibre-gl';
import { useMap } from './mapContext';
import { useStore } from '../../store/useStore';
import { REGIONS, RISK_TIERS, getDeterministicForecast } from '../../data/mockData.js';

export default function ForecastLayer({ dotsOnly = false }) {
  const { map, mapReady, flyTo } = useMap() || {};
  const selectedRegionId = useStore((s) => s.selectedRegionId);
  const selectRegion = useStore((s) => s.selectRegion);
  const selectedModelLayer = useStore((s) => s.selectedModelLayer);
  const selectedVariable = useStore((s) => s.selectedVariable);
  const selectedLeadTime = useStore((s) => s.selectedLeadTime);
  const regionalForecasts = useStore((s) => s.regionalForecasts);
  const effectiveMode = useStore((s) => s.effectiveMode);

  const markersRef = useRef([]);
  const popupRef = useRef(null);
  const initialMountRef = useRef(true);

  // Pan to selected region smoothly when user actively selects a region, but preserve India overview on mount
  useEffect(() => {
    if (!map || !mapReady || !selectedRegionId || !flyTo) return;
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    const reg = REGIONS.find((r) => r.id === selectedRegionId);
    if (reg) {
      flyTo([reg.lng, reg.lat], Math.max(map.getZoom(), 6.5));
    }
  }, [map, mapReady, selectedRegionId, flyTo]);

  // Render HTML markers for each forecast region
  useEffect(() => {
    if (!map || !mapReady) return;

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const leadH = typeof selectedLeadTime === 'string'
      ? (selectedLeadTime.endsWith('d') ? parseInt(selectedLeadTime, 10) * 24 : parseInt(selectedLeadTime, 10))
      : (selectedLeadTime || 48);

    const sample = regionalForecasts?.[0]?.forecast;
    const isVariableMatch = sample?.variable?.id === selectedVariable;
    const isLeadMatch = sample && (sample.leadHours === leadH || sample.leadTime === selectedLeadTime || sample.leadTime === `+${leadH}h`);

    const activeList = (isVariableMatch && isLeadMatch)
      ? regionalForecasts
      : REGIONS.map((r) => ({
          ...r,
          forecast: (effectiveMode === 'DEMO' || effectiveMode === 'REPLAY')
            ? getDeterministicForecast(r.id, selectedVariable || 'temperature', selectedLeadTime || '48h', effectiveMode)
            : null,
        }));

    activeList.forEach((item) => {
      const region = item;
      const forecast = item.forecast;
      const isSelected = region.id === selectedRegionId;
      const color = forecast ? (RISK_TIERS[forecast.alertLevel] || '#16A34A') : '#64748B';

      const el = document.createElement('div');
      el.className = 'varuna-map-marker';
      el.style.cursor = 'pointer';

      // ── DOTS ONLY MODE (Clean geographical dots on monitored regions) ──
      if (dotsOnly) {
        el.innerHTML = `
          <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
            ${isSelected ? `
              <div style="position: absolute; top: -7px; left: -7px; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #38BDF8; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite; pointer-events: none;"></div>
              <div style="position: absolute; top: -3px; left: -3px; width: 18px; height: 18px; border-radius: 50%; background: rgba(56, 189, 248, 0.25); pointer-events: none;"></div>
            ` : ''}
            <div style="
              width: 12px;
              height: 12px;
              border-radius: 50%;
              background: ${isSelected ? '#38BDF8' : '#0284C7'};
              border: 2px solid #FFFFFF;
              box-shadow: 0 0 10px ${isSelected ? 'rgba(56, 189, 248, 0.9)' : 'rgba(2, 132, 199, 0.5)'}, 0 2px 5px rgba(0,0,0,0.5);
              transition: transform 0.2s ease, background 0.2s ease;
            "></div>
            <div style="
              font-family: 'Inter', sans-serif;
              font-size: 10px;
              font-weight: 600;
              color: #F8FAFC;
              background: rgba(11, 15, 23, 0.88);
              padding: 2px 6px;
              border-radius: 4px;
              margin-top: 4px;
              border: 1px solid rgba(255,255,255,0.18);
              box-shadow: 0 2px 6px rgba(0,0,0,0.5);
              white-space: nowrap;
              text-shadow: 0 1px 2px rgba(0,0,0,0.8);
              pointer-events: none;
            ">
              ${region.name.split(' (')[0]}
            </div>
          </div>
        `;

        el.addEventListener('mouseenter', () => {
          if (popupRef.current) popupRef.current.remove();
          popupRef.current = new Popup({ offset: 15, closeButton: false })
            .setLngLat([region.lng, region.lat])
            .setHTML(`
              <div style="padding: 8px 12px; font-family: 'Inter', sans-serif; font-size: 11px; background: #0B0F17; color: #FFFFFF; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 4px 14px rgba(0,0,0,0.5);">
                <div style="font-weight: 700; color: #38BDF8; font-size: 12px; margin-bottom: 2px;">${region.name}</div>
                <div style="font-size: 10px; color: #94A3B8; margin-bottom: 4px;">${region.state} · ${region.zone}</div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #CBD5E1;">${region.lat.toFixed(2)}°N, ${region.lng.toFixed(2)}°E · Elev: ${region.elevation || '—'}</div>
              </div>
            `)
            .addTo(map);
        });

        el.addEventListener('mouseleave', () => {
          if (popupRef.current) popupRef.current.remove();
        });

        el.onclick = () => {
          selectRegion(region.id);
          if (flyTo) flyTo([region.lng, region.lat], 8);
        };

        const marker = new Marker({ element: el })
          .setLngLat([region.lng, region.lat])
          .addTo(map);

        markersRef.current.push(marker);
        return;
      }

      // Pick display value according to selected model layer
      let displayVal = forecast ? forecast.forecastValue : '—';
      const unit = forecast ? forecast.unit : '';
      if (forecast) {
        if (selectedModelLayer === 'ifs') displayVal = forecast.models?.ifs?.value ?? displayVal;
        if (selectedModelLayer === 'aifs') displayVal = forecast.models?.aifs?.value ?? displayVal;
        if (selectedModelLayer === 'gfs') displayVal = forecast.models?.gfs?.value ?? displayVal;
        if (selectedModelLayer === 'icon' || selectedModelLayer === 'dwd_icon') {
          displayVal = (forecast.models?.icon?.value ?? forecast.models?.dwd_icon?.value) ?? displayVal;
        }
      }

      el.innerHTML = `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
          ${isSelected ? `<div style="position: absolute; top: -6px; left: -6px; right: -6px; bottom: -6px; border-radius: 20px; border: 2px solid #F5C518; animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite; pointer-events: none;"></div>` : ''}
          <div style="
            display: flex;
            align-items: center;
            gap: 4px;
            background: #0B0F17;
            border: 2px solid ${isSelected ? '#F5C518' : color};
            padding: 3px 8px;
            border-radius: 12px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.5);
            color: #FFFFFF;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            font-weight: 700;
            white-space: nowrap;
            transition: transform 0.15s ease;
          ">
            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${color};"></span>
            <span>${displayVal}${unit ? ` <span style="font-size: 9px; opacity: 0.8;">${unit}</span>` : ''}</span>
          </div>
          <div style="
            font-family: 'Inter', sans-serif;
            font-size: 10px;
            font-weight: 600;
            color: #FFFFFF;
            background: rgba(15, 23, 42, 0.85);
            padding: 1px 5px;
            border-radius: 4px;
            margin-top: 2px;
            border: 1px solid rgba(255,255,255,0.15);
            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
          ">
            ${region.name.split(' (')[0]}
          </div>
        </div>
      `;

      el.addEventListener('mouseenter', () => {
        if (popupRef.current) popupRef.current.remove();
        if (!forecast) {
          popupRef.current = new Popup({ offset: 25, closeButton: false })
            .setLngLat([region.lng, region.lat])
            .setHTML(`
              <div style="padding: 10px; font-family: 'Inter', sans-serif; font-size: 12px; min-width: 180px;">
                <div style="font-weight: 700; color: #1A1A17; margin-bottom: 2px;">${region.name}</div>
                <div style="font-size: 10px; color: #75756C; margin-bottom: 6px;">${region.zone}</div>
                <div style="color: #64748B; font-size: 11px;">Forecast currently unavailable from backend</div>
              </div>
            `)
            .addTo(map);
          return;
        }

        popupRef.current = new Popup({ offset: 25, closeButton: false })
          .setLngLat([region.lng, region.lat])
          .setHTML(`
            <div style="padding: 10px; font-family: 'Inter', sans-serif; font-size: 12px; min-width: 180px;">
              <div style="font-weight: 700; color: #1A1A17; margin-bottom: 2px;">${region.name}</div>
              <div style="font-size: 10px; color: #75756C; margin-bottom: 6px;">${region.zone}</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <span style="color: #484841;">VARUNA Blend:</span>
                <strong style="color: #D97706; font-family: 'JetBrains Mono', monospace;">${forecast.forecastValue} ${forecast.unit}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 11px;">
                <span style="color: #75756C;">ECMWF AIFS:</span>
                <span style="font-family: 'JetBrains Mono', monospace;">${forecast.models?.aifs?.value ?? '—'} ${forecast.unit} (${forecast.models?.aifs?.weight ?? 0}%)</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 11px;">
                <span style="color: #75756C;">NOAA GFS:</span>
                <span style="font-family: 'JetBrains Mono', monospace;">${forecast.models?.gfs?.value ?? '—'} ${forecast.unit} (${forecast.models?.gfs?.weight ?? 0}%)</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 11px;">
                <span style="color: #75756C;">ECMWF IFS:</span>
                <span style="font-family: 'JetBrains Mono', monospace;">${forecast.models?.ifs?.value ?? '—'} ${forecast.unit} (${forecast.models?.ifs?.weight ?? 0}%)</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 11px;">
                <span style="color: #75756C;">DWD ICON:</span>
                <span style="font-family: 'JetBrains Mono', monospace;">${forecast.models?.icon?.value ?? '—'} ${forecast.unit} (${forecast.models?.icon?.weight ?? 0}%)</span>
              </div>
              <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid #E8E5DE; font-size: 10px; color: #16A34A; font-weight: 600;">
                Click to inspect weighting
              </div>
            </div>
          `)
          .addTo(map);
      });

      el.addEventListener('mouseleave', () => {
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
      });

      el.addEventListener('click', () => {
        selectRegion(region.id);
      });

      const marker = new Marker({ element: el })
        .setLngLat([region.lng, region.lat])
        .addTo(map);

      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, [map, mapReady, selectedRegionId, selectedModelLayer, regionalForecasts, selectedVariable, selectedLeadTime, selectRegion, dotsOnly, effectiveMode, flyTo]);

  return null;
}
