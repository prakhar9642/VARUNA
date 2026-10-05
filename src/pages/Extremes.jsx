import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { REGIONS } from '../data/mockData.js';
import { fetchExtremes } from '../services/api.js';
import { getRiskColor } from '../utils/formatters';

export default function Extremes() {
  const selectRegion = useStore((s) => s.selectRegion);

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

  useEffect(() => {
    let active = true;
    Promise.all(
      REGIONS.map(r => 
        fetchExtremes({ region: r.id, leadTime: '48h' })
          .then(data => ({ region: r, data, error: null }))
          .catch(error => ({ region: r, data: null, error: error?.message || 'Request failed' }))
      )
    ).then(results => {
      if (!active) return;
      const mapped = [];
      const totalCount = REGIONS.length;
      const successCount = results.filter(r => r.data && !r.data.error).length;
      const failedCount = totalCount - successCount;
      setSyncReport({ total: totalCount, success: successCount, failed: failedCount });

      results.forEach(res => {
        if (!res.data || !res.data.alerts) return;
        res.data.alerts.forEach(alert => {
          let type = '';
          if (alert.hazard === 'heavy_rain') type = alert.threshold_label.includes('Very') ? 'Intense Precipitation' : 'Heavy Rainfall';
          if (alert.hazard === 'heatwave') type = 'Severe Heatwave';
          if (alert.hazard === 'wind_squall') type = 'Coastal Squall Winds';
          
          const thresholdStandard = alert.validated
            ? `Threshold standard: ${alert.threshold_label} · Blend has a held-out ERA5 benchmark.`
            : `Threshold standard: ${alert.threshold_label} · Operational equal-weight consensus; held-out ML validation not passed.`;

          mapped.push({
            id: res.region.id + '-' + alert.hazard,
            region: res.region.name,
            tier: alert.severity === 'very_heavy' || alert.severity === 'gale' || alert.hazard === 'heatwave' ? 'Critical' : 'High',
            type: type,
            hazard: alert.hazard,
            leadTime: `+${res.data.lead_time_hours || 48}h`,
            validationStatus: alert.validated ? 'Held-Out Benchmark Validated' : 'Operational Consensus (Unvalidated)',
            blendMethod: alert.validated ? 'Adaptive XGBoost Apportionment' : 'Equal-Weight Consensus',
            value: alert.value + ' ' + alert.unit,
            threshold: alert.threshold_label,
            thresholdStandard,
            status: alert.crossed ? 'Threshold Exceeded' : 'Monitoring',
            validated: alert.validated,
          });
        });
      });
      setLiveExtremes(mapped);

      if (successCount === 0) {
        setFetchStatus('COMPLETE_FAILURE');
      } else if (failedCount > 0) {
        setFetchStatus('PARTIAL_FAILURE');
      } else if (mapped.length === 0) {
        setFetchStatus('NO_ALERTS');
      } else {
        setFetchStatus('ALERTS');
      }
    });
    return () => { active = false; };
  }, []);

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

  const handleInspect = (regionName) => {
    const reg = REGIONS.find((r) => regionName.toLowerCase().includes(r.name.toLowerCase().split(' (')[0]));
    if (reg) {
      selectRegion(reg.id);
    } else {
      selectRegion(REGIONS[0].id);
    }
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
          <div className="space-y-1.5">
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

        {/* Confidence Filter */}


        {/* Operational Disclaimer Note (Section 13 Rule) */}
        <div className="mt-auto p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] text-[11px] text-[var(--varuna-text-secondary)] leading-relaxed">
          <strong className="block text-[var(--varuna-text)] mb-0.5">⚠️ Meteorological Advisory Criteria</strong>
          Threshold alerts reflect operational meteorological criteria based on IMD standard classifications (e.g. 24h accumulated rainfall ≥ 64.5 mm, daily max temperature ≥ 43°C, sustained squall winds ≥ 55 km/h).
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-scale-2xl font-bold tracking-tight text-[var(--varuna-text)]">
              Extreme Weather Surveillance
            </h1>
            <p className="mt-0.5 text-scale-sm text-[var(--varuna-text-secondary)]">
              Real-time threshold exceedance alerts across precipitation, thermal extremes, and wind squalls
            </p>
          </div>
          <span className={`self-start sm:self-auto font-data text-scale-xs px-3 py-1 rounded-full border font-bold ${
            fetchStatus === 'COMPLETE_FAILURE'
              ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-300'
              : fetchStatus === 'PARTIAL_FAILURE'
              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300'
              : stats.total > 0
              ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400'
              : fetchStatus === 'NO_ALERTS'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
          }`}>
            {fetchStatus === 'LOADING'
              ? '● SYNCING WATCHLISTS…'
              : fetchStatus === 'COMPLETE_FAILURE'
              ? '● SYSTEM OFFLINE'
              : fetchStatus === 'PARTIAL_FAILURE'
              ? `● ${stats.total} ALERTS (${syncReport.failed} REGIONS OFFLINE)`
              : stats.total > 0
              ? `● ${stats.total} ACTIVE THRESHOLD EXCEEDANCES`
              : '● 0 ALERTS (NOMINAL)'}
          </span>
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
                ? 'Connecting...'
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
            <div className="p-8 text-center text-[var(--varuna-text-secondary)] font-data bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)]">
              <span className="animate-pulse block">Synchronizing Regional Watchlists...</span>
            </div>
          )}

          {fetchStatus === 'COMPLETE_FAILURE' && (
            <div className="p-8 text-center text-red-600 dark:text-red-400 font-data bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-[var(--radius-xl)]">
              <strong className="block text-lg mb-1">DATA UNAVAILABLE · SYSTEM OFFLINE</strong>
              <span>Authoritative VARUNA backend is unreachable (0/{syncReport.total} regional streams responding). Surveillance paused.</span>
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

          {fetchStatus === 'PARTIAL_FAILURE' && filtered.length === 0 && (
            <div className="p-8 text-center text-amber-700 dark:text-amber-400 font-data bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900 rounded-[var(--radius-xl)]">
              <strong className="block text-lg mb-1">PARTIAL SURVEILLANCE DATA</strong>
              <span>0 threshold exceedances detected across the {syncReport.success} reporting points. Full network nominal status cannot be verified while {syncReport.failed} points are offline.</span>
            </div>
          )}

          {fetchStatus === 'NO_ALERTS' && (
            <div className="p-8 text-center text-[var(--varuna-text-secondary)] font-data bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)]">
              <strong className="block text-lg mb-1 text-emerald-600 dark:text-emerald-400">NOMINAL CONDITIONS</strong>
              <span>12/12 configured monitoring points returned forecast data. No extreme threshold exceedances detected in the current operational cycle.</span>
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
                className="p-5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] shadow-xs transition-all hover:border-[var(--varuna-blue)]"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
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
                    <div className="text-scale-xs text-[var(--varuna-text-secondary)] flex items-center gap-2">
                      <span>Lead Time: <strong className="text-[var(--varuna-text)] font-data">{item.leadTime}</strong></span>
                      <span>•</span>
                      <span>Validation Status: <strong className="text-[var(--varuna-text)] font-data">{item.validationStatus}</strong></span>
                      <span>•</span>
                      <span>Blend Method: <strong className="text-[var(--varuna-blue)] font-data">{item.blendMethod}</strong></span>
                    </div>
                  </div>

                  {/* Value vs Threshold Callout */}
                  <div className="flex items-center gap-3 bg-[var(--varuna-surface-soft)] p-2.5 px-3.5 rounded-[var(--radius-lg)] border border-[var(--varuna-border)] shrink-0">
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[var(--varuna-text-muted)] font-data">
                        Forecast Exceedance
                      </div>
                      <div className="font-data text-xl font-bold text-[var(--varuna-text)]">
                        {item.value}
                      </div>
                    </div>
                    <div className="w-px h-8 bg-[var(--varuna-border)]" />
                    <div>
                      <div className="text-[10px] font-bold uppercase text-[var(--varuna-text-muted)] font-data">
                        IMD Advisory Standard
                      </div>
                      <div className="font-data text-xs font-semibold text-[var(--varuna-text-secondary)]">
                        {item.threshold}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Verification & Threshold Standard */}
                <div className="p-3 bg-[var(--varuna-surface-soft)] rounded-[var(--radius-md)] border border-[var(--varuna-border)] text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed mb-3">
                  {item.thresholdStandard}
                </div>

                {/* Footer Action */}
                <div className="flex items-center justify-between pt-1">
                  <span className="font-data text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    {item.status}
                  </span>
                  <button
                    onClick={() => handleInspect(item.region)}
                    className="px-3 py-1.5 bg-[var(--varuna-surface)] hover:bg-[var(--varuna-blue-light)] border border-[var(--varuna-border)] hover:border-[var(--varuna-blue)] rounded-[var(--radius-md)] text-scale-xs font-bold text-[var(--varuna-text)] hover:text-[var(--varuna-blue-dark)] transition-all cursor-pointer flex items-center gap-1 font-data"
                  >
                    <span>Inspect Model Blend</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
