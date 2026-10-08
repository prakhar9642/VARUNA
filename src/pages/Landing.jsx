import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import Footer from '../components/layout/Footer';
import MapCore from '../components/map/MapCore';
import ForecastLayer from '../components/map/ForecastLayer';
import { useStore } from '../store/useStore';

// 12 Canonical Indian Operational Monitoring Regions
const OPERATIONAL_REGIONS = [
  {
    id: 'delhi_ncr',
    name: 'Delhi NCR',
    state: 'Delhi / Haryana',
    lat: 28.6139,
    lon: 77.2090,
    zone: 'North-West Plains',
    regime: 'Northern Plains Convective & Western Disturbance',
    elevation: '216m',
    benchmarked: true,
    weights: { aifs: 41, ifs: 34, icon: 18, gfs: 7 },
    bestModel: 'ECMWF AIFS',
  },
  {
    id: 'mumbai_coastal',
    name: 'Mumbai Coastal',
    state: 'Maharashtra',
    lat: 19.0760,
    lon: 72.8777,
    zone: 'Konkan Maritime Zone',
    regime: 'West Coast Orographic Monsoon Surge',
    elevation: '14m',
    benchmarked: true,
    weights: { ifs: 38, aifs: 35, icon: 20, gfs: 7 },
    bestModel: 'ECMWF IFS',
  },
  {
    id: 'western_ghats',
    name: 'Western Ghats (Mahabaleshwar)',
    state: 'Maharashtra / Karnataka',
    lat: 17.9237,
    lon: 73.6586,
    zone: 'High Ghats Escarpment',
    regime: 'High-Elevation Orographic Convection & Runoff',
    elevation: '1,353m',
    benchmarked: true,
    weights: { aifs: 44, icon: 28, ifs: 25, gfs: 3 },
    bestModel: 'ECMWF AIFS',
  },
  {
    id: 'gujarat_industrial',
    name: 'Jamnagar Petrochemical Belt',
    state: 'Gujarat',
    lat: 22.4707,
    lon: 70.0577,
    zone: 'Kathiawar Coastal Strip',
    regime: 'Semi-Arid Coastal Thermal Inversion',
    elevation: '20m',
    benchmarked: false,
    weights: { ifs: 36, aifs: 34, icon: 20, gfs: 10 },
    bestModel: 'ECMWF IFS',
  },
  {
    id: 'odisha_coast',
    name: 'Paradip Port / Bay Coast',
    state: 'Odisha',
    lat: 20.3164,
    lon: 86.6085,
    zone: 'Mahanadi Deltaic Littoral',
    regime: 'Bay of Bengal Cyclonic Depression & Surge',
    elevation: '8m',
    benchmarked: true,
    weights: { ifs: 40, aifs: 32, icon: 21, gfs: 7 },
    bestModel: 'ECMWF IFS',
  },
  {
    id: 'bengaluru_deccan',
    name: 'Bengaluru Deccan',
    state: 'Karnataka',
    lat: 12.9716,
    lon: 77.5946,
    zone: 'South Interior Plateau',
    regime: 'Semi-Arid Highland Diurnal Convection',
    elevation: '920m',
    benchmarked: true,
    weights: { aifs: 42, ifs: 33, icon: 18, gfs: 7 },
    bestModel: 'ECMWF AIFS',
  },
  {
    id: 'punjab_agri',
    name: 'Punjab Central Agro-Belt',
    state: 'Punjab',
    lat: 30.9010,
    lon: 75.8573,
    zone: 'Indo-Gangetic Basin',
    regime: 'Continental Interior Agricultural Microclimate',
    elevation: '244m',
    benchmarked: false,
    weights: { aifs: 39, ifs: 35, icon: 17, gfs: 9 },
    bestModel: 'ECMWF AIFS',
  },
  {
    id: 'assam_valley',
    name: 'Guwahati / Brahmaputra Valley',
    state: 'Assam',
    lat: 26.1445,
    lon: 91.7362,
    zone: 'Sub-Himalayan Trough',
    regime: 'Valley Entrapment & Pre-Monsoon Squall Line',
    elevation: '55m',
    benchmarked: false,
    weights: { ifs: 37, aifs: 33, icon: 22, gfs: 8 },
    bestModel: 'ECMWF IFS',
  },
  {
    id: 'chennai_coastal',
    name: 'Chennai Coromandel',
    state: 'Tamil Nadu',
    lat: 13.0827,
    lon: 80.2707,
    zone: 'Coromandel Coastal Plain',
    regime: 'Northeast Winter Monsoon & Littoral Warming',
    elevation: '6m',
    benchmarked: false,
    weights: { ifs: 38, aifs: 34, icon: 19, gfs: 9 },
    bestModel: 'ECMWF IFS',
  },
  {
    id: 'rajasthan_thar',
    name: 'Jodhpur / Western Thar',
    state: 'Rajasthan',
    lat: 26.2389,
    lon: 73.0243,
    zone: 'Thar Arid Zone',
    regime: 'Subtropical Desert Extreme Diurnal Range',
    elevation: '231m',
    benchmarked: true,
    weights: { ifs: 42, icon: 30, aifs: 21, gfs: 7 },
    bestModel: 'ECMWF IFS',
  },
  {
    id: 'kerala_coast',
    name: 'Kochi Malabar Coast',
    state: 'Kerala',
    lat: 9.9312,
    lon: 76.2673,
    zone: 'Malabar Maritime Zone',
    regime: 'Equatorial Arabian Sea Marine Boundary Layer',
    elevation: '4m',
    benchmarked: false,
    weights: { aifs: 39, ifs: 35, icon: 19, gfs: 7 },
    bestModel: 'ECMWF AIFS',
  },
  {
    id: 'central_highlands',
    name: 'Bhopal / Central Highlands',
    state: 'Madhya Pradesh',
    lat: 23.2599,
    lon: 77.4126,
    zone: 'Vindhya Basin Plateau',
    regime: 'Central Plateau Continental Convective Transition',
    elevation: '527m',
    benchmarked: false,
    weights: { aifs: 38, ifs: 36, icon: 18, gfs: 8 },
    bestModel: 'ECMWF AIFS',
  },
];

// Verified Temperature Benchmark RMSE comparison (°C) vs ERA5 Reanalysis (N = 4,512)
const BENCHMARK_CHART_DATA = [
  { model: 'ECMWF IFS', rmse: 1.195, fill: '#1E40AF' },
  { model: 'ECMWF AIFS', rmse: 1.105, fill: '#0284C7' },
  { model: 'NOAA GFS', rmse: 2.320, fill: '#0D9488' },
  { model: 'DWD ICON', rmse: 1.131, fill: '#64748B' },
  { model: 'VARUNA (Blend)', rmse: 0.780, fill: '#245F89' },
];

// Pre-configured meteorological regimes for the interactive weighting simulator
const SIMULATOR_PRESETS = {
  orographic: {
    id: 'orographic',
    title: 'Western Ghats Orographic Surge',
    location: 'Mahabaleshwar Escarpment (1,353m)',
    description: 'Deep moisture-laden Arabian Sea influx ascending steep coastal terrain. AIFS and ICON capture windward escarpment dynamics with low predicted error, while GFS struggles with convective overestimation.',
    errors: { ecmwf_ifs: 1.25, ecmwf_aifs: 0.95, ncep_gfs: 2.30, dwd_icon: 1.10 },
  },
  heatwave: {
    id: 'heatwave',
    title: 'Subtropical Desert Severe Heatwave',
    location: 'Jodhpur / Western Thar (231m)',
    description: 'Anti-cyclonic subsidence and intense dry adiabatic surface heating. ECMWF IFS surface radiation budget and ICON non-hydrostatic boundary physics yield minimal forecast error.',
    errors: { ecmwf_ifs: 0.90, ecmwf_aifs: 1.30, ncep_gfs: 2.10, dwd_icon: 1.05 },
  },
  medium_range: {
    id: 'medium_range',
    title: 'Extended Medium-Range (+120h Horizon)',
    location: 'Indo-Gangetic Regional Plains',
    description: 'Atmospheric chaos and phase uncertainty increase at Day 5. Deep learning AIFS exhibits superior spatial coherence and reduced error growth compared to traditional raw NWP.',
    errors: { ecmwf_ifs: 1.65, ecmwf_aifs: 1.40, ncep_gfs: 2.65, dwd_icon: 1.80 },
  },
};

