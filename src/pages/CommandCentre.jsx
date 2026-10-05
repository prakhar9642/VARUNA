import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { RISK_TIERS } from '../data/mockData.js';
import { getRiskColor } from '../utils/formatters';
import { fetchRegionalForecasts, fetchSkill } from '../services/api.js';
import MapView from '../components/map/MapView';

export default function CommandCentre() {
  const selectedLeadTime = useStore((s) => s.selectedLeadTime);
  const setLeadTime = useStore((s) => s.setLeadTime);
  const selectedVariable = useStore((s) => s.selectedVariable);
  const selectRegion = useStore((s) => s.selectRegion);
  const selectedRegionId = useStore((s) => s.selectedRegionId);
  const getRegionalForecasts = useStore((s) => s.getRegionalForecasts);
  const setRegionalForecasts = useStore((s) => s.setRegionalForecasts);
  const effectiveMode = useStore((s) => s.effectiveMode);

  const [mobileView, setMobileView] = useState('map'); // 'map' | 'priority'
  const [filterTab, setFilterTab] = useState('ALL'); // 'ALL' | 'SEVERE' | 'RAINFALL' | 'HEAT' | 'COASTAL'
  const [sortBy, setSortBy] = useState('ALERT'); // 'ALERT' | 'FORECAST' | 'NAME'
  const [loading, setLoading] = useState(false);
  const [, setFetchError] = useState(null);
  const [skillMetric, setSkillMetric] = useState(null);

  // Fetch operational regional forecasts and authoritative skill metrics from FastAPI backend
  useEffect(() => {
    let cancelled = false;

    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setFetchError(null);

      Promise.all([
        fetchRegionalForecasts({
          variable: selectedVariable,
          leadTime: selectedLeadTime,
        }),
        fetchSkill({ variable: selectedVariable }).catch(() => null)
      ])
        .then(([data, skillData]) => {
          if (!cancelled) {
            setRegionalForecasts(data);
            if (skillData && skillData.available && skillData.headline && skillData.headline.rows) {
               const adaptiveRow = skillData.headline.rows.find(r => r.system === 'varuna_adaptive');
               const ifsRow = skillData.headline.rows.find(r => r.system === 'ecmwf_ifs');
               if (adaptiveRow && ifsRow) {
                 const reductionPct = ((ifsRow.rmse - adaptiveRow.rmse) / ifsRow.rmse) * 100;
                 setSkillMetric({ rmse: adaptiveRow.rmse.toFixed(2), reductionPct: reductionPct.toFixed(1) });
               } else {
                 setSkillMetric(null);
               }
            } else {
               setSkillMetric(null);
            }
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setFetchError(err.message || 'Failed to fetch regional forecasts');
            setLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [selectedLeadTime, selectedVariable, setRegionalForecasts]);

  const regionalList = getRegionalForecasts();

  const filteredRegions = useMemo(() => {
    let list = [...regionalList];
    if (filterTab === 'SEVERE') {
      list = list.filter((r) => r.forecast && (r.forecast.alertLevel === 'Critical' || r.forecast.alertLevel === 'High'));
    } else if (filterTab === 'RAINFALL') {
      list = list.filter((r) => r.regime?.toLowerCase().includes('monsoon') || r.regime?.toLowerCase().includes('convective') || r.regime?.toLowerCase().includes('precipitation'));
    } else if (filterTab === 'HEAT') {
      list = list.filter((r) => r.zone?.toLowerCase().includes('arid') || r.zone?.toLowerCase().includes('plateau') || r.regime?.toLowerCase().includes('thermal'));
    } else if (filterTab === 'COASTAL') {
      list = list.filter((r) => r.name?.toLowerCase().includes('coast') || r.zone?.toLowerCase().includes('maritime') || r.zone?.toLowerCase().includes('littoral'));
    }

    if (sortBy === 'FORECAST') {
      list.sort((a, b) => (b.forecast?.forecastValue ?? -Infinity) - (a.forecast?.forecastValue ?? -Infinity));
    } else if (sortBy === 'NAME') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      const order = { Critical: 4, High: 3, Moderate: 2, Low: 1, Nominal: 1 };
      list.sort((a, b) => (order[b.forecast?.alertLevel] || 0) - (order[a.forecast?.alertLevel] || 0));
    }

    return list;
  }, [regionalList, filterTab, sortBy]);

  const stats = useMemo(() => {
    const validRegions = regionalList.filter((r) => r.forecast);
    const total = regionalList.length;
    const critical = validRegions.filter((r) => r.forecast.alertLevel === 'Critical').length;
    const high = validRegions.filter((r) => r.forecast.alertLevel === 'High').length;
    const moderate = validRegions.filter((r) => r.forecast.alertLevel === 'Moderate').length;
    const validCount = validRegions.length;

    const avgAifs = validCount > 0 ? Math.round(validRegions.reduce((acc, r) => acc + (r.forecast.models?.aifs?.weight || 0), 0) / validCount) : 25;
    const avgIfs = validCount > 0 ? Math.round(validRegions.reduce((acc, r) => acc + (r.forecast.models?.ifs?.weight || 0), 0) / validCount) : 25;
    const avgGfs = validCount > 0 ? Math.round(validRegions.reduce((acc, r) => acc + (r.forecast.models?.gfs?.weight || 0), 0) / validCount) : 25;
    const avgIcon = validCount > 0 ? Math.round(validRegions.reduce((acc, r) => acc + (r.forecast.models?.icon?.weight || 0), 0) / validCount) : 25;
    const modelAverages = [
      { name: 'AIFS', val: avgAifs },
      { name: 'IFS', val: avgIfs },
      { name: 'GFS', val: avgGfs },
      { name: 'ICON', val: avgIcon },
    ];
    modelAverages.sort((a, b) => b.val - a.val);

    const allEqual = avgAifs === avgIfs && avgIfs === avgGfs && avgGfs === avgIcon;
    const top = allEqual
      ? `Equal Blend (${avgAifs}%)`
      : `${modelAverages[0].name} (${modelAverages[0].val}%)`;

    const sampleForecast = validRegions[0]?.forecast;
    const isAdaptiveVar = sampleForecast?.weightingScheme === 'adaptive_xgboost';
    const avgReduction = isAdaptiveVar && skillMetric
      ? `-${skillMetric.reductionPct}%`
      : 'Equal Weight';

    const validTime = sampleForecast?.validTime
      ? `${sampleForecast.validTime.replace('T', ' ')} UTC`
      : null;
    const dataMode = sampleForecast?.dataMode || effectiveMode;

    return {
      total,
      critical,
      high,
      moderate,
      topModel: top,
      avgReduction,
      validTime,
      dataMode,
    };
  }, [regionalList, effectiveMode, skillMetric]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--varuna-bg)] text-[var(--varuna-text)] font-sans">
      {/* Mobile view toggle */}
      <div className="md:hidden flex items-center justify-between px-4 py-2 bg-[var(--varuna-surface)] border-b border-[var(--varuna-border)] shrink-0">
        <div className="flex items-center gap-1 bg-[var(--varuna-surface-soft)] p-1 rounded-[var(--radius-md)] border border-[var(--varuna-border)]">
          <button
            onClick={() => setMobileView('map')}
            className={`px-3 py-1 text-scale-xs font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              mobileView === 'map'
                ? 'bg-[var(--varuna-blue)] text-white shadow-xs font-bold'
                : 'text-[var(--varuna-text-secondary)]'
            }`}
          >
            Forecast Map
          </button>
          <button
            onClick={() => setMobileView('priority')}
            className={`px-3 py-1 text-scale-xs font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              mobileView === 'priority'
                ? 'bg-[var(--varuna-blue)] text-white shadow-xs font-bold'
                : 'text-[var(--varuna-text-secondary)]'
            }`}
          >
            Watchlist ({filteredRegions.length})
          </button>
        </div>
        <span className="font-data text-scale-xs text-[var(--varuna-text-secondary)] tabular-nums">
          {stats.total} Zones
        </span>
      </div>

      {/* Main content: Map + Priority Sidebar */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Map Area */}
        <div className={`flex-1 min-w-0 h-full relative ${mobileView === 'priority' ? 'hidden md:block' : 'block'}`}>
          <MapView />
        </div>

        {/* Right Panel: Operational Forecast Watchlist */}
        <div
          className={`
            w-full md:w-[340px] border-l border-[var(--varuna-border)] bg-[var(--varuna-surface)] flex flex-col shrink-0 h-full transition-colors
            ${mobileView === 'map' ? 'hidden md:flex' : 'flex'}
          `}
        >
          {/* Header */}
          <div className="p-4 border-b border-[var(--varuna-border)] flex items-center justify-between">
            <div>
              <h2 className="text-scale-sm font-bold text-[var(--varuna-text)] uppercase tracking-wider">
                Operational Watchlist
              </h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  loading
                    ? 'bg-amber-400 animate-ping'
                    : stats.dataMode === 'LIVE'
                    ? 'bg-emerald-500 animate-pulse'
                    : stats.dataMode === 'REPLAY'
                    ? 'bg-blue-500'
                    : stats.dataMode === 'CACHED'
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                }`} />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--varuna-text-muted)]">
                  {loading
                    ? 'Syncing Operational Blend…'
                    : stats.dataMode === 'LIVE'
                    ? 'VARUNA Live Blend'
                    : stats.dataMode === 'CACHED'
                    ? 'VARUNA Cached Blend'
                    : stats.dataMode === 'REPLAY'
                    ? 'VARUNA Replay Blend'
                    : 'VARUNA Blend (Demo Mode)'}
                </span>
              </div>
            </div>
            <span className="font-data text-scale-xs text-[var(--varuna-text-muted)] tabular-nums">
              {filteredRegions.length} of {stats.total}
            </span>
          </div>

          {/* Category Filter Pills */}
          <div className="px-3 py-2 border-b border-[var(--varuna-border)] bg-[var(--varuna-surface-soft)] flex items-center gap-1 overflow-x-auto text-[11px] font-semibold">
            {[
              { id: 'ALL', label: 'All' },
              { id: 'SEVERE', label: 'Severe' },
              { id: 'RAINFALL', label: 'Monsoon' },
              { id: 'HEAT', label: 'Heat' },
              { id: 'COASTAL', label: 'Coastal' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterTab(tab.id)}
                className={`px-2.5 py-1 rounded-[var(--radius-sm)] shrink-0 transition-colors cursor-pointer ${
                  filterTab === tab.id
                    ? 'bg-[var(--varuna-blue)] text-white font-bold shadow-xs'
                    : 'text-[var(--varuna-text-secondary)] hover:bg-[var(--varuna-blue-light)] hover:text-[var(--varuna-blue-dark)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sort bar */}
          <div className="px-3 py-1.5 border-b border-[var(--varuna-border)] bg-[var(--varuna-surface)] flex items-center justify-between text-[11px] text-[var(--varuna-text-secondary)]">
            <span className="font-medium">Showing {filteredRegions.length} regions</span>
            <div className="flex items-center gap-1.5">
              <span>Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-transparent font-semibold text-[var(--varuna-text)] border-none outline-none cursor-pointer"
              >
                <option value="ALERT">Alert Severity</option>
                <option value="FORECAST">Forecast Value</option>
                <option value="NAME">Region Name</option>
              </select>
            </div>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border-subtle)]">
            {filteredRegions.length === 0 && (
              <div className="p-6 text-center text-scale-xs text-[var(--color-text-tertiary)]">
                No regions match the selected filter.
              </div>
            )}
            {filteredRegions.map((region) => {
              const f = region.forecast;
              const isSelected = selectedRegionId === region.id;
              const color = f ? getRiskColor(f.alertLevel) : '#64748B';

              return (
                <button
                  key={region.id}
                  onClick={() => selectRegion(region.id)}
                  className={`
                    w-full text-left p-3.5 transition-colors hover:bg-[var(--varuna-surface-soft)] cursor-pointer
                    ${isSelected ? 'bg-[var(--varuna-blue-light)] border-l-4 border-[var(--varuna-blue)]' : ''}
                  `}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-data text-scale-sm font-bold text-[var(--varuna-text)]">
                      {region.name}
                    </span>
                    {f ? (
                      <span
                        className="px-2 py-0.5 text-[11px] font-bold rounded text-white font-data tabular-nums"
                        style={{ backgroundColor: color }}
                      >
                        {f.forecastValue} {f.unit}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {region.error ? 'API Offline' : 'Loading…'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-scale-xs font-semibold text-[var(--varuna-text)] truncate max-w-[130px]">
                      {f ? `${f.alertLevel} Alert` : (region.error ? 'Unavailable' : 'Fetching…')}
                    </span>
                    <span className="text-[var(--varuna-text-muted)]">·</span>
                    <span className="text-[11px] text-[var(--varuna-text-secondary)] truncate flex-1">
                      {region.zone}
                    </span>
                  </div>

                  {f ? (
                    <div className="text-scale-xs text-[var(--varuna-text-secondary)] flex items-center justify-between">
                      <span className="truncate max-w-[210px] text-[11px] font-medium text-[var(--varuna-blue-dark)] dark:text-[var(--varuna-blue)]">
                        ⚡ AIFS ({f.models?.aifs?.weight ?? 25}%) · IFS ({f.models?.ifs?.weight ?? 25}%) · GFS ({f.models?.gfs?.weight ?? 25}%) · ICON ({f.models?.icon?.weight ?? 25}%)
                      </span>
                      <span className="font-data font-semibold text-[10px] text-[var(--varuna-text-muted)] shrink-0">
                        {f.weightingScheme === 'adaptive_xgboost' ? (skillMetric?.rmse ? `RMSE ${skillMetric.rmse}` : 'Adaptive Blend') : 'Equal Blend'}
                      </span>
                    </div>
                  ) : (
                    <div className="text-[10px] text-[var(--varuna-text-muted)] italic">
                      {region.error || 'Awaiting authoritative model sync…'}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom strip: stats + lead time selector */}
      <div className="min-h-[48px] py-2 border-t border-[var(--varuna-border)] bg-[var(--varuna-surface)] flex flex-wrap items-center justify-between px-4 gap-3 shrink-0 overflow-x-auto transition-colors">
        <div className="flex items-center gap-4 sm:gap-6 flex-nowrap overflow-x-auto">
          <StatChip label="Active Regions" value={stats.total} />
          <StatChip label="Cycle Run" value="00z UTC" />
          <StatChip label="Valid Time" value={stats.validTime || '—'} />
          <StatChip label="Critical Alert" value={stats.critical} color={RISK_TIERS.Critical} />
          <StatChip label="High Alert" value={stats.high} color={RISK_TIERS.High} />
          <StatChip label="Top Weight Model" value={stats.topModel} color="#0284C7" />
          <StatChip label="Mean Error Reduction" value={stats.avgReduction} color="#16845B" />
        </div>

        {/* Lead Time Scrubber Buttons */}
        <div className="flex items-center gap-1 bg-[var(--varuna-surface-soft)] p-1 rounded-[var(--radius-md)] border border-[var(--varuna-border)] shrink-0 ml-auto">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--varuna-text-muted)] mr-1 px-1 hidden sm:inline">
            Lead Time:
          </span>
          {['24h', '48h', '72h', '120h'].map((range) => (
            <button
              key={range}
              onClick={() => setLeadTime(range)}
              className={`
                px-2.5 py-1 text-scale-xs font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer
                ${
                  selectedLeadTime === range
                    ? 'bg-[var(--varuna-blue)] text-white shadow-xs font-bold'
                    : 'text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)]'
                }
              `}
            >
              {range.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="text-scale-xs text-[var(--color-text-tertiary)]">{label}:</span>
      <span
        className="font-data text-scale-sm font-bold tabular-nums"
        style={{ color: color || 'var(--color-text-primary)' }}
      >
        {value}
      </span>
    </div>
  );
}
