import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useStore } from '../store/useStore';
import { REGIONS, VARIABLES, getDeterministicForecast } from '../data/mockData.js';
import { formatCoords, getRiskColor } from '../utils/formatters';
import ChartCard from '../components/shared/ChartCard';
import { fetchForecast } from '../services/api';

const AVAILABLE_HORIZONS = ['24h', '48h', '72h', '120h', '7d'];

export default function Forecast() {
  const selectedRegionId = useStore((s) => s.selectedRegionId);
  const selectRegion = useStore((s) => s.selectRegion);
  const selectedVariable = useStore((s) => s.selectedVariable);
  const setVariable = useStore((s) => s.setVariable);
  const selectedLeadTime = useStore((s) => s.selectedLeadTime);
  const setLeadTime = useStore((s) => s.setLeadTime);
  const effectiveMode = useStore((s) => s.effectiveMode);

  // Auto-correct 30d to 7d since NWP medium range caps at 168h
  useEffect(() => {
    if (selectedLeadTime === '30d') {
      setLeadTime('7d');
    }
  }, [selectedLeadTime, setLeadTime]);

  // Only provide deterministic baseline if user explicitly selected DEMO or REPLAY mode
  const fallbackBaseline = useMemo(() => {
    if (effectiveMode === 'DEMO' || effectiveMode === 'REPLAY') {
      return getDeterministicForecast(selectedRegionId, selectedVariable, selectedLeadTime, effectiveMode);
    }
    return null;
  }, [selectedRegionId, selectedVariable, selectedLeadTime, effectiveMode]);

  const [forecast, setForecast] = useState(fallbackBaseline);
  const [loading, setLoading] = useState(effectiveMode === 'LIVE');
  const [isLive, setIsLive] = useState(false);
  const [isFallback, setIsFallback] = useState(effectiveMode === 'DEMO' || effectiveMode === 'REPLAY');
  const [fallbackReason, setFallbackReason] = useState(
    effectiveMode === 'DEMO' ? 'User-selected DEMO mode active' : (effectiveMode === 'REPLAY' ? 'Archived cycle REPLAY active' : null)
  );
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState(null);

  // Authoritative live data fetch from Python FastAPI backend (/api/forecast)
  useEffect(() => {
    let cancelled = false;

    Promise.resolve().then(() => {
      if (cancelled) return;

      // If explicit DEMO or REPLAY mode requested by user
      if (effectiveMode === 'DEMO' || effectiveMode === 'REPLAY') {
        const referenceData = getDeterministicForecast(selectedRegionId, selectedVariable, selectedLeadTime, effectiveMode);
        setForecast(referenceData);
        setIsLive(false);
        setIsFallback(true);
        setIsUnavailable(false);
        setFallbackReason(effectiveMode === 'DEMO' ? 'User-selected DEMO mode active' : 'Archived cycle REPLAY active');
        setLoading(false);
        return;
      }

      setLoading(true);
      fetchForecast({
        region: selectedRegionId,
        variable: selectedVariable,
        leadTime: selectedLeadTime,
        mode: 'LIVE',
      })
        .then((data) => {
          if (!cancelled) {
            setForecast(data);
            setIsLive(true);
            setIsFallback(false);
            setIsUnavailable(false);
            setFallbackReason(null);
            setUnavailableReason(null);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            // Operational LIVE failure: strictly do NOT fall back to synthetic data
            setForecast(null);
            setIsLive(false);
            setIsFallback(false);
            setIsUnavailable(true);
            setUnavailableReason(err.message || 'API unreachable');
            setLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [selectedRegionId, selectedVariable, selectedLeadTime, effectiveMode]);

  const displayForecast = forecast || fallbackBaseline;
  const selectedRegion = REGIONS.find((r) => r.id === selectedRegionId) || REGIONS[0];
  const selectedVarObj = VARIABLES.find((v) => v.id === selectedVariable) || VARIABLES[0];

  const {
    region = selectedRegion,
    variable = selectedVarObj,
    models = {},
    timeseries = [],
    alertLevel = isUnavailable ? 'UNAVAILABLE' : (loading ? 'SYNCING' : 'NOMINAL'),
    alertReason = isUnavailable ? (unavailableReason || 'Backend API offline') : '',
    unit = selectedVarObj.unit || '',
    whyThisBlend = {},
    horizonNote = null,
    weightingScheme = 'equal_fallback_untrained',
    weightingReason = null,
  } = displayForecast || {};

  const formattedLead = selectedLeadTime.startsWith('+') ? selectedLeadTime : `+${selectedLeadTime}`;

  // Compute ensemble spread across available member forecasts
  const memberValues = [
    models.ifs?.value,
    models.aifs?.value,
    models.gfs?.value,
    models.icon?.value,
  ].filter((v) => typeof v === 'number' && !isNaN(v));

  const ensembleSpread = memberValues.length > 1
    ? (Math.max(...memberValues) - Math.min(...memberValues)).toFixed(1)
    : '0.0';

  // Compute sum of weights and verify adaptive vs equal weighting
  const modelWeights = [
    models.ifs?.weight,
    models.aifs?.weight,
    models.gfs?.weight,
    models.icon?.weight,
  ].filter((w) => typeof w === 'number');

  const isAdaptive = weightingScheme === 'adaptive_xgboost';

  const weightsSum = (
    (models.ifs?.weight || 0) +
    (models.aifs?.weight || 0) +
    (models.gfs?.weight || 0) +
    (models.icon?.weight || 0)
  );

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-6 bg-[var(--varuna-bg)] text-[var(--varuna-text)] font-sans">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-scale-2xl font-bold tracking-tight text-[var(--varuna-text)]">
            Forecast Analysis &amp; Ensembles
          </h1>
          <p className="mt-1 text-scale-sm text-[var(--varuna-text-secondary)]">
            Multi-model NWP-AI blending (ECMWF IFS, ECMWF AIFS, NOAA GFS, DWD ICON) with{' '}
            {isAdaptive ? 'contextual error minimization' : 'operational equal-weight ensemble'}
          </p>
        </div>

        {/* Lead time / Horizon + Variable controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Horizon pills */}
          <div className="inline-flex items-center gap-1 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] p-1 rounded-[var(--radius-lg)] shadow-xs">
            {AVAILABLE_HORIZONS.map((lt) => (
              <button
                key={lt}
                onClick={() => setLeadTime(lt)}
                className={`px-3 py-1 text-scale-xs font-semibold rounded-[var(--radius-md)] transition-all cursor-pointer ${
                  selectedLeadTime === lt
                    ? 'bg-[var(--varuna-blue)] text-white shadow-xs font-bold'
                    : 'text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)]'
                }`}
              >
                {lt.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Variable Switcher */}
          <div className="inline-flex items-center gap-1 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] p-1 rounded-[var(--radius-lg)] shadow-xs">
            {VARIABLES.map((v) => (
              <button
                key={v.id}
                onClick={() => setVariable(v.id)}
                className={`px-3 py-1 text-scale-xs font-semibold rounded-[var(--radius-md)] transition-all cursor-pointer flex items-center gap-1 ${
                  selectedVariable === v.id
                    ? 'bg-[var(--varuna-blue)] text-white font-bold shadow-xs'
                    : 'text-[var(--varuna-text-secondary)] hover:bg-[var(--varuna-surface-soft)]'
                }`}
              >
                <span>{v.icon}</span>
                <span>{v.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Explicit Data Mode & Status Banner */}
      <div className={`p-3 rounded-[var(--radius-md)] border flex items-center justify-between text-scale-xs transition-colors ${
        isUnavailable
          ? 'bg-rose-500/10 border-rose-300 text-rose-900 dark:text-rose-200'
          : isFallback
            ? 'bg-amber-500/10 border-amber-300 text-amber-900 dark:text-amber-200'
            : isLive
              ? 'bg-emerald-500/10 border-emerald-300 text-emerald-900 dark:text-emerald-200'
              : 'bg-[var(--varuna-blue-light)] border-[var(--varuna-border-strong)] text-[var(--varuna-blue-dark)]'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${
            isUnavailable
              ? 'bg-rose-500'
              : isFallback
                ? 'bg-amber-500'
                : isLive
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-[var(--varuna-blue)] animate-pulse'
          }`} />
          <span className="font-bold tracking-wide">
            {isUnavailable
              ? 'LIVE DATA UNAVAILABLE'
              : isFallback
                ? 'REPLAY / DEMO REFERENCE'
                : isLive
                  ? 'LIVE OPERATIONAL STREAM'
                  : 'CONNECTING TO LIVE BACKEND'}
          </span>
          <span className="hidden sm:inline text-[var(--varuna-text-secondary)]">
            {isUnavailable
              ? `— Backend offline: ${unavailableReason || 'API unreachable'}. Operational live forecast stream interrupted.`
              : isFallback
                ? `— ${fallbackReason || 'Reference mode active; not live scientific output'}`
                : isLive
                  ? '— Connected to Python FastAPI /api/forecast (ECMWF IFS, AIFS, NOAA GFS, DWD ICON via Open-Meteo Gateway)'
                  : '— Handshaking with FastAPI /api/forecast gateway...'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-[11px] font-mono text-[var(--varuna-text-muted)] animate-pulse">
              Syncing...
            </span>
          )}
          <span className="font-data text-[11px] font-bold px-2 py-0.5 rounded bg-[var(--varuna-surface)] border border-[var(--varuna-border)]">
            {isUnavailable ? 'UNAVAILABLE' : isFallback ? 'REFERENCE' : isLive ? 'LIVE 200 OK' : 'CONNECTING'}
          </span>
        </div>
      </div>

      {/* Horizon Limitation Alert */}
      {horizonNote && (
        <div className="p-3 bg-[var(--varuna-blue-light)] border border-[var(--varuna-blue)] text-[var(--varuna-blue-dark)] rounded-[var(--radius-md)] text-scale-xs flex items-start gap-2">
          <span className="font-bold text-[var(--varuna-blue)] mt-0.5">ℹ</span>
          <div>
            <span className="font-bold block mb-0.5">Forecast Horizon Notice:</span>
            <p className="text-[11px] leading-relaxed">{horizonNote}</p>
          </div>
        </div>
      )}

      {/* Regional Selector Strip */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[var(--varuna-border)]">
        <span className="text-scale-xs font-bold uppercase tracking-wider text-[var(--varuna-text-muted)] shrink-0">
          Target Zone:
        </span>
        {REGIONS.map((r) => {
          const isSelected = r.id === selectedRegionId;
          return (
            <button
              key={r.id}
              onClick={() => selectRegion(r.id)}
              className={`
                px-3 py-1 rounded-[var(--radius-md)] text-scale-xs font-medium shrink-0 transition-all cursor-pointer border
                ${
                  isSelected
                    ? 'bg-[var(--varuna-blue-light)] border-[var(--varuna-blue)] text-[var(--varuna-blue-dark)] font-bold shadow-xs'
                    : 'bg-[var(--varuna-surface)] border-[var(--varuna-border)] text-[var(--varuna-text-secondary)] hover:bg-[var(--varuna-surface-soft)]'
                }
              `}
            >
              {r.name}
            </button>
          );
        })}
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Card 1: VARUNA Blend Forecast */}
        <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-xs">
          <div className="text-[11px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider">
            VARUNA Blend Forecast
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="font-data text-3xl font-bold text-[var(--varuna-blue-dark)] dark:text-[var(--varuna-blue)]">
              {isUnavailable || !displayForecast || models.blend?.value === undefined || models.blend?.value === null ? '—' : Number(models.blend.value).toFixed(1)}
            </span>
            {(!isUnavailable && displayForecast && models.blend?.value !== undefined && models.blend?.value !== null) && (
              <span className="text-scale-sm font-semibold text-[var(--varuna-text-secondary)]">
                {unit}
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-[var(--varuna-text-secondary)]">
            {isUnavailable
              ? 'Operational live stream unavailable'
              : isAdaptive
                ? `Contextual Hybrid Blend (${formattedLead})`
                : `Operational Equal-Weight Blend (${formattedLead})`}
          </div>
        </div>

        {/* Card 2: Alert Status */}
        <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-xs">
          <div className="text-[11px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider">
            Alert Status
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: isUnavailable ? '#EF4444' : getRiskColor(alertLevel) }} />
            <span className="font-data text-2xl font-bold text-[var(--varuna-text)]">
              {isUnavailable ? 'UNAVAILABLE' : alertLevel}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[var(--varuna-text-secondary)] truncate">
            {isUnavailable ? (unavailableReason || 'Backend API offline') : (alertReason || 'IMD Operational Threshold Monitoring')}
          </div>
        </div>

        {/* Card 3: Top Driving Model */}
        <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-xs">
          <div className="text-[11px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider">
            Top Driving Model
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            {isUnavailable || !displayForecast ? (
              <span className="font-data text-xl md:text-2xl font-bold text-[var(--varuna-text-muted)]">
                —
              </span>
            ) : isAdaptive ? (
              <>
                <span className="font-data text-2xl font-bold text-[var(--varuna-blue-dark)] dark:text-[var(--varuna-blue)]">
                  {whyThisBlend.topModel?.name || 'ECMWF IFS'}
                </span>
                <span className="text-scale-sm font-bold text-[var(--varuna-text-secondary)] font-data">
                  ({whyThisBlend.topModel?.pct || 25}%)
                </span>
              </>
            ) : (
              <>
                <span className="font-data text-xl md:text-2xl font-bold text-[var(--varuna-text)]">
                  Equal Allocation
                </span>
                <span className="text-scale-xs font-semibold text-[var(--varuna-text-secondary)] font-data">
                  ({modelWeights[0] || 25}% each)
                </span>
              </>
            )}
          </div>
          <div className="mt-1 text-[11px] text-[var(--varuna-text-secondary)] truncate">
            {isUnavailable
              ? 'Contextual error minimization offline'
              : isAdaptive
                ? (whyThisBlend.topModel?.error !== undefined
                    ? `Est. Contextual Error: ${whyThisBlend.topModel.error} ${unit}`
                    : `Contextual Error Minimization (${formattedLead})`)
                : 'Equal-weight fallback across available forecast members.'}
          </div>
        </div>

        {/* Card 4: Ensemble Spread / Agreement */}
        <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-xs">
          <div className="text-[11px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider">
            Ensemble Spread
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-data text-2xl font-bold text-teal-600 dark:text-teal-400">
              {isUnavailable || !displayForecast ? '—' : ensembleSpread}
            </span>
            {(!isUnavailable && displayForecast) && (
              <span className="text-scale-xs text-teal-700 dark:text-teal-300 font-medium font-data ml-1">
                {unit} spread
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-[var(--varuna-text-secondary)]">
            {isUnavailable ? 'Ensemble telemetry unavailable' : `${memberValues.length} Canonical Members (IFS, AIFS, GFS, ICON)`}
          </div>
        </div>
      </div>

      {/* Main Multi-Model Diurnal Cycle & Horizon Chart */}
      <ChartCard
        title={`Forecast Evolution & Member Trajectories — ${region.name || 'Selected Region'} (${formattedLead})`}
        subtitle={`Synchronous progression of ECMWF IFS, ECMWF AIFS, NOAA GFS, DWD ICON, and VARUNA Blend for ${variable.label || 'Variable'} (${unit})`}
        badge={isUnavailable ? 'STREAM UNAVAILABLE' : `Init: ${displayForecast?.initializationTime ? displayForecast.initializationTime.slice(0, 10) : '2026-09-26'} 00z · Horizon: ${formattedLead}`}
        span="full"
      >
        {isUnavailable || !displayForecast || timeseries.length === 0 ? (
          <div className="h-[340px] flex flex-col items-center justify-center text-center p-6 bg-[var(--varuna-surface-soft)] rounded-[var(--radius-md)] border border-dashed border-[var(--varuna-border)]">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center text-xl font-bold mb-3">
              ✕
            </div>
            <div className="font-bold text-scale-md text-[var(--varuna-text)]">
              Operational Live Forecast Unavailable
            </div>
            <p className="mt-1 text-scale-xs text-[var(--varuna-text-secondary)] max-w-md leading-relaxed">
              Unable to establish real-time data connection with the VARUNA processing API ({unavailableReason || 'Connection refused'}). Numerical ensemble evolution is withheld until live service connectivity is restored.
            </p>
            <div className="mt-4 px-3 py-1 text-[11px] font-data font-semibold text-rose-700 dark:text-rose-300 bg-rose-500/10 rounded-full border border-rose-300 dark:border-rose-800">
              NO SYNTHETIC FORECAST DISPLAYED
            </div>
          </div>
        ) : (
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={timeseries} margin={{ top: 16, right: 24, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--varuna-border)" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: 'var(--varuna-text-secondary)', fontFamily: 'var(--font-data)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--varuna-border)' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--varuna-text-secondary)', fontFamily: 'var(--font-data)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--varuna-border)' }}
              unit={` ${unit}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--varuna-surface)',
                borderColor: 'var(--varuna-border)',
                borderRadius: '8px',
                fontSize: '12px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                fontFamily: 'var(--font-data)',
              }}
              labelFormatter={(label, items) => {
                const pt = items?.[0]?.payload;
                if (pt?.valid_time) {
                  return `Valid: ${pt.valid_time.replace('T', ' ').slice(0, 16)} UTC (+${pt.lead_time_hours}h lead)`;
                }
                return label;
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '10px', fontFamily: 'var(--font-data)' }}
            />
            <Line
              type="monotone"
              dataKey="IFS"
              name="ECMWF IFS (Physical NWP 9km)"
              stroke="#1E40AF"
              strokeWidth={2}
              dot={{ r: 2.5, fill: '#1E40AF' }}
            />
            <Line
              type="monotone"
              dataKey="AIFS"
              name="ECMWF AIFS (Deep Learning Transformer 28km)"
              stroke="#0284C7"
              strokeWidth={2}
              dot={{ r: 2.5, fill: '#0284C7' }}
            />
            <Line
              type="monotone"
              dataKey="GFS"
              name="NOAA GFS (Global FV3 13km)"
              stroke="#0D9488"
              strokeWidth={2}
              dot={{ r: 2.5, fill: '#0D9488' }}
            />
            <Line
              type="monotone"
              dataKey="ICON"
              name="DWD ICON (Non-Hydrostatic 13km)"
              stroke="#64748B"
              strokeWidth={2}
              dot={{ r: 2.5, fill: '#64748B' }}
            />
            <Line
              type="monotone"
              dataKey="VARUNA"
              name="VARUNA BLEND (Contextual Hybrid)"
              stroke="#245F89"
              strokeWidth={3.5}
              dot={{ r: 3.5, fill: '#245F89' }}
            />
          </LineChart>
        </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Atmospheric Context & Consensus breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Regional Atmospheric Regime Profile */}
        <ChartCard
          title="Regional Atmospheric Regime Profile"
          subtitle="Climatological forcing parameters, synoptic classification, and local topography"
          badge={region.zone || 'Synoptic Zone'}
        >
          <div className="space-y-3.5 text-scale-xs">
            <div className="p-3 bg-[var(--color-surface)] rounded-[var(--radius-md)] border border-[var(--color-border)]">
              <span className="font-bold text-[var(--color-text-primary)] block mb-0.5">
                Active Weather Regime
              </span>
              <p className="text-[var(--color-text-secondary)] leading-relaxed">
                {region.regime || 'Standard synoptic regime'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 font-data">
              <div className="p-3 bg-[var(--color-surface)] rounded-[var(--radius-md)] border border-[var(--color-border)]">
                <span className="text-[var(--color-text-tertiary)] block text-[10px] uppercase font-bold">Coordinates</span>
                <span className="text-[var(--color-text-primary)] font-bold">
                  {region.lat !== undefined && region.lng !== undefined ? formatCoords(region.lat, region.lng) : '--'}
                </span>
              </div>
              <div className="p-3 bg-[var(--color-surface)] rounded-[var(--radius-md)] border border-[var(--color-border)]">
                <span className="text-[var(--color-text-tertiary)] block text-[10px] uppercase font-bold">Terrain Elevation</span>
                <span className="text-[var(--color-text-primary)] font-bold">
                  {region.elevation ? (typeof region.elevation === 'string' && region.elevation.includes('m') ? region.elevation : `${region.elevation}m`) : '--'} MSL
                </span>
              </div>
            </div>
            <div className="p-3 bg-[var(--color-surface)] rounded-[var(--radius-md)] border border-[var(--color-border)] flex items-center justify-between">
              <div>
                <span className="font-bold text-[var(--color-text-primary)] block">IMD AWS In-Situ Observation Mesh</span>
                <span className="text-[var(--color-text-secondary)] text-[11px]">
                  Station telemetry stream not connected ({region.stationsCount || 28} planned stations in zone mesh)
                </span>
              </div>
              <span className="font-data font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-[10px]">
                Not connected
              </span>
            </div>
          </div>
        </ChartCard>

        {/* Multi-Model Consensus & Weight Contribution (Phase 6 & 10) */}
        <ChartCard
          title={
            isAdaptive
              ? 'Multi-Model Consensus & Adaptive Weight Contribution'
              : 'Multi-Model Consensus & Operational Equal-Weight Ensemble'
          }
          subtitle={
            isAdaptive
              ? 'Real-time contextual weights allocated by Python XGBoost meta-model based on synoptic conditions'
              : (weightingReason || `Operational Equal-Weight Ensemble (25% each) for ${variable.label || selectedVariable}.`)
          }
          badge={
            isUnavailable
              ? 'UNAVAILABLE'
              : isFallback
                ? 'DEMO / REFERENCE'
                : isAdaptive
                  ? `Total Weight: ${weightsSum}% (Hamilton-Hare Normalized)`
                  : `Total Weight: ${weightsSum}% (Equal Allocation)`
          }
        >
          <div className="space-y-4 pt-1">
            {/* Model list: IFS, AIFS, GFS, ICON */}
            {[
              {
                id: 'ifs',
                shortName: 'IFS',
                name: 'ECMWF IFS',
                desc: 'High-Resolution Physical NWP (9km)',
                barBg: 'bg-[#1E40AF]',
                model: models.ifs,
              },
              {
                id: 'aifs',
                shortName: 'AIFS',
                name: 'ECMWF AIFS',
                desc: 'Deep Learning Spherical Transformer (28km)',
                barBg: 'bg-[#0284C7]',
                model: models.aifs,
              },
              {
                id: 'gfs',
                shortName: 'GFS',
                name: 'NOAA GFS',
                desc: 'Operational Global NWP (FV3 Core, 13km)',
                barBg: 'bg-[#0D9488]',
                model: models.gfs,
              },
              {
                id: 'icon',
                shortName: 'ICON',
                name: 'DWD ICON',
                desc: 'Icosahedral Non-Hydrostatic NWP (13km)',
                barBg: 'bg-[#64748B]',
                model: models.icon,
              },
            ].map(({ id, name, desc, barBg, model }) => {
              if (!model && !isUnavailable) return null;
              const weightVal = model?.weight ?? 0;
              const valueVal = (!isUnavailable && displayForecast && model?.value !== undefined && model?.value !== null) ? Number(model.value).toFixed(1) : '—';
              return (
                <div key={id} className="p-3 bg-[var(--varuna-surface-soft)] rounded-[var(--radius-md)] border border-[var(--varuna-border)]">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                    <div>
                      <span className="font-bold text-[var(--varuna-text)] text-scale-xs">
                        {name}
                      </span>
                      <span className="text-[10px] text-[var(--varuna-text-muted)] block sm:inline sm:ml-2 font-data">
                        {desc}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-data text-scale-xs">
                      <span className="text-[var(--varuna-text)] font-bold">
                        Forecast: {valueVal}{valueVal !== '—' ? ` ${unit}` : ''} <span className="text-[var(--varuna-text-muted)] font-normal">({formattedLead})</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[var(--varuna-surface)] border border-[var(--varuna-border)] font-bold text-[var(--varuna-text)]">
                        Weight: {isUnavailable || !displayForecast ? '—' : `${weightVal}%`}
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 bg-[var(--varuna-surface)] rounded-full overflow-hidden border border-[var(--varuna-border)]">
                    <div
                      className={`h-full ${barBg} rounded-full transition-all`}
                      style={{ width: isUnavailable || !displayForecast ? '0%' : `${Math.min(100, Math.max(0, weightVal))}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Bottom summary */}
            <div className="p-3 bg-[var(--varuna-blue-light)] border border-[var(--varuna-blue)] rounded-[var(--radius-md)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-scale-xs shadow-2xs">
              <div>
                <span className="font-bold text-[var(--varuna-text)] block">
                  VARUNA Final Blended Forecast
                </span>
                <span className="text-[11px] text-[var(--varuna-text-secondary)]">
                  {isUnavailable
                    ? 'Operational live stream unavailable'
                    : isAdaptive
                      ? 'Contextual synthesis: Σ (Weight × Forecast) / 100'
                      : 'Arithmetic ensemble mean: Σ (Forecast) / 4 (Equal weights)'}
                </span>
              </div>
              <div className="font-data font-bold text-[var(--varuna-blue-dark)] dark:text-[var(--varuna-blue)] text-scale-base sm:text-scale-lg">
                {isUnavailable || !displayForecast || models.blend?.value === undefined || models.blend?.value === null
                  ? '—'
                  : `${Number(models.blend.value).toFixed(1)} ${unit}`}{' '}
                <span className="text-scale-xs text-[var(--varuna-text-muted)] font-normal">({formattedLead})</span>
              </div>
            </div>

            {/* Explanation box (Phase 10) */}
            <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-scale-xs">
              <span className="font-bold text-[var(--color-text-primary)] block mb-1">
                {isUnavailable ? 'Stream Status' : (isAdaptive ? 'Why this blend?' : 'Weighting Methodology')}
              </span>
              <p className="text-[var(--color-text-secondary)] text-[11px] leading-relaxed">
                {isUnavailable
                  ? `Live forecast data is currently unavailable (${unavailableReason || 'Backend offline'}). No synthetic forecast values or simulated weights are displayed.`
                  : isAdaptive
                    ? (whyThisBlend.explanation ||
                      `${whyThisBlend.topModel?.name || 'Top model'} is allocated the highest weight because the XGBoost meta-model predicted the lowest contextual error for this region at ${formattedLead} lead.`)
                    : (weightingReason ||
                      whyThisBlend.explanation ||
                      'Adaptive ML is not promoted for this variable; operational forecast uses equal-weight consensus across the four NWP members.')}
              </p>
            </div>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