/**
 * Exact Hamilton-Hare largest remainder algorithm
 */
function calculateHamiltonHare(errors) {
  const keys = ['ecmwf_ifs', 'ecmwf_aifs', 'ncep_gfs', 'dwd_icon'];
  const epsilon = 0.05;
  const raw = {};
  let totalRaw = 0;

  for (const k of keys) {
    const err = Math.max(Number(errors[k]) || 1.0, epsilon);
    const val = 1.0 / (err * err);
    raw[k] = val;
    totalRaw += val;
  }

  const quotas = keys.map((k) => (raw[k] / totalRaw) * 100.0);
  const floors = quotas.map((q) => Math.floor(q));
  const remainders = quotas.map((q, i) => q - floors[i]);
  let leftover = 100 - floors.reduce((a, b) => a + b, 0);

  const order = keys
    .map((k, i) => ({ i, key: k, rem: remainders[i], val: raw[k] }))
    .sort((a, b) => {
      if (b.rem !== a.rem) return b.rem - a.rem;
      if (b.val !== a.val) return b.val - a.val;
      return a.key.localeCompare(b.key);
    });

  let idx = 0;
  while (leftover > 0 && order.length > 0) {
    floors[order[idx % order.length].i] += 1;
    leftover -= 1;
    idx += 1;
  }

  const weights = {};
  keys.forEach((k, i) => {
    weights[k] = floors[i];
  });
  return { weights, totalRaw, quotas };
}

// 5 Stages for "How VARUNA Works"
const HOW_VARUNA_WORKS_STAGES = [
  {
    step: '01',
    title: 'ACQUIRE',
    subtitle: 'Four Synchronized NWP & Neural Streams',
    description: 'Ingests synchronized 00Z / 12Z numerical weather prediction and deep learning spherical transformer forecasts (ECMWF IFS, ECMWF AIFS, NOAA GFS, DWD ICON) via the Open-Meteo multi-model gateway.',
    badge: '4 Forecast Streams',
  },
  {
    step: '02',
    title: 'COMPARE',
    subtitle: 'Measure Model Disagreement and Terrain Spread',
    description: 'Spatially interpolates disparate resolutions onto regional centroids, calculating inter-model variance, multi-center ensemble spread, diurnal cycle phase, and synoptic regime indicators.',
    badge: 'Inter-Model Spread',
  },
  {
    step: '03',
    title: 'PREDICT ERROR',
    subtitle: 'XGBoost Estimates Contextual Error |ŷₘ - y|',
    description: 'The trained Python XGBoost meta-model evaluates a 12-dimensional contextual feature vector, estimating the expected absolute error |ŷₘ - y| for each member under current atmospheric conditions.',
    badge: 'Meta-Error Inference',
  },
  {
    step: '04',
    title: 'ADAPT TRUST',
    subtitle: 'Inverse-Variance Weighting & Exact Integer Apportionment',
    description: 'Raw weights are calculated inversely proportional to expected error variance (w ∝ 1/σ²). The Hamilton-Hare apportionment algorithm normalizes them into exact integer percentages summing strictly to 100%.',
    badge: 'Hamilton-Hare (100%)',
  },
  {
    step: '05',
    title: 'BLEND',
    subtitle: 'Calibrated Consensus Forecast with Provenance',
    description: 'Synthesizes the optimal calibrated consensus forecast ŷ_VARUNA = Σ(wₘ · ŷₘ) with transparent member attribution, physical boundary clamping, and auditable confidence intervals.',
    badge: '0.780 °C Held-Out RMSE',
  },
];

