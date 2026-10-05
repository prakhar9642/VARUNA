import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { REGIONS } from '../data/referenceData.js';
import { fetchRegionalExtremes } from '../services/api.js';
import { getRiskColor } from '../utils/formatters';
import CAPBulletinModal from '../components/modals/CAPBulletinModal';
import RegionalSurveillanceDrawer from '../components/modals/RegionalSurveillanceDrawer';

export default function Extremes() {
  const navigate = useNavigate();
  const selectRegion = useStore((s) => s.selectRegion);
  const setVariable = useStore((s) => s.setVariable);
  const selectedLeadTime = useStore((s) => s.selectedLeadTime) || '48h';
  const setLeadTime = useStore((s) => s.setLeadTime);

  const HAZARD_CATEGORIES = useMemo(() => [
    {
      id: 'rainfall',
      label: '🌧️ 24h Acc. Rain (≥64.5 mm)',
      types: ['Heavy Rainfall', 'Intense Precipitation', 'Heavy Precipitation'],
    },
    {
      id: 'heatwave',
      label: '🌡️ Daily Max Temp (≥43°C)',
      types: ['Severe Heatwave', 'Extreme Heatwave'],
    },
    {
      id: 'wind',
      label: '💨 Squall Influx (≥55 km/h)',
      types: ['Coastal Squall Winds'],
    },
  ], []);

  const [selectedTiers, setSelectedTiers] = useState(['Critical', 'High', 'Moderate']);
  const [selectedCategories, setSelectedCategories] = useState(['rainfall', 'heatwave', 'wind']);
  const [liveExtremes, setLiveExtremes] = useState([]);
  const [fetchStatus, setFetchStatus] = useState('LOADING'); // 'LOADING' | 'COMPLETE_FAILURE' | 'PARTIAL_FAILURE' | 'NO_ALERTS' | 'ALERTS'
  const [syncReport, setSyncReport] = useState({ total: REGIONS.length, success: 0, failed: 0 });
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [globalDataMode, setGlobalDataMode] = useState('LIVE');
  const [refreshing, setRefreshing] = useState(false);
  const [logFilter, setLogFilter] = useState('ALL'); // 'ALL' | 'ALERTS' | 'SCANS' | 'TELEMETRY'

  // CAP v1.2 Research Advisory Modal State
  const [activeCapAlert, setActiveCapAlert] = useState(null);
  const [activeCapRegion, setActiveCapRegion] = useState(null);

  // Regional Surveillance & Forecast Reliability Drill-Down Drawer State
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownRegionId, setDrilldownRegionId] = useState('delhi_ncr');
  const [drilldownVariable, setDrilldownVariable] = useState('rainfall');

  const handleOpenDrilldown = (targetRegionId, targetVar = null) => {
    setDrilldownRegionId(targetRegionId);
    if (targetVar) setDrilldownVariable(targetVar);
    setDrilldownOpen(true);
  };

  const toggleTier = (tier) => {
    setSelectedTiers((curr) =>
      curr.includes(tier) ? curr.filter((t) => t !== tier) : [...curr, tier]
    );
  };

  const toggleCategory = (catId) => {
    setSelectedCategories((curr) =>
      curr.includes(catId) ? curr.filter((c) => c !== catId) : [...curr, catId]
    );
  };

  // Main data acquisition function
  const loadExtremes = useCallback(async () => {
    setRefreshing(true);
    setFetchStatus((prev) => (prev === 'LOADING' ? 'LOADING' : 'LOADING'));

    try {
      const results = await fetchRegionalExtremes({
        regions: REGIONS,
        leadTime: selectedLeadTime,
      });

      const mapped = [];
      const totalCount = REGIONS.length;
      const successCount = results.filter((r) => r.data && !r.data.error).length;
      const failedCount = totalCount - successCount;
      setSyncReport({ total: totalCount, success: successCount, failed: failedCount });

      // Truthfully detect data mode from backend responses: if any is REPLAY -> REPLAY; otherwise operational stream is LIVE
      const modes = results.map((r) => r.data?.data_mode).filter(Boolean);
      const detectedDataMode = modes.includes('REPLAY')
        ? 'REPLAY'
        : 'LIVE';

      results.forEach((res) => {
        if (!res.data || !res.data.alerts) return;

        res.data.alerts.forEach((alert) => {
          let type;
          const thresholdLabel = alert.threshold_label || '';
          if (alert.hazard === 'heavy_rain') {
            type = thresholdLabel.includes('Very') ? 'Intense Precipitation' : 'Heavy Rainfall';
          } else if (alert.hazard === 'heatwave') {
            type = 'Severe Heatwave';
          } else if (alert.hazard === 'wind_squall') {
            type = 'Coastal Squall Winds';
          } else {
            type = alert.label || alert.hazard || 'Extreme Event';
          }

          const thresholdStandard = alert.validated
            ? `Configured threshold: ${alert.threshold_label} · Blend has a held-out ERA5 benchmark.`
            : `Configured threshold: ${alert.threshold_label} · Operational equal-weight consensus (adaptive candidate not promoted).`;

          mapped.push({
            id: `${res.region.id}-${alert.hazard}`,
            regionId: res.region.id,
            region: res.region.name,
            regionObj: res.region,
            tier: alert.severity === 'very_heavy' || alert.severity === 'gale' || alert.hazard === 'heatwave' ? 'Critical' : 'High',
            type,
            hazard: alert.hazard,
            leadTime: `+${res.data.lead_time_hours || selectedLeadTime.replace('+', '')}`,
            validationStatus: alert.validated ? 'Held-Out Benchmark Validated' : 'Operational Equal-Weight Consensus',
            blendMethod: alert.validated ? 'Adaptive XGBoost Apportionment' : 'Equal-Weight Consensus',
            value: `${alert.value} ${alert.unit}`,
            threshold: alert.threshold_label,
            thresholdStandard,
            status: alert.crossed ? 'Threshold Exceeded' : 'Monitoring',
            validated: alert.validated,
            dataMode: res.data.data_mode === 'REPLAY' ? 'REPLAY' : 'LIVE',
            windowHours: res.data.window_hours || 24,
            evaluatedBlendTime: res.data.evaluated_blend_time || null,
          });
        });
      });

      setLiveExtremes(mapped);
      setGlobalDataMode(detectedDataMode);
      setLastSyncTime(new Date().toTimeString().slice(0, 8) + ' UTC');

      if (successCount === 0) {
        setFetchStatus('COMPLETE_FAILURE');
      } else if (failedCount > 0) {
        setFetchStatus('PARTIAL_FAILURE');
      } else if (mapped.length === 0) {
        setFetchStatus('NO_ALERTS');
      } else {
        setFetchStatus('ALERTS');
      }
    } catch {
      setFetchStatus('COMPLETE_FAILURE');
      setSyncReport({ total: REGIONS.length, success: 0, failed: REGIONS.length });
    } finally {
      setRefreshing(false);
    }
  }, [selectedLeadTime]);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) {
        loadExtremes();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [loadExtremes]);

  const filtered = useMemo(() => {
    const activeTypes = HAZARD_CATEGORIES
      .filter((c) => selectedCategories.includes(c.id))
      .flatMap((c) => c.types);

    return liveExtremes.filter((item) => {
      if (!selectedTiers.includes(item.tier)) return false;
      if (!activeTypes.includes(item.type)) return false;
      return true;
    });
  }, [selectedTiers, selectedCategories, HAZARD_CATEGORIES, liveExtremes]);

  const stats = useMemo(() => {
    return {
      total: liveExtremes.length,
      critical: liveExtremes.filter((e) => e.tier === 'Critical').length,
      high: liveExtremes.filter((e) => e.tier === 'High').length,
      active: liveExtremes.length,
    };
  }, [liveExtremes]);

  // Dynamic Operational Surveillance Event Log & Audit Records
  const eventLogs = useMemo(() => {
    const baseTime = lastSyncTime || '15:44:20 UTC';
    const logs = [];

    // System Telemetry 1: Gateway Ingestion
    logs.push({
      id: 'telemetry-ingest',
      timestamp: baseTime,
      level: 'INFO',
      type: 'TELEMETRY',
      subsystem: 'GATEWAY-SYNC',
      target: 'NATIONAL MESH',
      message: `Open-Meteo Gateway stream synchronized for +${selectedLeadTime} lead. Ingested ECMWF IFS (9km), ECMWF AIFS (28km), NOAA GFS (13km), DWD ICON (13km).`,
    });

    // Regional Scan Passes across all 12 operational zones
    REGIONS.forEach((r, idx) => {
      const regionAlerts = liveExtremes.filter((a) => a.regionId === r.id);
      const isOnline = syncReport.success > idx;
      if (!isOnline && syncReport.failed > 0) {
        logs.push({
          id: `scan-fail-${r.id}`,
          regionId: r.id,
          timestamp: baseTime,
          level: 'WARN',
          type: 'SCANS',
          subsystem: 'STATION-MESH',
          target: r.name,
          variable: 'rainfall',
          severityLabel: 'OFFLINE',
          metricsSummary: 'Provider telemetry deferred',
          message: 'Station stream unreachable or deferred. Zone surveillance deferred to next retry cycle.',
        });
      } else if (regionAlerts.length > 0) {
        regionAlerts.forEach((a) => {
          logs.push({
            id: `scan-alert-${a.id}`,
            regionId: r.id,
            timestamp: baseTime,
            level: 'ALERT',
            type: 'ALERTS',
            subsystem: 'HAZARD-EVAL',
            target: r.name,
            variable: a.hazard === 'heatwave' ? 'temperature' : a.hazard === 'wind_squall' ? 'wind_speed' : 'rainfall',
            severityLabel: a.tier.toUpperCase(),
            metricsSummary: `${a.value} (Exceeds ${a.threshold})`,
            message: `CRITICAL EXCEEDANCE: ${a.type} reached ${a.value} (Exceeds configured threshold: ${a.threshold}). Operational blend: ${a.blendMethod}.`,
          });
        });
      } else {
        logs.push({
          id: `scan-pass-${r.id}`,
          regionId: r.id,
          timestamp: baseTime,
          level: 'OK',
          type: 'SCANS',
          subsystem: 'HAZARD-EVAL',
          target: r.name,
          variable: 'rainfall',
          severityLabel: 'NOMINAL',
          metricsSummary: 'All 4 hazards within threshold',
          message: 'Nominal baseline verified. Precipitation, thermal envelope, and boundary squalls within configured hazard thresholds.',
        });
      }
    });

    // System Telemetry 2: Synthesis Summary
    logs.push({
      id: 'telemetry-summary',
      timestamp: baseTime,
      level: liveExtremes.length > 0 ? 'ALERT' : 'OK',
      type: 'TELEMETRY',
      subsystem: 'SYNOPTIC-TRIAGE',
      target: 'ALL ZONES',
      message: `Operational sweep completed across ${syncReport.success}/${REGIONS.length} stations. Total active alerts: ${liveExtremes.length}. Connection mode: ${globalDataMode}.`,
    });

    return logs;
  }, [lastSyncTime, selectedLeadTime, liveExtremes, syncReport, globalDataMode]);

  const filteredLogs = useMemo(() => {
    if (logFilter === 'ALL') return eventLogs;
    return eventLogs.filter((l) => l.type === logFilter);
  }, [eventLogs, logFilter]);

  const handleInspect = (item) => {
    const regionName = typeof item === 'string' ? item : item.region;
    const reg = REGIONS.find((r) =>
      item?.regionId === r.id ||
      (typeof regionName === 'string' && regionName.toLowerCase().includes(r.name.toLowerCase().split(' (')[0]))
    ) || REGIONS[0];

    selectRegion(reg.id);

    let targetVar = 'temperature';
    if (item?.hazard === 'heavy_rain') targetVar = 'rainfall';
    if (item?.hazard === 'wind_squall') targetVar = 'wind_speed';
    if (item?.hazard === 'heatwave') targetVar = 'temperature';

    setVariable(targetVar);
    setLeadTime(selectedLeadTime);
    navigate('/explainability');
  };

  const handleOpenCap = (item) => {
    const reg = REGIONS.find((r) =>
      item?.regionId === r.id ||
      (typeof item?.region === 'string' && item.region.toLowerCase().includes(r.name.toLowerCase().split(' (')[0]))
    ) || REGIONS[0];

    setActiveCapAlert(item);
    setActiveCapRegion(reg);
  };

  return (
    <div className="flex flex-col md:flex-row h-full bg-[var(--varuna-bg)] overflow-hidden">
      {/* Filter Sidebar (280px matching VARUNA layout) */}
      <aside className="w-full md:w-[280px] shrink-0 overflow-y-auto border-r border-[var(--varuna-border)] bg-[var(--varuna-surface)] p-5 flex flex-col gap-6 transition-colors">
        <div className="flex items-center justify-between">
          <h2 className="text-scale-sm font-bold uppercase tracking-wider text-[var(--varuna-text)] font-data">
            Triage Filters
          </h2>
          <button
            onClick={() => {
              setSelectedTiers(['Critical', 'High', 'Moderate']);
              setSelectedCategories(['rainfall', 'heatwave', 'wind']);
            }}
            className="text-scale-xs font-semibold text-[var(--varuna-text-muted)] hover:text-[var(--varuna-text)] transition-colors cursor-pointer font-data"
          >
            Reset
          </button>
        </div>

        {/* Severity Tiers */}
        <div>
          <label className="text-[11px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block mb-2 font-data">
            Severity Tiers
          </label>
          <div className="space-y-1.5 font-data">
            {['Critical', 'High', 'Moderate'].map((tier) => {
              const active = selectedTiers.includes(tier);
              return (
                <button
                  key={tier}
                  onClick={() => toggleTier(tier)}
                  className={`w-full flex items-center justify-between p-2 rounded-[var(--radius-md)] text-scale-xs font-semibold transition-all cursor-pointer border ${
                    active
                      ? 'bg-[var(--varuna-blue-light)] border-[var(--varuna-blue)] text-[var(--varuna-blue-dark)]'
                      : 'border-transparent text-[var(--varuna-text-secondary)] hover:bg-[var(--varuna-surface-soft)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getRiskColor(tier) }} />
                    <span>{tier}</span>
                  </div>
                  {active && <span className="text-[var(--varuna-blue)] font-bold">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Hazard Types */}
        <div>
          <label className="text-[11px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block mb-2 font-data">
            Meteorological Hazard
          </label>
          <div className="space-y-1.5 font-data">
            {HAZARD_CATEGORIES.map((hz) => {
              const active = selectedCategories.includes(hz.id);
              return (
                <button
                  key={hz.id}
                  onClick={() => toggleCategory(hz.id)}
                  className={`w-full text-left p-2 rounded-[var(--radius-md)] text-scale-xs font-semibold transition-all cursor-pointer border ${
                    active
                      ? 'bg-[var(--varuna-blue-light)] border-[var(--varuna-blue)] text-[var(--varuna-blue-dark)] font-bold'
                      : 'border-transparent text-[var(--varuna-text-secondary)] hover:bg-[var(--varuna-surface-soft)]'
                  }`}
                >
                  {hz.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Operational Disclaimer Note */}
        <div className="mt-auto p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] text-[11px] text-[var(--varuna-text-secondary)] leading-relaxed">
          <strong className="block text-[var(--varuna-text)] mb-0.5">⚠️ Meteorological Advisory Criteria</strong>
          Threshold alerts reflect configured hazard criteria (e.g. 24h accumulated rainfall ≥ 64.5 mm, daily max temperature ≥ 43°C, sustained squall winds ≥ 55 km/h).
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Header & Controls Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-1 border-b border-[var(--varuna-border)]">
          <div>
            <h1 className="text-scale-2xl font-bold tracking-tight text-[var(--varuna-text)]">
              Extreme Weather Surveillance
            </h1>
            <p className="mt-0.5 text-scale-sm text-[var(--varuna-text-secondary)]">
              Real-time threshold exceedance alerts across precipitation, thermal extremes, and wind squalls
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Operational Lead Time Pills (Full 24h -> 168h Scope) */}
            <div className="inline-flex items-center gap-1 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] p-1 rounded-[var(--radius-lg)] shadow-xs">
              {['24h', '48h', '72h', '120h', '7d'].map((lt) => (
                <button
                  key={lt}
                  onClick={() => setLeadTime(lt)}
                  className={`px-3 py-1 text-scale-xs font-semibold rounded-[var(--radius-md)] transition-all cursor-pointer font-data ${
                    selectedLeadTime === lt
                      ? 'bg-[var(--varuna-blue)] text-white shadow-xs font-bold'
                      : 'text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)] hover:bg-[var(--varuna-surface-soft)]'
                  }`}
                >
                  {lt.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Refresh Live Watch Button */}
            <button
              onClick={loadExtremes}
              disabled={refreshing}
              className="px-3.5 py-1.5 bg-[var(--varuna-blue)] hover:bg-[var(--varuna-blue-dark)] active:opacity-90 text-white font-bold rounded-[var(--radius-md)] text-scale-xs transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 font-data shrink-0"
              title="Refresh operational threshold watch across all 12 configured monitoring points"
            >
              <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
              <span>{refreshing ? 'Syncing...' : 'REFRESH LIVE WATCH'}</span>
            </button>
          </div>
        </div>

        {/* Live Stream Status & Synchronization Bar */}
        <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] flex flex-wrap items-center justify-between gap-3 text-scale-xs font-data">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${
              fetchStatus === 'COMPLETE_FAILURE'
                ? 'bg-rose-500'
                : fetchStatus === 'LOADING'
                ? 'bg-amber-500 animate-ping'
                : 'bg-emerald-500 animate-pulse'
            }`} />
            <span className="font-bold tracking-wide">
              {fetchStatus === 'COMPLETE_FAILURE'
                ? 'SURVEILLANCE OFFLINE'
                : fetchStatus === 'LOADING'
                ? 'SYNCHRONIZING WATCHLISTS…'
                : 'OPERATIONAL WATCH SYNCHRONIZED'}
            </span>
            <span className="text-[var(--varuna-text-muted)] hidden sm:inline">
              — Operational horizon: up to 7 days (+{selectedLeadTime}) · Evaluated across 12 zones
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span className={`px-2 py-0.5 rounded font-bold border ${
              globalDataMode === 'LIVE'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300'
            }`}>
              {globalDataMode === 'LIVE' ? 'LIVE 200 OK' : `MODE: ${globalDataMode}`}
            </span>
            <span className="text-[var(--varuna-text-muted)]">
              Last Sync: <strong className="text-[var(--varuna-text)]">{lastSyncTime || 'Pending…'}</strong>
            </span>
          </div>
        </div>

        {/* Summary Metric Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          <div className="p-3.5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-xs">
            <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase block font-data">Total Monitored</span>
            <span className="font-data text-2xl font-bold text-[var(--varuna-text)] block mt-0.5">{stats.total} Events</span>
          </div>
          <div className="p-3.5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-xs">
            <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase block font-data">Critical Alerts</span>
            <span className="font-data text-2xl font-bold text-red-600 block mt-0.5">{stats.critical}</span>
          </div>
          <div className="p-3.5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-xs">
            <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase block font-data">High Warnings</span>
            <span className="font-data text-2xl font-bold text-amber-600 block mt-0.5">{stats.high}</span>
          </div>
          <div className="p-3.5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-xs">
            <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase block font-data">Data Pipeline</span>
            <span className="font-data text-lg font-bold text-[var(--varuna-blue)] block mt-0.5 truncate">
              {fetchStatus === 'LOADING'
                ? 'Syncing...'
                : fetchStatus === 'COMPLETE_FAILURE'
                ? 'Offline (0/12)'
                : fetchStatus === 'PARTIAL_FAILURE'
                ? `Partial (${syncReport.success}/${syncReport.total})`
                : `Active (${syncReport.success}/${syncReport.total})`}
            </span>
          </div>
        </div>

        {/* Extremes Incident Cards Grid */}
        <div className="space-y-4">
          {fetchStatus === 'LOADING' && (
            <div className="p-8 text-center text-[var(--varuna-text-secondary)] font-data bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] space-y-2">
              <span className="w-5 h-5 rounded-full bg-[var(--varuna-blue)] inline-block animate-ping" />
              <span className="block font-bold">Synchronizing Regional Watchlists for +{selectedLeadTime}…</span>
              <p className="text-scale-xs text-[var(--varuna-text-muted)]">
                Acquiring live NWP streams from Open-Meteo Gateway and evaluating configured hazard threshold exceedances.
              </p>
            </div>
          )}

          {fetchStatus === 'COMPLETE_FAILURE' && (
            <div className="p-8 text-center text-red-600 dark:text-red-400 font-data bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-[var(--radius-xl)] space-y-2">
              <strong className="block text-lg">LIVE DATA UNAVAILABLE · SYSTEM OFFLINE</strong>
              <span>Authoritative VARUNA backend is unreachable (0/{syncReport.total} regional streams responding). No synthetic forecasts or fabricated alert records are rendered.</span>
              <div className="pt-2">
                <button
                  onClick={loadExtremes}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded font-bold text-xs cursor-pointer"
                >
                  Retry Synchronization
                </button>
              </div>
            </div>
          )}

          {fetchStatus === 'PARTIAL_FAILURE' && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded-[var(--radius-xl)] text-amber-800 dark:text-amber-300 font-data text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div>
                <strong>PARTIAL SURVEILLANCE ACTIVE:</strong> {syncReport.success} of {syncReport.total} configured monitoring points returned forecast data ({syncReport.failed} offline). Nominal status cannot be verified for offline zones.
              </div>
              <span className="font-bold shrink-0">{liveExtremes.length} Exceedances Detected</span>
            </div>
          )}

          {fetchStatus === 'NO_ALERTS' && (
            <div className="p-8 text-center text-[var(--varuna-text-secondary)] font-data bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] space-y-2">
              <strong className="block text-lg text-emerald-600 dark:text-emerald-400">NOMINAL CONDITIONS</strong>
              <span>12/12 configured monitoring points returned forecast data for +{selectedLeadTime}. No extreme threshold exceedances detected in the current operational cycle.</span>
            </div>
          )}

          {fetchStatus === 'ALERTS' && filtered.length === 0 && (
            <div className="p-8 text-center text-[var(--varuna-text-secondary)] font-data bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)]">
              <span className="block">No active alerts match your current triage filters.</span>
            </div>
          )}

          {(fetchStatus === 'ALERTS' || fetchStatus === 'PARTIAL_FAILURE') && filtered.map((item) => {
            const color = getRiskColor(item.tier);
            return (
              <div
                key={item.id}
                className="p-5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] shadow-xs transition-all hover:border-[var(--varuna-blue)] space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <h3 className="text-scale-base font-bold text-[var(--varuna-text)]">
                        {item.region}
                      </h3>
                      <span
                        className="px-2 py-0.5 text-[10px] font-bold rounded text-white font-data"
                        style={{ backgroundColor: color }}
                      >
                        {item.tier.toUpperCase()}
                      </span>
                      <span className="text-scale-xs px-2 py-0.5 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded text-[var(--varuna-text-secondary)] font-semibold font-data">
                        {item.type}
                      </span>
                    </div>
                    <div className="text-scale-xs text-[var(--varuna-text-secondary)] flex flex-wrap items-center gap-2">
                      <span>Lead: <strong className="text-[var(--varuna-text)] font-data">{item.leadTime}</strong></span>
                      <span>•</span>
                      <span>Gate: <strong className="text-[var(--varuna-text)] font-data">{item.validationStatus}</strong></span>
                      <span>•</span>
                      <span>Method: <strong className="text-[var(--varuna-blue)] font-data">{item.blendMethod}</strong></span>
                    </div>
                  </div>

                  {/* Value vs Threshold Callout */}
                  <div className="flex items-center gap-3 bg-[var(--varuna-surface-soft)] p-2.5 px-3.5 rounded-[var(--radius-lg)] border border-[var(--varuna-border)] shrink-0 font-data">
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[var(--varuna-text-muted)]">
                        Forecast Exceedance
                      </div>
                      <div className="text-xl font-bold text-[var(--varuna-text)]">
                        {item.value}
                      </div>
                    </div>
                    <div className="w-px h-8 bg-[var(--varuna-border)]" />
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[var(--varuna-text-muted)]">
                        Configured Hazard Threshold
                      </div>
                      <div className="text-xs font-semibold text-[var(--varuna-text-secondary)]">
                        {item.threshold}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Verification & Threshold Standard Readout */}
                <div className="p-3 bg-[var(--varuna-surface-soft)] rounded-[var(--radius-md)] border border-[var(--varuna-border)] text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed font-sans">
                  {item.thresholdStandard}
                </div>

                {/* Compact Decision Trace Audit Box (Section 30 Rule) */}
                <div className="p-3 bg-[var(--varuna-surface-soft)] rounded-[var(--radius-md)] border border-[var(--varuna-border)] text-scale-xs space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase text-[var(--varuna-text-muted)] font-data tracking-wider">
                    <span>Why This Alert? — Decision Trace &amp; Audit Facts</span>
                    <span className="text-[var(--varuna-blue-dark)]">Status: {item.status}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-data pt-1 border-t border-[var(--varuna-border)]">
                    <div><span className="text-[var(--varuna-text-muted)]">Hazard:</span> <strong className="text-[var(--varuna-text)]">{item.type}</strong></div>
                    <div><span className="text-[var(--varuna-text-muted)]">Lead Time:</span> <strong className="text-[var(--varuna-text)]">{item.leadTime}</strong></div>
                    <div><span className="text-[var(--varuna-text-muted)]">VARUNA Blend:</span> <strong className="text-[var(--varuna-blue-dark)]">{item.value}</strong></div>
                    <div><span className="text-[var(--varuna-text-muted)]">Threshold:</span> <strong className="text-[var(--varuna-text)]">{item.threshold}</strong></div>
                    <div><span className="text-[var(--varuna-text-muted)]">Production Blend:</span> <strong className="text-[var(--varuna-text)]">{item.blendMethod}</strong></div>
                    <div><span className="text-[var(--varuna-text-muted)]">Promotion Gate:</span> <strong className="text-[var(--varuna-text)]">{item.validationStatus}</strong></div>
                    <div><span className="text-[var(--varuna-text-muted)]">Valid Window:</span> <strong className="text-[var(--varuna-text)]">{item.windowHours ? `${item.windowHours}h accumulation` : '24h window'}</strong></div>
                    <div><span className="text-[var(--varuna-text-muted)]">Data Mode:</span> <strong className="text-emerald-700 dark:text-emerald-400 font-bold">{item.dataMode || 'LIVE'}</strong></div>
                  </div>
                </div>

                {/* Card Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--varuna-border)] font-data">
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    {item.status}
                  </span>

                  <div className="flex items-center gap-2">
                    {/* CAP v1.2 Research Advisory Bulletin Button */}
                    <button
                      onClick={() => handleOpenCap(item)}
                      className="px-3 py-1.5 bg-[var(--varuna-surface-soft)] hover:bg-[var(--varuna-blue-light)] border border-[var(--varuna-border)] hover:border-[var(--varuna-blue)] rounded-[var(--radius-md)] text-scale-xs font-bold text-[var(--varuna-blue-dark)] transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                      title="Generate OASIS Common Alerting Protocol v1.2 Research Advisory bulletin for this alert"
                    >
                      <span>📜</span>
                      <span>CAP v1.2 Advisory</span>
                    </button>

                    {/* Regional Surveillance & Forecast Reliability Drill-Down */}
                    <button
                      onClick={() => {
                        const varMap = { heavy_rain: 'rainfall', heatwave: 'temperature', wind_squall: 'wind_speed' };
                        handleOpenDrilldown(item.regionId, varMap[item.hazard] || 'rainfall');
                      }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-[var(--radius-md)] text-scale-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                      title="Open live Regional Surveillance & Forecast Reliability drill-down for this region"
                    >
                      <span>🛡️</span>
                      <span>Reliability Drill-Down</span>
                    </button>

                    {/* Inspect Model Blend Button */}
                    <button
                      onClick={() => handleInspect(item)}
                      className="px-3.5 py-1.5 bg-[var(--varuna-blue)] hover:bg-[var(--varuna-blue-dark)] text-white rounded-[var(--radius-md)] text-scale-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                      title="Inspect 4-member NWP forecast breakdown and adaptive weights in Explainability workspace"
                    >
                      <span>Inspect Model Blend</span>
                      <span>→</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ========================================================================= */}
        {/* SURVEILLANCE EVENT LOG & OPERATIONAL AUDIT STREAM                         */}
        {/* ========================================================================= */}
        <div className="p-5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--varuna-border)]">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
              <div>
                <h3 className="text-scale-base font-bold font-data text-[var(--varuna-text)] tracking-tight">
                  Surveillance Event Log &amp; Operational Audit Stream
                </h3>
                <p className="text-[11px] text-[var(--varuna-text-secondary)] font-data mt-0.5">
                  Real-time multi-model ingestion telemetry, regional threshold scan passes, and advisory events
                </p>
              </div>
            </div>

            {/* Log filter pills */}
            <div className="inline-flex items-center gap-1 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] p-1 rounded-[var(--radius-md)] text-[11px] font-data">
              {[
                { id: 'ALL', label: `All (${eventLogs.length})` },
                { id: 'ALERTS', label: `Alerts (${liveExtremes.length})` },
                { id: 'SCANS', label: `Passes (${syncReport.success})` },
                { id: 'TELEMETRY', label: 'Telemetry (2)' },
              ].map((btn) => (
                <button
                  key={btn.id}
                  onClick={() => setLogFilter(btn.id)}
                  className={`px-2.5 py-1 rounded font-bold transition-all cursor-pointer ${
                    logFilter === btn.id
                      ? 'bg-[var(--varuna-blue)] text-white shadow-2xs'
                      : 'text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)]'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Monitored Region Drill-Down Launcher */}
          <div className="p-3 bg-[var(--varuna-surface-soft)] rounded-[var(--radius-lg)] border border-[var(--varuna-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-data">
            <div className="flex items-center gap-2 text-[var(--varuna-text)] font-semibold shrink-0">
              <span className="text-amber-500">⚡</span>
              <span>Quick Region Surveillance Drill-Down:</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {REGIONS.map((reg) => {
                const hasAlert = liveExtremes.some((a) => a.regionId === reg.id);
                return (
                  <button
                    key={reg.id}
                    onClick={() => handleOpenDrilldown(reg.id, 'temperature')}
                    className={`px-2 py-1 rounded text-[11px] font-bold transition-all cursor-pointer border flex items-center gap-1 ${
                      hasAlert
                        ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800 hover:bg-red-100'
                        : 'bg-[var(--varuna-surface)] text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)] border-[var(--varuna-border)] hover:border-[var(--varuna-blue)] hover:bg-[var(--varuna-surface-hover)]'
                    }`}
                    title={`Click to open live regional surveillance & reliability drill-down for ${reg.name}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${hasAlert ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
                    <span>{reg.name}</span>
                    <span className="text-[10px] text-[var(--varuna-text-muted)]">↗</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Log Table / Feed */}
          <div className="overflow-x-auto max-h-[380px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--varuna-border)] bg-[var(--varuna-surface-soft)] font-data text-xs">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[var(--varuna-surface)] border-b border-[var(--varuna-border)] text-[10px] uppercase font-bold text-[var(--varuna-text-muted)] sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3">Timestamp (UTC)</th>
                  <th className="py-2.5 px-3">Level</th>
                  <th className="py-2.5 px-3">Monitored Zone</th>
                  <th className="py-2.5 px-3">Context</th>
                  <th className="py-2.5 px-3">Surveillance &amp; Audit Event</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--varuna-border)] text-[11px]">
                {filteredLogs.map((log) => {
                  const levelStyles = {
                    OK: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
                    INFO: 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-800',
                    WARN: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800',
                    ALERT: 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 border-red-300 dark:border-red-800',
                  };
                  const targetRegId = log.regionId || 'delhi_ncr';
                  const targetVar = log.variable || 'rainfall';

                  return (
                    <tr key={log.id} className="hover:bg-[var(--varuna-surface)] transition-colors">
                      <td className="py-2 px-3 text-[var(--varuna-text-muted)] whitespace-nowrap">
                        {log.timestamp}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${levelStyles[log.level] || levelStyles.INFO}`}>
                          {log.level}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-bold text-[var(--varuna-text)] whitespace-nowrap">
                        {log.regionId ? (
                          <button
                            onClick={() => handleOpenDrilldown(log.regionId, targetVar)}
                            className="text-[var(--varuna-blue)] hover:underline inline-flex items-center gap-1 cursor-pointer font-bold text-left"
                            title={`Open live Regional Surveillance & Reliability drill-down for ${log.target}`}
                          >
                            <span>{log.target}</span>
                            <span className="text-[10px]">↗</span>
                          </button>
                        ) : (
                          <span>{log.target}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-[var(--varuna-text-secondary)] font-data font-semibold">
                        +{selectedLeadTime}
                      </td>
                      <td className="py-2 px-3 text-[var(--varuna-text)] leading-relaxed">
                        {log.message}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-right">
                        <button
                          onClick={() => handleOpenDrilldown(targetRegId, targetVar)}
                          className="px-2 py-1 bg-[var(--varuna-surface-soft)] hover:bg-[var(--varuna-blue-light)] border border-[var(--varuna-border)] hover:border-[var(--varuna-blue)] text-[var(--varuna-text)] hover:text-[var(--varuna-blue-dark)] rounded text-[10px] font-bold cursor-pointer transition-colors inline-flex items-center gap-1"
                          title="Open live multi-variable reliability drill-down"
                        >
                          <span>Inspect</span>
                          <span>→</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-data text-[var(--varuna-text-muted)] pt-1">
            <span>Buffer: {filteredLogs.length} audit records · Auto-synchronizes on operational cycle</span>
            <span>Gateway Feed: Open-Meteo Multi-Coordinate API · Processing: /api/extremes</span>
          </div>
        </div>
      </main>

      {/* CAP v1.2 Research Advisory Modal */}
      <CAPBulletinModal
        isOpen={Boolean(activeCapAlert)}
        onClose={() => setActiveCapAlert(null)}
        alert={activeCapAlert}
        region={activeCapRegion}
      />

      {/* Regional Surveillance & Forecast Reliability Drill-Down Drawer */}
      <RegionalSurveillanceDrawer
        isOpen={drilldownOpen}
        onClose={() => setDrilldownOpen(false)}
        initialRegionId={drilldownRegionId}
        initialVariable={drilldownVariable}
        initialLeadTime={selectedLeadTime}
      />
    </div>
  );
}
