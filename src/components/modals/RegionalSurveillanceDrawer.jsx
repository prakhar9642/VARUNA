import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { REGIONS, VARIABLES } from '../../data/referenceData.js';
import { fetchAnalyze, fetchForecast } from '../../services/api';
import { formatCoords, getRiskColor } from '../../utils/formatters';

const HORIZON_LABELS = ['24h', '48h', '72h', '120h', '7d'];

export default function RegionalSurveillanceDrawer({
  isOpen,
  onClose,
  initialRegionId = 'delhi_ncr',
  initialVariable = 'temperature',
  initialLeadTime = '48h',
}) {
  const reduceMotion = useReducedMotion();

  const [regionId, setRegionId] = useState(initialRegionId);
  const [variable, setVariable] = useState(initialVariable);
  const [leadTime, setLeadTime] = useState(initialLeadTime);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  // Sync internal state when opened with new props
  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted && isOpen) {
        if (initialRegionId) setRegionId(initialRegionId);
        if (initialVariable) setVariable(initialVariable);
        if (initialLeadTime) setLeadTime(initialLeadTime);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [isOpen, initialRegionId, initialVariable, initialLeadTime]);

  const activeRegion = useMemo(() => {
    return REGIONS.find((r) => r.id === regionId) || REGIONS[0];
  }, [regionId]);

  const activeVarObj = useMemo(() => {
    return VARIABLES.find((v) => v.id === variable) || VARIABLES[0];
  }, [variable]);

  const loadAnalysis = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAnalyze({
        region: regionId,
        variable,
        leadTime,
      });

      // Resilient fallback: ensure time_series is populated from forecast timeline if missing or empty
      if (!data.time_series || data.time_series.length === 0) {
        try {
          const fc = await fetchForecast({ region: regionId, variable, leadTime });
          if (fc && Array.isArray(fc.timeline) && fc.timeline.length > 0) {
            data.time_series = fc.timeline.map((pt) => ({
              time: pt.time,
              lead_time_hours: pt.lead_time_hours,
              IFS: pt.models?.ecmwf_ifs ?? 0,
              AIFS: pt.models?.ecmwf_aifs ?? 0,
              GFS: pt.models?.ncep_gfs ?? 0,
              ICON: pt.models?.dwd_icon ?? 0,
              VARUNA: pt.blend ?? 0,
            }));
          }
        } catch (fcErr) {
          console.warn('Fallback timeseries acquisition failed', fcErr);
        }
      }

      setAnalysis(data);
    } catch (err) {
      setError(err.message || 'Failed to fetch regional surveillance data');
    } finally {
      setLoading(false);
    }
  }, [isOpen, regionId, variable, leadTime]);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve().then(() => {
      if (isMounted) {
        loadAnalysis();
      }
    });
    return () => {
      isMounted = false;
    };
  }, [loadAnalysis]);

  if (!isOpen) return null;

  const leadH = typeof leadTime === 'string'
    ? (leadTime.endsWith('d') ? parseInt(leadTime, 10) * 24 : parseInt(leadTime, 10))
    : (leadTime || 48);

  const unit = analysis?.unit || activeVarObj.unit;
  const isAdaptive = analysis?.weighting_scheme === 'adaptive_xgboost';
  const riskSeverity = analysis?.severity || 'LOW';
  const riskScore = analysis?.risk_score ?? 15;
  const confidence = analysis?.confidence ?? 85;
  const bustProb = analysis?.bust_probability ?? 15;
  const spread = analysis?.ensemble_spread ?? 0.0;
  const blendVal = analysis?.blend;
  const models = analysis?.models || {};
  const weights = analysis?.weights || {};
  const predErrors = analysis?.predicted_errors || {};
  const reasons = analysis?.reasons || [];
  const features = analysis?.variable_features || {};
  const timeSeries = analysis?.time_series || [];
  const horizonTrend = analysis?.horizon_trend || [];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden font-sans">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
        />

        {/* Sliding Panel */}
        <motion.aside
          initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
          animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { x: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="fixed top-0 right-0 bottom-0 w-[600px] max-w-[96vw] bg-[var(--varuna-surface)] border-l border-[var(--varuna-border)] flex flex-col shadow-2xl z-50 text-[var(--varuna-text)]"
        >
          {/* Header */}
          <div className="p-5 border-b border-[var(--varuna-border)] bg-[var(--varuna-surface)] shrink-0 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getRiskColor(riskSeverity) }} />
                  <h2 className="text-scale-lg font-bold tracking-tight text-[var(--varuna-text)]">
                    {activeRegion.name}
                  </h2>
                  <span
                    className="px-2 py-0.5 text-[10px] font-bold rounded-full text-white font-data"
                    style={{ backgroundColor: getRiskColor(riskSeverity) }}
                  >
                    {riskSeverity} RISK
                  </span>
                </div>
                <div className="text-scale-xs text-[var(--varuna-text-secondary)] flex items-center gap-2 mt-1">
                  <span>{activeRegion.zone}</span>
                  <span>•</span>
                  <span className="font-data">{formatCoords(activeRegion.lat, activeRegion.lon || activeRegion.lng)}</span>
                  <span>•</span>
                  <span className="font-data">Elev: {activeRegion.elevation || '—'}</span>
                </div>
              </div>

              <button
                onClick={onClose}
                className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--varuna-surface-soft)] text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)] transition-colors cursor-pointer"
                aria-label="Close surveillance drawer"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Quick 12-Region Switcher (Horizontal scroll) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 font-data">
              <span className="text-[10px] font-bold uppercase text-[var(--varuna-text-muted)] shrink-0 mr-1">
                Zone:
              </span>
              {REGIONS.map((r) => {
                const isSelected = r.id === regionId;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRegionId(r.id)}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded shrink-0 transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-[var(--varuna-blue)] text-white font-bold border-[var(--varuna-blue)] shadow-2xs'
                        : 'bg-[var(--varuna-surface-soft)] border-[var(--varuna-border)] text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)]'
                    }`}
                  >
                    {r.name.split(' (')[0]}
                  </button>
                );
              })}
            </div>

            {/* Variable and Lead Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--varuna-border)] font-data">
              {/* Variables */}
              <div className="inline-flex items-center gap-1 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] p-1 rounded-[var(--radius-md)]">
                {VARIABLES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVariable(v.id)}
                    className={`px-2.5 py-1 text-scale-xs font-semibold rounded transition-all cursor-pointer ${
                      variable === v.id
                        ? 'bg-[var(--varuna-blue)] text-white shadow-2xs font-bold'
                        : 'text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)]'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {/* Lead times */}
              <div className="inline-flex items-center gap-1 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] p-1 rounded-[var(--radius-md)]">
                {HORIZON_LABELS.map((lt) => (
                  <button
                    key={lt}
                    onClick={() => setLeadTime(lt)}
                    className={`px-2 py-0.5 text-scale-xs font-semibold rounded transition-all cursor-pointer ${
                      leadTime === lt
                        ? 'bg-[var(--varuna-blue)] text-white shadow-2xs font-bold'
                        : 'text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)]'
                    }`}
                  >
                    {lt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5 font-sans">
            {/* Live status bar */}
            <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] flex items-center justify-between gap-3 text-scale-xs font-data">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
                <span className="font-bold">
                  {loading ? 'UPDATING LIVE RELIABILITY…' : error ? 'DATA RETRIEVAL ISSUE' : 'LIVE OPERATIONAL STREAM'}
                </span>
                {analysis?.valid_time && !loading && (
                  <span className="text-[var(--varuna-text-muted)] hidden sm:inline">
                    · Valid: {analysis.valid_time.replace('T', ' ')} UTC (+{leadH}h)
                  </span>
                )}
              </div>
              <span className={`px-2 py-0.5 rounded font-bold border ${
                error
                  ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950 dark:text-rose-300'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300'
              }`}>
                {error ? 'OFFLINE' : 'LIVE 200 OK'}
              </span>
            </div>

            {error && (
              <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 rounded-[var(--radius-lg)] text-rose-800 dark:text-rose-300 font-data text-xs space-y-2">
                <strong>LIVE RELIABILITY DATA UNAVAILABLE:</strong>
                <p>{error}</p>
                <button
                  onClick={loadAnalysis}
                  className="px-3 py-1 bg-rose-600 text-white rounded font-bold text-scale-xs hover:bg-rose-700 cursor-pointer"
                >
                  Retry Connection
                </button>
              </div>
            )}

            {!error && (
              <>
                {/* 4 Stat Cards Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-data">
                  {/* Current Blend */}
                  <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-2xs">
                    <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase block">
                      VARUNA Blend (+{leadH}h)
                    </span>
                    <span className="text-2xl font-bold text-[var(--varuna-blue-dark)] block mt-0.5">
                      {blendVal !== null && blendVal !== undefined ? `${blendVal} ${unit}` : '—'}
                    </span>
                    <span className="text-[10px] text-[var(--varuna-text-secondary)]">
                      {isAdaptive ? 'Adaptive XGBoost' : 'Equal Consensus'}
                    </span>
                  </div>

                  {/* Risk Score */}
                  <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-2xs">
                    <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase block">
                      Risk Score
                    </span>
                    <span className="text-2xl font-bold text-[var(--varuna-text)] block mt-0.5">
                      {riskScore} <span className="text-scale-xs font-normal text-[var(--varuna-text-muted)]">/ 100</span>
                    </span>
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: getRiskColor(riskSeverity) }}
                    >
                      {riskSeverity} SEVERITY
                    </span>
                  </div>

                  {/* Model Confidence */}
                  <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-2xs">
                    <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase block">
                      Confidence
                    </span>
                    <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 block mt-0.5">
                      {confidence}%
                    </span>
                    <span className="text-[10px] text-[var(--varuna-text-secondary)]">
                      Ensemble Agreement
                    </span>
                  </div>

                  {/* Bust Probability */}
                  <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-2xs">
                    <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase block">
                      Bust Risk
                    </span>
                    <span className={`text-2xl font-bold block mt-0.5 ${bustProb > 30 ? 'text-amber-600' : 'text-[var(--varuna-text)]'}`}>
                      {bustProb}%
                    </span>
                    <span className="text-[10px] text-[var(--varuna-text-secondary)]">
                      P(error &gt; tolerance)
                    </span>
                  </div>
                </div>

                {/* Live Forecast Timeseries Graph (Recharts) */}
                <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-scale-xs font-bold uppercase tracking-wider text-[var(--varuna-text)] font-data">
                        Live Multi-NWP Forecast Timeseries (0h to +168h)
                      </h3>
                      <p className="text-[11px] text-[var(--varuna-text-secondary)]">
                        ECMWF IFS, AIFS, NOAA GFS, DWD ICON and calibrated VARUNA Blend
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {timeSeries.length > 0 && timeSeries.every((pt) => Number(pt.VARUNA || 0) === 0 && Number(pt.IFS || 0) === 0) && (
                        <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-800 font-data">
                          0.0 {unit} Consensus (Dry / Zero Accumulation)
                        </span>
                      )}
                      <span className="text-[11px] font-data font-bold text-[var(--varuna-blue-dark)]">
                        Spread: {spread} {unit}
                      </span>
                    </div>
                  </div>

                  {timeSeries.length > 0 ? (
                    <div className="h-[230px] w-full pt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={timeSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--varuna-border)" opacity={0.6} />
                          <XAxis
                            dataKey="lead_time_hours"
                            stroke="var(--varuna-text-muted)"
                            fontSize={10}
                            tickFormatter={(v) => `+${v}h`}
                          />
                          <YAxis
                            stroke="var(--varuna-text-muted)"
                            fontSize={10}
                            domain={[0, (dataMax) => (dataMax > 0 ? 'auto' : (variable === 'rainfall' ? 5 : 1))]}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'var(--varuna-surface)',
                              borderColor: 'var(--varuna-border)',
                              borderRadius: '8px',
                              fontSize: '11px',
                              fontFamily: 'monospace',
                            }}
                            formatter={(value, name) => [`${value} ${unit}`, name]}
                            labelFormatter={(label) => `Lead: +${label}h`}
                          />
                          {analysis?.valid_time && (
                            <ReferenceLine
                              x={leadH}
                              stroke="#DC2626"
                              strokeDasharray="3 3"
                              label={{ value: `Selected +${leadH}h`, position: 'top', fill: '#DC2626', fontSize: 10 }}
                            />
                          )}
                          <Line type="monotone" dataKey="IFS" stroke="#1E40AF" strokeWidth={1.5} dot={false} name="ECMWF IFS" />
                          <Line type="monotone" dataKey="AIFS" stroke="#0284C7" strokeWidth={1.5} dot={false} name="ECMWF AIFS" />
                          <Line type="monotone" dataKey="GFS" stroke="#0D9488" strokeWidth={1.5} dot={false} name="NOAA GFS" />
                          <Line type="monotone" dataKey="ICON" stroke="#64748B" strokeWidth={1.5} dot={false} name="DWD ICON" />
                          <Line type="monotone" dataKey="VARUNA" stroke="#2563EB" strokeWidth={3} dot={{ r: 2 }} name="VARUNA BLEND" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[200px] flex items-center justify-center text-scale-xs text-[var(--varuna-text-muted)] font-data">
                      {loading ? 'Synchronizing 0h–168h multi-model timeseries…' : 'No timeseries points returned for this horizon'}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-data text-[var(--varuna-text-muted)] pt-1 border-t border-[var(--varuna-border)]">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#1E40AF]" /> IFS</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#0284C7]" /> AIFS</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#0D9488]" /> GFS</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#64748B]" /> ICON</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" /> VARUNA</span>
                    </div>
                    <span>Vertical line marks active +{leadH}h lead</span>
                  </div>
                </div>

                {/* 4-Member NWP Ensemble Breakdown Table */}
                <div className="border border-[var(--varuna-border)] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--varuna-surface)] shadow-2xs font-data">
                  <div className="p-3 bg-[var(--varuna-surface-soft)] border-b border-[var(--varuna-border)] flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--varuna-text)]">
                      NWP Member Telemetry &amp; Apportionment (+{leadH}h)
                    </span>
                    <span className="text-[10px] text-[var(--varuna-text-muted)]">
                      {isAdaptive ? 'XGBoost Error-Weighted' : 'Equal 25/25/25/25 Consensus'}
                    </span>
                  </div>

                  <table className="w-full text-left text-scale-xs border-collapse">
                    <thead className="bg-[var(--varuna-surface)] border-b border-[var(--varuna-border)] text-[10px] text-[var(--varuna-text-muted)] uppercase">
                      <tr>
                        <th className="py-2 px-3">Model Member</th>
                        <th className="py-2 px-2 text-right">Forecast</th>
                        <th className="py-2 px-2 text-right">{isAdaptive ? 'Pred. Error' : 'Architecture'}</th>
                        <th className="py-2 px-3 text-right">Apportionment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--varuna-border)] text-[11px]">
                      <tr>
                        <td className="py-2 px-3 font-semibold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#1E40AF]" />
                          ECMWF IFS (9km)
                        </td>
                        <td className="py-2 px-2 text-right font-bold text-[var(--varuna-text)]">
                          {models.ecmwf_ifs !== null && models.ecmwf_ifs !== undefined ? `${models.ecmwf_ifs} ${unit}` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right text-[var(--varuna-text-secondary)]">
                          {isAdaptive && predErrors.ecmwf_ifs ? `${predErrors.ecmwf_ifs.toFixed(2)} ${unit}` : 'Physical NWP'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-blue-700 dark:text-blue-400">
                          {weights.ecmwf_ifs ?? 25}%
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#0284C7]" />
                          ECMWF AIFS (28km)
                        </td>
                        <td className="py-2 px-2 text-right font-bold text-[var(--varuna-text)]">
                          {models.ecmwf_aifs !== null && models.ecmwf_aifs !== undefined ? `${models.ecmwf_aifs} ${unit}` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right text-[var(--varuna-text-secondary)]">
                          {isAdaptive && predErrors.ecmwf_aifs ? `${predErrors.ecmwf_aifs.toFixed(2)} ${unit}` : 'Neural / AI NWP'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-sky-700 dark:text-sky-400">
                          {weights.ecmwf_aifs ?? 25}%
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#0D9488]" />
                          NOAA GFS (13km)
                        </td>
                        <td className="py-2 px-2 text-right font-bold text-[var(--varuna-text)]">
                          {models.ncep_gfs !== null && models.ncep_gfs !== undefined ? `${models.ncep_gfs} ${unit}` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right text-[var(--varuna-text-secondary)]">
                          {isAdaptive && predErrors.ncep_gfs ? `${predErrors.ncep_gfs.toFixed(2)} ${unit}` : 'Physical Global'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-teal-700 dark:text-teal-400">
                          {weights.ncep_gfs ?? 25}%
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-semibold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#64748B]" />
                          DWD ICON (13km)
                        </td>
                        <td className="py-2 px-2 text-right font-bold text-[var(--varuna-text)]">
                          {models.dwd_icon !== null && models.dwd_icon !== undefined ? `${models.dwd_icon} ${unit}` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right text-[var(--varuna-text-secondary)]">
                          {isAdaptive && predErrors.dwd_icon ? `${predErrors.dwd_icon.toFixed(2)} ${unit}` : 'European Global'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-slate-700 dark:text-slate-400">
                          {weights.dwd_icon ?? 25}%
                        </td>
                      </tr>
                      <tr className="bg-[var(--varuna-blue-light)] font-bold text-[var(--varuna-text)] border-t border-[var(--varuna-border)]">
                        <td className="py-2 px-3 flex items-center gap-1.5 text-[var(--varuna-blue-dark)]">
                          <span className="w-2 h-2 rounded-full bg-[var(--varuna-blue)]" />
                          VARUNA BLEND
                        </td>
                        <td className="py-2 px-2 text-right text-base text-[var(--varuna-blue-dark)]">
                          {blendVal !== null && blendVal !== undefined ? `${blendVal} ${unit}` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right text-emerald-700 dark:text-emerald-400 font-semibold">
                          Ensemble Output
                        </td>
                        <td className="py-2 px-3 text-right text-[var(--varuna-blue-dark)] font-extrabold">
                          100%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Variable-Specific "Why this reliability assessment?" */}
                <div className="p-4 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-scale-xs font-bold uppercase tracking-wider text-[var(--varuna-text)] font-data flex items-center gap-1.5">
                      <span>💡</span> Why This Reliability Assessment?
                    </h3>
                    <span className="text-[10px] font-data text-[var(--varuna-text-muted)]">
                      Variable: {activeVarObj.label}
                    </span>
                  </div>

                  <div className="space-y-2 text-scale-xs">
                    {reasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-[var(--varuna-text)] leading-relaxed">
                        <span className="w-5 h-5 rounded-full bg-[var(--varuna-surface)] border border-[var(--varuna-border)] flex items-center justify-center text-[10px] font-bold font-data text-[var(--varuna-blue)] shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <p>{r}</p>
                      </div>
                    ))}
                  </div>

                  {/* Variable Key Diagnostic Features */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[var(--varuna-border)] font-data text-[11px]">
                    {Object.entries(features).map(([k, v]) => (
                      <div key={k} className="p-2 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded">
                        <span className="text-[10px] text-[var(--varuna-text-muted)] block capitalize">
                          {k.replace(/_/g, ' ')}
                        </span>
                        <strong className="text-[var(--varuna-text)] block mt-0.5">
                          {v}
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Lead Degradation & Horizon Trend (24h to 168h) */}
                {horizonTrend.length > 0 && (
                  <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] shadow-2xs space-y-2 font-data">
                    <div className="flex items-center justify-between">
                      <h3 className="text-scale-xs font-bold uppercase tracking-wider text-[var(--varuna-text)]">
                        Reliability Horizon Trend (24h to 168h)
                      </h3>
                      <span className="text-[10px] text-[var(--varuna-text-muted)]">
                        Lead Degradation Curve
                      </span>
                    </div>

                    <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
                      {horizonTrend.map((h) => {
                        const isCurrent = h.lead_time_hours === leadH;
                        return (
                          <div
                            key={h.lead_time_hours}
                            className={`p-2 rounded border transition-all ${
                              isCurrent
                                ? 'bg-[var(--varuna-blue-light)] border-[var(--varuna-blue)] text-[var(--varuna-blue-dark)] font-bold'
                                : 'bg-[var(--varuna-surface-soft)] border-[var(--varuna-border)] text-[var(--varuna-text-secondary)]'
                            }`}
                          >
                            <span className="text-[10px] font-bold block uppercase text-[var(--varuna-text-muted)]">
                              +{h.lead_time_hours}h
                            </span>
                            <span className="text-sm font-bold block text-[var(--varuna-text)] my-0.5">
                              {h.blend !== null && h.blend !== undefined ? `${h.blend}` : '—'}
                            </span>
                            <span className="text-[10px] block text-emerald-700 dark:text-emerald-400 font-semibold">
                              {h.confidence}% conf
                            </span>
                            <span className="text-[9px] block text-[var(--varuna-text-muted)]">
                              ±{h.spread} {unit}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer note */}
          <div className="p-3 border-t border-[var(--varuna-border)] bg-[var(--varuna-surface-soft)] shrink-0 flex items-center justify-between text-[11px] font-data text-[var(--varuna-text-secondary)]">
            <span>VARUNA Core · Open-Meteo Gateway Ingestion</span>
            <span className="font-bold text-[var(--varuna-blue-dark)]">
              {analysis?.data_mode ? `${analysis.data_mode} CYCLE` : 'LIVE CYCLE'}
            </span>
          </div>
        </motion.aside>
      </div>
    </AnimatePresence>
  );
}