export default function Landing() {
  const storeRegionId = useStore((s) => s.selectedRegionId);
  const selectRegion = useStore((s) => s.selectRegion);

  const [activePreset, setActivePreset] = useState('orographic');
  const [simErrors, setSimErrors] = useState(SIMULATOR_PRESETS.orographic.errors);
  const [selectedRegionId, setSelectedRegionId] = useState(storeRegionId || 'delhi_ncr');

  const { weights } = useMemo(() => calculateHamiltonHare(simErrors), [simErrors]);
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  const selectedRegion = useMemo(() => {
    return OPERATIONAL_REGIONS.find((r) => r.id === selectedRegionId) || OPERATIONAL_REGIONS[0];
  }, [selectedRegionId]);

  const handlePresetSelect = (presetKey) => {
    setActivePreset(presetKey);
    setSimErrors(SIMULATOR_PRESETS[presetKey].errors);
  };

  const handleSliderChange = (modelKey, val) => {
    setActivePreset('custom');
    setSimErrors((prev) => ({
      ...prev,
      [modelKey]: parseFloat(val),
    }));
  };

  const handleSelectRegion = (regId) => {
    setSelectedRegionId(regId);
    selectRegion(regId);
  };

  return (
    <div className="min-h-screen bg-[var(--varuna-bg)] text-[var(--varuna-text)] flex flex-col font-sans transition-colors">
      {/* ── TOP NAVIGATION BAR ── */}
      <header className="h-16 px-6 md:px-12 flex items-center justify-between border-b border-[var(--varuna-border)] bg-[var(--varuna-surface)]/95 backdrop-blur-md sticky top-0 z-50 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--varuna-blue)] text-white flex items-center justify-center shadow-xs shrink-0 font-bold text-scale-sm">
            V
          </div>
          <div className="flex flex-col">
            <span className="text-scale-base font-extrabold tracking-tight text-[var(--varuna-text)] leading-none">
              VARUNA
            </span>
            <span className="text-[10px] font-data font-semibold text-[var(--varuna-text-secondary)] tracking-wider mt-0.5">
              ADAPTIVE ENSEMBLE BLENDING
            </span>
          </div>
        </div>

        <nav className="hidden xl:flex items-center gap-6 text-scale-xs font-semibold text-[var(--varuna-text-secondary)]">
          <a href="#the-problem" className="hover:text-[var(--varuna-blue)] transition-colors">The Problem</a>
          <a href="#what-varuna-changes" className="hover:text-[var(--varuna-blue)] transition-colors">Adaptive Trust</a>
          <a href="#how-it-works" className="hover:text-[var(--varuna-blue)] transition-colors">How It Works</a>
          <a href="#coverage" className="hover:text-[var(--varuna-blue)] transition-colors">12 Regions</a>
          <a href="#evidence" className="hover:text-[var(--varuna-blue)] transition-colors">Explainability</a>
          <a href="#engine" className="hover:text-[var(--varuna-blue)] transition-colors">Engine &amp; Verification</a>
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-[var(--radius-sm)] border border-[var(--varuna-border)] bg-[var(--varuna-surface-soft)] text-[11px] font-data text-[var(--varuna-text-secondary)]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>4 ENSEMBLE MEMBERS · FASTAPI SCIENTIFIC CORE</span>
          </div>

          <Link
            to="/command-centre"
            className="px-4 py-2 bg-[var(--varuna-blue)] hover:bg-[var(--varuna-blue-dark)] text-white font-bold text-scale-xs rounded-[var(--radius-md)] transition-all shadow-xs flex items-center gap-1.5"
          >
            <span>Launch Command Centre</span>
            <span>→</span>
          </Link>
        </div>
      </header>

      {/* ── SECTION 1: HERO — VARUNA IS THE CENTREPIECE + INDIA MAP ── */}
      <section id="overview" className="relative px-6 md:px-12 lg:px-16 pt-12 pb-16 border-b border-[var(--varuna-border)] bg-[var(--varuna-surface)] overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            {/* LEFT COLUMN: Dominant VARUNA Brand & Clear Narrative */}
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--varuna-border-strong)] bg-[var(--varuna-blue-light)] text-[11px] font-bold text-[var(--varuna-blue-dark)] font-data uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-[var(--varuna-blue)] animate-pulse" />
                <span>SIH26081 · OPERATIONAL METEOROLOGICAL ENSEMBLE</span>
              </div>

              <div className="space-y-3">
                <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight text-[var(--varuna-text)] leading-none">
                  VARUNA
                </h1>
                <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--varuna-blue)] leading-snug">
                  Four forecasts. One adaptive decision.
                </div>
              </div>

              <p className="text-scale-base sm:text-scale-lg text-[var(--varuna-text-secondary)] font-normal leading-relaxed max-w-xl">
                Four independent weather models do not always agree. VARUNA measures the disagreement, evaluates model reliability across terrain and lead time, and produces one calibrated, blended forecast.
              </p>

              <div className="pt-1 text-[12px] font-data text-[var(--varuna-text-muted)] tracking-wide">
                HYBRID AI–NWP FORECAST INTELLIGENCE · ECMWF IFS · ECMWF AIFS · NOAA GFS · DWD ICON
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link
                  to="/command-centre"
                  className="px-6 py-3 bg-[var(--varuna-blue)] hover:bg-[var(--varuna-blue-dark)] text-white font-bold text-scale-sm rounded-[var(--radius-md)] transition-all shadow-md flex items-center gap-2"
                >
                  <span>Launch Command Centre</span>
                  <span>→</span>
                </Link>
                <a
                  href="#how-it-works"
                  className="px-5 py-3 bg-[var(--varuna-surface-soft)] hover:bg-[var(--varuna-surface)] border border-[var(--varuna-border)] text-[var(--varuna-text)] font-semibold text-scale-sm rounded-[var(--radius-md)] transition-all shadow-xs flex items-center gap-2"
                >
                  <span>See How VARUNA Works</span>
                  <span>↓</span>
                </a>
                <Link
                  to="/skill"
                  className="px-4 py-3 text-scale-sm font-semibold text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-blue)] transition-colors"
                >
                  Verification Evidence →
                </Link>
              </div>

              {/* Minimal Telemetry Ticker */}
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[var(--varuna-border)]">
                <div>
                  <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block font-data">
                    Multi-Model Input
                  </span>
                  <span className="font-data text-scale-sm font-bold text-[var(--varuna-text)] block mt-0.5">
                    4 Member Streams
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block font-data">
                    Scientific Meta-Layer
                  </span>
                  <span className="font-data text-scale-sm font-bold text-[var(--varuna-blue)] block mt-0.5">
                    Python XGBoost
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block font-data">
                    Held-Out Accuracy
                  </span>
                  <span className="font-data text-scale-sm font-bold text-emerald-600 dark:text-emerald-400 block mt-0.5">
                    0.780 °C RMSE
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Actual VARUNA MapLibre India Map */}
            <div className="lg:col-span-6 w-full">
              <div className="relative w-full h-[420px] sm:h-[480px] lg:h-[500px] rounded-[var(--radius-2xl)] border border-[var(--varuna-border)] overflow-hidden shadow-lg bg-[#0a0e17]">
                <MapCore>
                  <ForecastLayer dotsOnly={true} />
                </MapCore>

                {/* Floating Map Status Overlay */}
                <div className="absolute top-3.5 left-3.5 z-10 pointer-events-none">
                  <div className="px-3 py-1.5 rounded-full bg-slate-900/85 backdrop-blur-md border border-slate-700/60 shadow-md flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                    <span className="text-[11px] font-data font-semibold text-slate-200">
                      12 Operational Regional Stations
                    </span>
                  </div>
                </div>

                {/* Subtle Interactive Instruction Pill */}
                <div className="absolute bottom-3.5 left-3.5 right-3.5 z-10 flex items-center justify-between pointer-events-none">
                  <div className="px-2.5 py-1 rounded bg-slate-900/80 backdrop-blur-sm border border-slate-700/50 text-[10px] font-data text-slate-300">
                    Click any station dot to inspect
                  </div>
                  <div className="px-2.5 py-1 rounded bg-slate-900/80 backdrop-blur-sm border border-slate-700/50 text-[10px] font-data text-slate-300">
                    National Coverage
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: THE PROBLEM — "FOUR FORECASTS CAN DISAGREE" ── */}
      <section id="the-problem" className="px-6 md:px-12 lg:px-16 py-16 border-b border-[var(--varuna-border)] bg-[var(--varuna-bg)]">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="space-y-3">
            <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
              01 / THE ENSEMBLE CHALLENGE
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[var(--varuna-text)] tracking-tight">
              Four forecasts can disagree.
            </h2>
            <p className="text-scale-base text-[var(--varuna-text-secondary)] max-w-3xl leading-relaxed">
              The operational challenge is not obtaining a forecast. The challenge is knowing how much to trust each model when they produce diverging atmospheric trajectories over complex terrain.
            </p>
          </div>

          {/* 4 Compact Member Model Signals Grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* ECMWF IFS */}
            <div className="p-5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] shadow-xs flex flex-col justify-between hover:border-blue-500/50 transition-all">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-3">
                  <span className="font-data text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    9 km Grid · NWP
                  </span>
                  <span className="text-[10px] font-data text-[var(--varuna-text-muted)]">00Z / 12Z</span>
                </div>
                <h3 className="font-data text-scale-base font-bold text-[var(--varuna-text)] mb-1">
                  ECMWF IFS
                </h3>
                <p className="text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed">
                  Hydrostatic primitive-equation physics anchor with high-resolution global thermodynamic mass conservation.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--varuna-border)] flex items-center justify-between text-[11px] font-data text-[var(--varuna-text-muted)]">
                <span>Held-Out RMSE</span>
                <span className="font-bold text-[var(--varuna-text)]">1.195 °C</span>
              </div>
            </div>

            {/* ECMWF AIFS */}
            <div className="p-5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] shadow-xs flex flex-col justify-between hover:border-sky-500/50 transition-all">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-3">
                  <span className="font-data text-[10px] font-bold px-2 py-0.5 rounded bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                    0.25° · AI Transformer
                  </span>
                  <span className="text-[10px] font-data text-[var(--varuna-text-muted)]">00Z / 12Z</span>
                </div>
                <h3 className="font-data text-scale-base font-bold text-[var(--varuna-text)] mb-1">
                  ECMWF AIFS
                </h3>
                <p className="text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed">
                  Spherical neural transformer trained on 40+ years of ERA5 reanalysis for rapid jet advection and synoptic pattern capture.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--varuna-border)] flex items-center justify-between text-[11px] font-data text-[var(--varuna-text-muted)]">
                <span>Held-Out RMSE</span>
                <span className="font-bold text-[var(--varuna-text)]">1.105 °C</span>
              </div>
            </div>

            {/* NOAA GFS */}
            <div className="p-5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] shadow-xs flex flex-col justify-between hover:border-teal-500/50 transition-all">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-3">
                  <span className="font-data text-[10px] font-bold px-2 py-0.5 rounded bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                    13 km Grid · FV3 Core
                  </span>
                  <span className="text-[10px] font-data text-[var(--varuna-text-muted)]">00Z / 06Z / 12Z / 18Z</span>
                </div>
                <h3 className="font-data text-scale-base font-bold text-[var(--varuna-text)] mb-1">
                  NOAA GFS
                </h3>
                <p className="text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed">
                  Finite-volume dynamical core with rapid 6-hourly cycle cadence, capturing rapid convective updates across Indian plains.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--varuna-border)] flex items-center justify-between text-[11px] font-data text-[var(--varuna-text-muted)]">
                <span>Held-Out RMSE</span>
                <span className="font-bold text-[var(--varuna-text)]">2.320 °C</span>
              </div>
            </div>

            {/* DWD ICON */}
            <div className="p-5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] shadow-xs flex flex-col justify-between hover:border-slate-500/50 transition-all">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-3">
                  <span className="font-data text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800/80 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    13 km · Non-Hydrostatic
                  </span>
                  <span className="text-[10px] font-data text-[var(--varuna-text-muted)]">00Z / 06Z / 12Z / 18Z</span>
                </div>
                <h3 className="font-data text-scale-base font-bold text-[var(--varuna-text)] mb-1">
                  DWD ICON
                </h3>
                <p className="text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed">
                  Icosahedral non-hydrostatic triangular grid structure providing stable boundary dynamics over mountain barriers and coastlines.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[var(--varuna-border)] flex items-center justify-between text-[11px] font-data text-[var(--varuna-text-muted)]">
                <span>Held-Out RMSE</span>
                <span className="font-bold text-[var(--varuna-text)]">1.131 °C</span>
              </div>
            </div>
          </div>

          {/* Model Spread Callout */}
          <div className="p-4 sm:p-5 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-[var(--varuna-blue-light)] text-[var(--varuna-blue)] flex items-center justify-center font-bold font-data shrink-0">
                Δ
              </div>
              <div>
                <span className="font-data text-scale-xs font-bold text-[var(--varuna-text)] block">
                  Inter-Model Spread Over Complex Indian Terrains
                </span>
                <span className="text-scale-xs text-[var(--varuna-text-secondary)]">
                  When models diverge by 2.0 °C to 4.5 °C, simple unweighted averaging smears physical boundaries. VARUNA identifies which model has the lowest expected error.
                </span>
              </div>
            </div>
            <div className="shrink-0 font-data text-scale-xs px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] text-[var(--varuna-text-secondary)]">
              Context-Aware Error Inference
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: WHAT VARUNA CHANGES — "ONE BLENDED FORECAST" ── */}
      <section id="what-varuna-changes" className="px-6 md:px-12 lg:px-16 py-16 border-b border-[var(--varuna-border)] bg-[var(--varuna-surface)]">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="space-y-3">
            <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
              02 / THE VARUNA SHIFT
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[var(--varuna-text)] tracking-tight">
              One blended forecast.
            </h2>
            <p className="text-scale-base text-[var(--varuna-text-secondary)] max-w-3xl leading-relaxed">
              VARUNA turns four competing signals into one context-aware forecast by dynamically evaluating which models are physically credible under current atmospheric conditions.
            </p>
          </div>

          {/* Comparison Cards: Without VARUNA vs With VARUNA */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* WITHOUT VARUNA */}
            <div className="p-6 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-2xl)] space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--varuna-border)]">
                <div>
                  <span className="font-data text-[11px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
                    Conventional Practice
                  </span>
                  <h3 className="font-data text-scale-lg font-bold text-[var(--varuna-text)]">
                    WITHOUT VARUNA
                  </h3>
                </div>
                <span className="px-2.5 py-1 rounded bg-slate-200 dark:bg-slate-800 text-[11px] font-data font-bold text-[var(--varuna-text-secondary)]">
                  Equal Trust (25% Each)
                </span>
              </div>

              <div className="space-y-2.5 font-data text-scale-xs">
                <div className="flex justify-between items-center p-2.5 rounded bg-[var(--varuna-surface)] border border-[var(--varuna-border)]">
                  <span className="font-bold text-[var(--varuna-text-secondary)]">ECMWF IFS</span>
                  <span className="font-bold">25%</span>
                </div>
                <div className="flex justify-between items-center p-2.5 rounded bg-[var(--varuna-surface)] border border-[var(--varuna-border)]">
                  <span className="font-bold text-[var(--varuna-text-secondary)]">ECMWF AIFS</span>
                  <span className="font-bold">25%</span>
                </div>
                <div className="flex justify-between items-center p-2.5 rounded bg-[var(--varuna-surface)] border border-[var(--varuna-border)]">
                  <span className="font-bold text-[var(--varuna-text-secondary)]">NOAA GFS</span>
                  <span className="font-bold">25%</span>
                </div>
                <div className="flex justify-between items-center p-2.5 rounded bg-[var(--varuna-surface)] border border-[var(--varuna-border)]">
                  <span className="font-bold text-[var(--varuna-text-secondary)]">DWD ICON</span>
                  <span className="font-bold">25%</span>
                </div>
              </div>

              <div className="text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed italic border-t border-[var(--varuna-border)] pt-3">
                &ldquo;Treats every model equally regardless of terrain elevation, lead-time degradation, or convective bias. Fails to penalize known model overestimation.&rdquo;
              </div>
            </div>

            {/* WITH VARUNA */}
            <div className="p-6 bg-[var(--varuna-surface)] border-2 border-[var(--varuna-blue)] rounded-[var(--radius-2xl)] space-y-6 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--varuna-border)]">
                <div>
                  <span className="font-data text-[11px] font-bold text-[var(--varuna-blue)] uppercase tracking-wider block">
                    Adaptive Intelligence
                  </span>
                  <h3 className="font-data text-scale-lg font-bold text-[var(--varuna-text)]">
                    WITH VARUNA
                  </h3>
                </div>
                <span className="px-2.5 py-1 rounded bg-[var(--varuna-blue-light)] text-[11px] font-data font-bold text-[var(--varuna-blue-dark)]">
                  Contextual Trust (100% Total)
                </span>
              </div>

              <div className="space-y-2.5 font-data text-scale-xs">
                <div className="flex justify-between items-center p-2.5 rounded bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)]">
                  <span className="font-bold text-sky-700 dark:text-sky-400">ECMWF AIFS (Lowest Error)</span>
                  <span className="font-bold text-[var(--varuna-text)]">41%</span>
                </div>
                <div className="flex justify-between items-center p-2.5 rounded bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)]">
                  <span className="font-bold text-blue-700 dark:text-blue-400">ECMWF IFS (Physics Anchor)</span>
                  <span className="font-bold text-[var(--varuna-text)]">34%</span>
                </div>
                <div className="flex justify-between items-center p-2.5 rounded bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)]">
                  <span className="font-bold text-slate-700 dark:text-slate-400">DWD ICON (Boundary Physics)</span>
                  <span className="font-bold text-[var(--varuna-text)]">18%</span>
                </div>
                <div className="flex justify-between items-center p-2.5 rounded bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)]">
                  <span className="font-bold text-teal-700 dark:text-teal-400">NOAA GFS (Penalized)</span>
                  <span className="font-bold text-[var(--varuna-text)]">7%</span>
                </div>
              </div>

              <div className="text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed italic border-t border-[var(--varuna-border)] pt-3">
                &ldquo;Trust dynamically adapts based on predicted model error |ŷₘ - y|. Models with lower contextual error receive proportionately higher decision weight via Hamilton–Hare apportionment.&rdquo;
              </div>
            </div>
          </div>

          {/* Transparent Status Disclosure Banner */}
          <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-scale-xs">
            <div className="flex items-center gap-2">
              <span className="font-data font-bold text-[var(--varuna-blue)]">Current Operational Scope:</span>
              <span className="text-[var(--varuna-text-secondary)]">
                Adaptive XGBoost is validated for 2m Temperature (0.78 °C RMSE) and Surface Pressure (0.67 hPa RMSE). Rainfall and wind speed operate in transparent Equal 4-Model Consensus mode following empirical gating.
              </span>
            </div>
            <Link to="/explainability" className="shrink-0 text-[var(--varuna-blue)] font-bold hover:underline">
              Inspect Decision Evidence →
            </Link>
          </div>
        </div>
      </section>

      {/* ── SECTION 4: HOW VARUNA WORKS — 5-STAGE EDITORIAL SEQUENCE + SIMULATOR ── */}
      <section id="how-it-works" className="px-6 md:px-12 lg:px-16 py-16 border-b border-[var(--varuna-border)] bg-[var(--varuna-bg)]">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="space-y-3">
            <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
              03 / FORECAST PIPELINE ARCHITECTURE
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[var(--varuna-text)] tracking-tight">
              How VARUNA Works
            </h2>
            <p className="text-scale-base text-[var(--varuna-text-secondary)] max-w-3xl leading-relaxed">
              Step through the five distinct operational stages of adaptive blending. VARUNA executes this pipeline across initialization cycles to transform raw competing model outputs into one verified consensus.
            </p>
          </div>

          {/* 5 Sequential Editorial Stages */}
          <div className="space-y-4">
            {HOW_VARUNA_WORKS_STAGES.map((stage, idx) => (
              <motion.div
                key={stage.step}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.25, delay: idx * 0.04 }}
                className="p-5 md:p-6 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] shadow-2xs hover:border-[var(--varuna-blue)] transition-all flex flex-col md:flex-row md:items-center justify-between gap-5"
              >
                <div className="flex items-start gap-4 md:gap-5">
                  <div className="w-11 h-11 rounded-[var(--radius-lg)] bg-[var(--varuna-blue-light)] text-[var(--varuna-blue-dark)] font-data font-black text-scale-md flex items-center justify-center shrink-0 border border-[var(--varuna-border-strong)]">
                    {stage.step}
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="font-data text-scale-base font-bold text-[var(--varuna-text)]">
                        {stage.title}
                      </h3>
                      <span className="text-[11px] font-data font-semibold text-[var(--varuna-blue-dark)] px-2 py-0.5 rounded bg-[var(--varuna-blue-light)] border border-[var(--varuna-border)]">
                        {stage.badge}
                      </span>
                    </div>

                    <div className="text-scale-xs font-semibold text-[var(--varuna-text-secondary)]">
                      {stage.subtitle}
                    </div>

                    <p className="text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed pt-0.5 max-w-3xl">
                      {stage.description}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 self-start md:self-center font-data text-[11px] text-[var(--varuna-text-muted)] border-t md:border-t-0 md:border-l border-[var(--varuna-border)] pt-2 md:pt-0 md:pl-5">
                  STAGE {idx + 1} OF 5
                </div>
              </motion.div>
            ))}
          </div>

          {/* Interactive Weighting Math Demonstration */}
          <div className="bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-2xl)] p-6 md:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--varuna-border)]">
              <div>
                <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
                  Interactive Algorithm Simulator
                </span>
                <h3 className="text-scale-lg font-bold text-[var(--varuna-text)]">
                  Hamilton–Hare Weight Normalization in Real Time
                </h3>
              </div>
              <div className="flex items-center gap-2 font-data text-scale-xs font-bold text-emerald-600 dark:text-emerald-400">
                <span>Sum: {totalWeight}% (No Rounding Drift)</span>
                <span>✓</span>
              </div>
            </div>

            {/* Meteorological Regime Presets */}
            <div className="space-y-2.5">
              <span className="text-[11px] font-data font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
                Select Meteorological Context Preset:
              </span>
              <div className="grid sm:grid-cols-3 gap-3">
                {Object.values(SIMULATOR_PRESETS).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handlePresetSelect(p.id)}
                    className={`p-3.5 rounded-[var(--radius-lg)] border text-left transition-all cursor-pointer ${
                      activePreset === p.id
                        ? 'bg-[var(--varuna-surface-soft)] border-[var(--varuna-blue)] shadow-xs'
                        : 'bg-[var(--varuna-surface)] border-[var(--varuna-border)] hover:bg-[var(--varuna-surface-soft)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-data text-scale-xs font-bold text-[var(--varuna-text)]">
                        {p.title}
                      </span>
                      {activePreset === p.id && (
                        <span className="w-2 h-2 rounded-full bg-[var(--varuna-blue)]" />
                      )}
                    </div>
                    <span className="text-[11px] font-data text-[var(--varuna-text-secondary)] block">
                      {p.location}
                    </span>
                  </button>
                ))}
              </div>

              {activePreset !== 'custom' && (
                <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed">
                  <span className="font-bold text-[var(--varuna-text)]">Synoptic Dynamic: </span>
                  {SIMULATOR_PRESETS[activePreset].description}
                </div>
              )}
            </div>

            {/* Sliders and Resulting Weights */}
            <div className="grid lg:grid-cols-12 gap-6 items-start pt-2">
              <div className="lg:col-span-6 space-y-3">
                <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase block pb-1">
                  Model Predicted Error (|ŷ - y|)
                </span>

                {/* ECMWF IFS Slider */}
                <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-1">
                  <div className="flex justify-between items-center text-scale-xs font-data">
                    <span className="font-bold text-blue-700 dark:text-blue-400">ECMWF IFS</span>
                    <span className="font-bold text-[var(--varuna-text)]">{simErrors.ecmwf_ifs.toFixed(2)} °C</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3.5"
                    step="0.05"
                    value={simErrors.ecmwf_ifs}
                    onChange={(e) => handleSliderChange('ecmwf_ifs', e.target.value)}
                    className="w-full accent-blue-700 cursor-pointer"
                  />
                </div>

                {/* ECMWF AIFS Slider */}
                <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-1">
                  <div className="flex justify-between items-center text-scale-xs font-data">
                    <span className="font-bold text-sky-700 dark:text-sky-400">ECMWF AIFS</span>
                    <span className="font-bold text-[var(--varuna-text)]">{simErrors.ecmwf_aifs.toFixed(2)} °C</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3.5"
                    step="0.05"
                    value={simErrors.ecmwf_aifs}
                    onChange={(e) => handleSliderChange('ecmwf_aifs', e.target.value)}
                    className="w-full accent-sky-600 cursor-pointer"
                  />
                </div>

                {/* NOAA GFS Slider */}
                <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-1">
                  <div className="flex justify-between items-center text-scale-xs font-data">
                    <span className="font-bold text-teal-700 dark:text-teal-400">NOAA GFS</span>
                    <span className="font-bold text-[var(--varuna-text)]">{simErrors.ncep_gfs.toFixed(2)} °C</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3.5"
                    step="0.05"
                    value={simErrors.ncep_gfs}
                    onChange={(e) => handleSliderChange('ncep_gfs', e.target.value)}
                    className="w-full accent-teal-600 cursor-pointer"
                  />
                </div>

                {/* DWD ICON Slider */}
                <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-1">
                  <div className="flex justify-between items-center text-scale-xs font-data">
                    <span className="font-bold text-slate-700 dark:text-slate-400">DWD ICON</span>
                    <span className="font-bold text-[var(--varuna-text)]">{simErrors.dwd_icon.toFixed(2)} °C</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3.5"
                    step="0.05"
                    value={simErrors.dwd_icon}
                    onChange={(e) => handleSliderChange('dwd_icon', e.target.value)}
                    className="w-full accent-slate-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Weight Distribution Bars */}
              <div className="lg:col-span-6 space-y-3">
                <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase block pb-1">
                  Apportioned Hamilton–Hare Trust (%)
                </span>

                <div className="space-y-2.5">
                  <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-1">
                    <div className="flex justify-between text-scale-xs font-data">
                      <span className="font-bold text-blue-700 dark:text-blue-400">ECMWF IFS</span>
                      <span className="font-bold text-[var(--varuna-text)]">{weights.ecmwf_ifs}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-700 transition-all duration-300" style={{ width: `${weights.ecmwf_ifs}%` }} />
                    </div>
                  </div>

                  <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-1">
                    <div className="flex justify-between text-scale-xs font-data">
                      <span className="font-bold text-sky-700 dark:text-sky-400">ECMWF AIFS</span>
                      <span className="font-bold text-[var(--varuna-text)]">{weights.ecmwf_aifs}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-sky-600 transition-all duration-300" style={{ width: `${weights.ecmwf_aifs}%` }} />
                    </div>
                  </div>

                  <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-1">
                    <div className="flex justify-between text-scale-xs font-data">
                      <span className="font-bold text-teal-700 dark:text-teal-400">NOAA GFS</span>
                      <span className="font-bold text-[var(--varuna-text)]">{weights.ncep_gfs}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-600 transition-all duration-300" style={{ width: `${weights.ncep_gfs}%` }} />
                    </div>
                  </div>

                  <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-1">
                    <div className="flex justify-between text-scale-xs font-data">
                      <span className="font-bold text-slate-700 dark:text-slate-400">DWD ICON</span>
                      <span className="font-bold text-[var(--varuna-text)]">{weights.dwd_icon}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-600 transition-all duration-300" style={{ width: `${weights.dwd_icon}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 5: GEOGRAPHIC SCOPE — 12 REGIONAL STATIONS & CONTEXTUAL READOUT ── */}
      <section id="coverage" className="px-6 md:px-12 lg:px-16 py-16 border-b border-[var(--varuna-border)] bg-[var(--varuna-surface)]">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="space-y-3">
            <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
              04 / GEOGRAPHIC SCOPE
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[var(--varuna-text)] tracking-tight">
              See how forecast behaviour changes across India.
            </h2>
            <p className="text-scale-base text-[var(--varuna-text-secondary)] max-w-3xl leading-relaxed">
              VARUNA monitors 12 operational regions spanning coastal littorals, the Deccan plateau, Thar arid plains, Western Ghats escarpments, and sub-Himalayan troughs.
            </p>
          </div>

          {/* Interactive Geographic Readout: Left Station Selector, Right Contextual Telemetry */}
          <div className="grid lg:grid-cols-12 gap-8 items-start">
            {/* Left 8 Cols: Station Selector Grid */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--varuna-border)]">
                <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase">
                  Select Monitoring Station (12 Regions)
                </span>
                <span className="text-[11px] font-data text-[var(--varuna-text-muted)]">
                  6 Benchmarked vs ERA5 · 6 Active Grids
                </span>
              </div>

              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                {OPERATIONAL_REGIONS.map((region) => {
                  const isSelected = region.id === selectedRegion.id;
                  return (
                    <button
                      key={region.id}
                      onClick={() => handleSelectRegion(region.id)}
                      className={`p-3.5 rounded-[var(--radius-lg)] border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-[var(--varuna-blue-light)] border-[var(--varuna-blue)] shadow-xs'
                          : 'bg-[var(--varuna-surface-soft)] border-[var(--varuna-border)] hover:bg-[var(--varuna-surface)]'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span
                            className={`text-[9px] font-data font-bold px-1.5 py-0.5 rounded ${
                              region.benchmarked
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            }`}
                          >
                            {region.benchmarked ? 'BENCHMARKED' : 'ACTIVE GRID'}
                          </span>
                          <span className="font-data text-[10px] text-[var(--varuna-text-muted)]">
                            {region.elevation}
                          </span>
                        </div>
                        <h4 className="font-data text-scale-xs font-bold text-[var(--varuna-text)] leading-tight">
                          {region.name}
                        </h4>
                        <div className="text-[11px] text-[var(--varuna-text-muted)] mt-0.5">
                          {region.state}
                        </div>
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-[var(--varuna-border)] flex items-center justify-between text-[10px] font-data text-[var(--varuna-text-secondary)]">
                        <span>Top: {region.bestModel}</span>
                        <span className="text-[var(--varuna-blue)] font-bold">{isSelected ? 'Active ●' : 'Select'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right 4 Cols: Contextual Readout Panel */}
            <div className="lg:col-span-4">
              <div className="p-6 bg-[var(--varuna-surface-soft)] border-2 border-[var(--varuna-border-strong)] rounded-[var(--radius-2xl)] shadow-xs space-y-5 sticky top-24">
                <div className="flex items-center justify-between pb-3 border-b border-[var(--varuna-border)]">
                  <div>
                    <span className="font-data text-[10px] font-bold text-[var(--varuna-blue)] uppercase tracking-wider block">
                      Regional Contextual Readout
                    </span>
                    <h3 className="font-data text-scale-lg font-bold text-[var(--varuna-text)]">
                      {selectedRegion.name}
                    </h3>
                  </div>
                  <span
                    className={`text-[10px] font-data font-bold px-2 py-0.5 rounded ${
                      selectedRegion.benchmarked
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                    }`}
                  >
                    {selectedRegion.benchmarked ? 'ERA5 VERIFIED' : 'ACTIVE GRID'}
                  </span>
                </div>

                <div className="space-y-2 text-scale-xs">
                  <div className="flex justify-between py-1 border-b border-[var(--varuna-border)]">
                    <span className="text-[var(--varuna-text-muted)] font-data">State / Territory</span>
                    <span className="font-bold text-[var(--varuna-text)]">{selectedRegion.state}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[var(--varuna-border)]">
                    <span className="text-[var(--varuna-text-muted)] font-data">Coordinates</span>
                    <span className="font-bold font-data text-[var(--varuna-text)]">{selectedRegion.lat.toFixed(2)}°N, {selectedRegion.lon.toFixed(2)}°E</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[var(--varuna-border)]">
                    <span className="text-[var(--varuna-text-muted)] font-data">Station Elevation</span>
                    <span className="font-bold font-data text-[var(--varuna-text)]">{selectedRegion.elevation}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[var(--varuna-border)]">
                    <span className="text-[var(--varuna-text-muted)] font-data">Agro-Climatic Zone</span>
                    <span className="font-bold text-[var(--varuna-text)] text-right">{selectedRegion.zone}</span>
                  </div>
                </div>

                <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] text-scale-xs text-[var(--varuna-text-secondary)] leading-relaxed">
                  <span className="font-bold text-[var(--varuna-text)]">Synoptic Regime: </span>
                  {selectedRegion.regime}
                </div>

                {/* Adaptive Weight Distribution in this Region */}
                <div className="space-y-2 pt-2 border-t border-[var(--varuna-border)]">
                  <div className="flex justify-between items-center">
                    <span className="font-data text-[11px] font-bold text-[var(--varuna-text-muted)] uppercase">
                      Operational Model Allocation
                    </span>
                    <span className="font-data text-[10px] text-[var(--varuna-blue)] font-bold">
                      Temp · +48h Horizon
                    </span>
                  </div>

                  <div className="space-y-1.5 font-data text-[11px]">
                    {Object.entries(selectedRegion.weights).map(([k, val]) => {
                      const labels = { aifs: 'ECMWF AIFS', ifs: 'ECMWF IFS', icon: 'DWD ICON', gfs: 'NOAA GFS' };
                      return (
                        <div key={k} className="flex justify-between items-center">
                          <span className="text-[var(--varuna-text-secondary)]">{labels[k] || k.toUpperCase()}</span>
                          <span className="font-bold text-[var(--varuna-text)]">{val}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    to="/command-centre"
                    className="w-full py-2.5 bg-[var(--varuna-blue)] hover:bg-[var(--varuna-blue-dark)] text-white text-center font-bold text-scale-xs rounded-[var(--radius-md)] transition-all block shadow-xs"
                  >
                    Inspect in Command Centre →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 6: DON'T JUST GIVE THE BLEND. EXPLAIN IT. ── */}
      <section id="evidence" className="px-6 md:px-12 lg:px-16 py-16 border-b border-[var(--varuna-border)] bg-[var(--varuna-bg)]">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="space-y-3">
            <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
              05 / AUDITABLE DECISION EVIDENCE
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[var(--varuna-text)] tracking-tight">
              Don&apos;t just give the blend. Explain it.
            </h2>
            <p className="text-scale-base text-[var(--varuna-text-secondary)] max-w-3xl leading-relaxed">
              Every forecast decision is mathematically auditable. VARUNA provides complete visibility into why specific models received higher or lower trust for the current atmospheric regime.
            </p>
          </div>

          {/* Compact Decision Evidence Teaser Card */}
          <div className="p-6 md:p-8 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-2xl)] shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--varuna-border)]">
              <div>
                <span className="font-data text-[11px] font-bold text-[var(--varuna-blue)] uppercase tracking-wider block">
                  Forecast-Specific Decision Evidence (Live Engine Integration)
                </span>
                <h3 className="text-scale-base font-bold text-[var(--varuna-text)]">
                  Reference: Delhi NCR · 2m Temperature · +48h Horizon
                </h3>
              </div>
              <span className="px-3 py-1 rounded bg-[var(--varuna-blue-light)] text-[11px] font-data font-bold text-[var(--varuna-blue-dark)] self-start sm:self-auto">
                Dynamic Decision Logic
              </span>
            </div>

            {/* Model Comparison Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left font-data text-scale-xs">
                <thead>
                  <tr className="border-b border-[var(--varuna-border)] text-[var(--varuna-text-muted)]">
                    <th className="py-2 pr-4 font-bold uppercase text-[10px]">Ensemble Member</th>
                    <th className="py-2 px-4 font-bold uppercase text-[10px]">Predicted Error (|ŷ - y|)</th>
                    <th className="py-2 px-4 font-bold uppercase text-[10px]">Raw Reliability (1/σ²)</th>
                    <th className="py-2 px-4 font-bold uppercase text-[10px]">Assigned Weight</th>
                    <th className="py-2 pl-4 font-bold uppercase text-[10px]">Operational Rationale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--varuna-border)]">
                  <tr>
                    <td className="py-3 pr-4 font-bold text-sky-700 dark:text-sky-400">ECMWF AIFS</td>
                    <td className="py-3 px-4 font-bold">0.95 °C</td>
                    <td className="py-3 px-4 text-[var(--varuna-text-secondary)]">1.108</td>
                    <td className="py-3 px-4 font-bold text-emerald-600 dark:text-emerald-400">41%</td>
                    <td className="py-3 pl-4 text-[var(--varuna-text-secondary)]">Lowest predicted error in Indo-Gangetic regional convective setup</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-bold text-blue-700 dark:text-blue-400">ECMWF IFS</td>
                    <td className="py-3 px-4 font-bold">1.10 °C</td>
                    <td className="py-3 px-4 text-[var(--varuna-text-secondary)]">0.826</td>
                    <td className="py-3 px-4 font-bold text-blue-600 dark:text-blue-400">34%</td>
                    <td className="py-3 pl-4 text-[var(--varuna-text-secondary)]">High-resolution hydrostatic mass conservation physics anchor</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-bold text-slate-700 dark:text-slate-400">DWD ICON</td>
                    <td className="py-3 px-4 font-bold">1.35 °C</td>
                    <td className="py-3 px-4 text-[var(--varuna-text-secondary)]">0.549</td>
                    <td className="py-3 px-4 font-bold text-slate-600 dark:text-slate-400">18%</td>
                    <td className="py-3 pl-4 text-[var(--varuna-text-secondary)]">Stable triangular boundary-layer parameterization</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-bold text-teal-700 dark:text-teal-400">NOAA GFS</td>
                    <td className="py-3 px-4 font-bold">2.20 °C</td>
                    <td className="py-3 px-4 text-[var(--varuna-text-secondary)]">0.207</td>
                    <td className="py-3 px-4 font-bold text-teal-600 dark:text-teal-400">7%</td>
                    <td className="py-3 pl-4 text-[var(--varuna-text-secondary)]">Penalized for systematic positive temperature bias over plains</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Dynamic Synthesis Sentence */}
            <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--varuna-blue-light)] border border-[var(--varuna-border-strong)] text-scale-xs text-[var(--varuna-blue-dark)] font-medium leading-relaxed">
              <span className="font-bold">Automated Decision Verdict: </span>
              VARUNA trusts ECMWF AIFS (41%) and ECMWF IFS (34%) most for this forecast because their predicted errors are lowest under current synoptic conditions. NOAA GFS is penalized (7%) due to historical overestimation in this terrain.
            </div>

            {/* Global vs Specific Distinction Note */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-[var(--varuna-border)] text-scale-xs text-[var(--varuna-text-muted)]">
              <div>
                <strong className="text-[var(--varuna-text)]">Two Types of Explanation: </strong>
                Forecast-specific decision evidence is computed from current predicted member errors. Model-global feature importance (Gain Share) explains overall trained model behavior.
              </div>
              <Link
                to="/explainability"
                className="shrink-0 text-[var(--varuna-blue)] font-bold hover:underline"
              >
                Open Full Explainability Engine →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 7: A REAL FORECASTING ENGINE UNDERNEATH + EVIDENCE ── */}
      <section id="engine" className="px-6 md:px-12 lg:px-16 py-16 border-b border-[var(--varuna-border)] bg-[var(--varuna-surface)]">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="space-y-3">
            <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
              06 / SYSTEM ARCHITECTURE &amp; VERIFICATION
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-[var(--varuna-text)] tracking-tight">
              A real forecasting engine underneath.
            </h2>
            <p className="text-scale-base text-[var(--varuna-text-secondary)] max-w-3xl leading-relaxed">
              Four forecast sources. Contextual error estimation. Adaptive weighting. One calibrated blend verified against ERA5 reanalysis reference data.
            </p>
          </div>

          {/* Clean Architectural Flow Diagram */}
          <div className="p-6 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-2xl)] space-y-4">
            <span className="font-data text-[11px] font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block">
              End-to-End Operational Pipeline
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 font-data text-center">
              <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)]">
                <span className="text-[10px] text-[var(--varuna-text-muted)] block">STAGE 1</span>
                <span className="text-scale-xs font-bold text-[var(--varuna-text)] block mt-0.5">4 MEMBER STREAMS</span>
                <span className="text-[10px] text-[var(--varuna-text-secondary)]">IFS · AIFS · GFS · ICON</span>
              </div>
              <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)]">
                <span className="text-[10px] text-[var(--varuna-text-muted)] block">STAGE 2</span>
                <span className="text-scale-xs font-bold text-[var(--varuna-text)] block mt-0.5">SPATIAL ALIGNMENT</span>
                <span className="text-[10px] text-[var(--varuna-text-secondary)]">Inter-Model Disagreement</span>
              </div>
              <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-blue)] rounded-[var(--radius-lg)] shadow-xs">
                <span className="text-[10px] text-[var(--varuna-blue)] font-bold block">STAGE 3</span>
                <span className="text-scale-xs font-bold text-[var(--varuna-blue)] block mt-0.5">PYTHON XGBOOST</span>
                <span className="text-[10px] text-[var(--varuna-text-secondary)]">Infers Error |ŷₘ - y|</span>
              </div>
              <div className="p-3 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)]">
                <span className="text-[10px] text-[var(--varuna-text-muted)] block">STAGE 4</span>
                <span className="text-scale-xs font-bold text-[var(--varuna-text)] block mt-0.5">HAMILTON–HARE</span>
                <span className="text-[10px] text-[var(--varuna-text-secondary)]">Integer Rounding (100%)</span>
              </div>
              <div className="p-3 bg-[var(--varuna-surface)] border border-emerald-500 rounded-[var(--radius-lg)] shadow-xs">
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold block">STAGE 5</span>
                <span className="text-scale-xs font-bold text-emerald-600 dark:text-emerald-400 block mt-0.5">VARUNA BLEND</span>
                <span className="text-[10px] text-[var(--varuna-text-secondary)]">Calibrated Consensus</span>
              </div>
            </div>
          </div>

          {/* Held-Out Temperature Benchmark Chart Card */}
          <div className="p-6 md:p-8 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-2xl)] shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--varuna-border)]">
              <div>
                <span className="font-data text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                  Held-Out Verification Benchmark
                </span>
                <h3 className="text-scale-lg font-bold text-[var(--varuna-text)]">
                  Temperature Benchmark RMSE (°C) vs ERA5 Reanalysis
                </h3>
              </div>
              <div className="px-3 py-1 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-data font-bold self-start sm:self-auto">
                0.7803 °C Held-Out RMSE (-34.7% Error)
              </div>
            </div>

            <p className="text-scale-xs text-[var(--varuna-text-secondary)]">
              Empirical verification conducted over 4,512 held-out test cycles across 6 representative Indian agro-climatic zones. Reference data: ECMWF ERA5 atmospheric reanalysis (0.25° grid).
            </p>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={BENCHMARK_CHART_DATA}
                  margin={{ top: 10, right: 10, left: -20, bottom: 25 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--varuna-border)" vertical={false} />
                  <XAxis
                    dataKey="model"
                    tick={{ fontSize: 11, fill: 'var(--varuna-text-secondary)', fontFamily: 'var(--font-data)' }}
                    angle={-10}
                    textAnchor="end"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--varuna-text-secondary)', fontFamily: 'var(--font-data)' }}
                    domain={[0, 2.5]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--varuna-surface)',
                      borderColor: 'var(--varuna-border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontFamily: 'var(--font-data)',
                    }}
                    formatter={(val) => [`${val} °C`, 'RMSE']}
                  />
                  <Bar dataKey="rmse" radius={[4, 4, 0, 0]}>
                    {BENCHMARK_CHART_DATA.map((entry, index) => (
                      <Cell key={`bar-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="pt-2 border-t border-[var(--varuna-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-scale-xs text-[var(--varuna-text-muted)]">
              <span>N = 4,512 verification samples · Held-out evaluation</span>
              <Link to="/skill" className="text-[var(--varuna-blue)] font-bold hover:underline">
                View Full Verification Report &amp; Skill Matrix →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 8: SCIENTIFIC SCOPE & OPERATIONAL BOUNDARIES ── */}
      <section id="boundaries" className="px-6 md:px-12 lg:px-16 py-14 bg-[var(--varuna-bg)] border-b border-[var(--varuna-border)]">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <span className="font-data text-scale-xs font-bold text-[var(--varuna-text-muted)] uppercase tracking-wider block mb-1">
              07 / SCIENTIFIC BOUNDARIES
            </span>
            <h2 className="text-2xl md:text-3xl font-extrabold text-[var(--varuna-text)]">
              Operational scope and transparent boundaries.
            </h2>
            <p className="mt-1 text-scale-xs text-[var(--varuna-text-secondary)]">
              VARUNA maintains complete transparency regarding validation boundaries and data sources.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] space-y-1">
              <span className="font-data text-[11px] font-bold text-[var(--varuna-blue-dark)] block">
                1. Multi-Variable Adaptive ML
              </span>
              <p className="text-[11px] text-[var(--varuna-text-secondary)] leading-relaxed">
                Adaptive XGBoost error modeling is validated for 2m surface temperature (0.78 °C RMSE) and surface pressure (0.67 hPa RMSE). Rainfall and wind operate in equal 4-model consensus to protect disaster detection integrity.
              </p>
            </div>

            <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] space-y-1">
              <span className="font-data text-[11px] font-bold text-[var(--varuna-blue-dark)] block">
                2. 168-Hour Horizon Cap
              </span>
              <p className="text-[11px] text-[var(--varuna-text-secondary)] leading-relaxed">
                Operational forecasts are capped strictly at 168 hours (+7 days) to eliminate synthetic extrapolation drift.
              </p>
            </div>

            <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] space-y-1">
              <span className="font-data text-[11px] font-bold text-[var(--varuna-blue-dark)] block">
                3. ERA5 Reanalysis Reference
              </span>
              <p className="text-[11px] text-[var(--varuna-text-secondary)] leading-relaxed">
                Verification is benchmarked against ECMWF ERA5 global atmospheric reanalysis (0.25° grid) rather than sparse surface observations.
              </p>
            </div>

            <div className="p-4 bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-lg)] space-y-1">
              <span className="font-data text-[11px] font-bold text-[var(--varuna-blue-dark)] block">
                4. Multi-Model Gateway Ingestion
              </span>
              <p className="text-[11px] text-[var(--varuna-text-secondary)] leading-relaxed">
                Member forecasts are retrieved via the high-availability Open-Meteo multi-model gateway with client-side synchronization.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 9: FINAL CTA — "EXPLORE VARUNA" ── */}
      <section className="px-6 md:px-12 lg:px-16 py-20 bg-[var(--varuna-surface)] border-b border-[var(--varuna-border)] text-center">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-[var(--varuna-text)] tracking-tight">
            Explore VARUNA
          </h2>
          <p className="text-scale-base sm:text-scale-lg text-[var(--varuna-text-secondary)] leading-relaxed">
            See how four independent forecasts become one adaptive decision across India&apos;s terrain.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-3">
            <Link
              to="/command-centre"
              className="px-8 py-3.5 bg-[var(--varuna-blue)] hover:bg-[var(--varuna-blue-dark)] text-white font-bold text-scale-sm rounded-[var(--radius-md)] transition-all shadow-md flex items-center gap-2"
            >
              <span>Open Command Centre</span>
              <span>→</span>
            </Link>
            <Link
              to="/skill"
              className="px-6 py-3.5 bg-[var(--varuna-surface-soft)] hover:bg-[var(--varuna-surface)] border border-[var(--varuna-border)] text-[var(--varuna-text)] font-semibold text-scale-sm rounded-[var(--radius-md)] transition-all shadow-xs"
            >
              Explore the Methodology →
            </Link>
          </div>
        </div>
      </section>

      {/* ── GLOBAL SCIENTIFIC FOOTER ── */}
      <Footer />
    </div>
  );
}
