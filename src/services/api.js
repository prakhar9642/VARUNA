/**
 * VARUNA Authoritative Frontend API Transport Layer
 *
 * Single transport adapter for communicating with the Python FastAPI backend (/api/*).
 * In development: Uses the Vite dev proxy to http://localhost:8000.
 * In production: Configured via VITE_API_URL environment variable.
 *
 * RULE: This adapter NEVER calculates scientific metrics, NEVER fabricates weights,
 * NEVER generates forecasts, and contains NO simulated XGBoost logic.
 */
import { REGIONS } from '../data/mockData.js';

export function getApiBase() {
  return (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
    (typeof globalThis !== 'undefined' && globalThis.process?.env?.VITE_API_URL) ||
    ''
  ).replace(/\/+$/, '');
}

const CANONICAL_MODEL_NAMES = {
  ecmwf_ifs: {
    id: 'ecmwf_ifs',
    shortId: 'ifs',
    name: 'ECMWF IFS',
    type: 'Physics-Based NWP (9km)',
    color: '#2563EB',
  },
  ecmwf_aifs: {
    id: 'ecmwf_aifs',
    shortId: 'aifs',
    name: 'ECMWF AIFS',
    type: 'Deep Learning Transformer (28km)',
    color: '#8B5CF6',
  },
  ncep_gfs: {
    id: 'ncep_gfs',
    shortId: 'gfs',
    name: 'NOAA GFS',
    type: 'Operational Global NWP (13km)',
    color: '#059669',
  },
  dwd_icon: {
    id: 'dwd_icon',
    shortId: 'icon',
    name: 'DWD ICON',
    type: 'Icosahedral Non-Hydrostatic (13km)',
    color: '#F59E0B',
  },
};

/**
 * Format a valid_time timestamp into a clean chart axis label.
 */
function formatChartTime(isoString, leadHours) {
  if (!isoString) return `+${leadHours}h`;
  try {
    const d = new Date(isoString);
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const hour = String(d.getUTCHours()).padStart(2, '0');
    return `${day}/${month} ${hour}:00`;
  } catch {
    return `+${leadHours}h`;
  }
}

/**
 * Determine meteorological alert level from authoritative IMD criteria.
 */
function determineAlertLevel(variableId, value) {
  if (value === null || value === undefined) {
    return { level: 'Low', reason: 'Awaiting sensor evaluation' };
  }
  if (variableId === 'rainfall') {
    if (value >= 115.6) return { level: 'Critical', reason: 'IMD Very Heavy Rainfall (≥115.6 mm/24h)' };
    if (value >= 64.5) return { level: 'High', reason: 'IMD Heavy Rainfall Warning (≥64.5 mm/24h)' };
    if (value >= 15.6) return { level: 'Moderate', reason: 'Moderate Monsoon Rain Band' };
    return { level: 'Low', reason: 'Precipitation within baseline range' };
  }
  if (variableId === 'temperature') {
    if (value >= 45.0) return { level: 'Critical', reason: 'IMD Severe Heatwave Criteria (≥45.0 °C)' };
    if (value >= 40.0) return { level: 'High', reason: 'IMD Heatwave Advisory (≥40.0 °C)' };
    if (value <= 4.0) return { level: 'High', reason: 'IMD Cold Wave Advisory (≤4.0 °C)' };
    return { level: 'Low', reason: 'Thermal profile within standard seasonal envelope' };
  }
  if (variableId === 'wind_speed') {
    if (value >= 62.0) return { level: 'Critical', reason: 'IMD Gale Force Warning (≥62 km/h)' };
    if (value >= 45.0) return { level: 'High', reason: 'IMD Squally Weather Advisory (≥45 km/h)' };
    return { level: 'Low', reason: 'Surface wind within standard boundary layer limits' };
  }
  if (variableId === 'pressure') {
    if (value < 990.0) return { level: 'Critical', reason: 'Severe Cyclonic Low-Pressure Core (<990 hPa)' };
    if (value < 1000.0) return { level: 'High', reason: 'Tropical Depression Barometric Drop (<1000 hPa)' };
    return { level: 'Low', reason: 'Synoptic surface pressure stable' };
  }
  return { level: 'Low', reason: 'Standard meteorological parameters' };
}

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

const MODEL_SLUGS = {
  ecmwf_ifs: 'ecmwf_ifs025',
  ecmwf_aifs: 'ecmwf_aifs025_single',
  ncep_gfs: 'gfs_seamless',
  dwd_icon: 'icon_seamless',
};

const VARIABLE_METRIC_MAP = {
  temperature: 'temperature_2m',
  rainfall: 'precipitation',
  wind_speed: 'wind_speed_10m',
  pressure: 'surface_pressure',
};

// In-memory cache for normalized Open-Meteo series per region to prevent redundant calls
const clientSeriesCache = new Map();
const CLIENT_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Normalizes a raw Open-Meteo API response item into VARUNA's canonical NWP member series.
 */
export function normalizeOpenMeteoPayload(rawItem, region) {
  const hourly = rawItem.hourly || {};
  const times = hourly.time || [];
  const models = {
    ecmwf_ifs: {},
    ecmwf_aifs: {},
    ncep_gfs: {},
    dwd_icon: {},
  };

  for (const [mKey, slug] of Object.entries(MODEL_SLUGS)) {
    for (const [vKey, omName] of Object.entries(VARIABLE_METRIC_MAP)) {
      const fieldKey = `${omName}_${slug}`;
      models[mKey][vKey] = hourly[fieldKey] || [];
    }
  }

  return {
    time: times,
    elevation_m: rawItem.elevation ?? 0,
    models,
    requested_coordinates: {
      lat: Number(region.lat),
      lon: Number(region.lng || region.lon),
    },
    resolved_coordinates: {
      lat: Number(rawItem.latitude),
      lon: Number(rawItem.longitude),
    },
  };
}

/**
 * Fetch Open-Meteo NWP forecasts directly from the browser for a batch of regions.
 * Uses a single multi-coordinate request to eliminate duplicate upstream traffic.
 */
export async function fetchOpenMeteoBatch(regions) {
  if (!regions || regions.length === 0) return {};

  const now = Date.now();
  const needed = regions.filter((r) => {
    const cached = clientSeriesCache.get(r.id);
    return !cached || now - cached.timestamp > CLIENT_CACHE_TTL_MS;
  });

  if (needed.length > 0) {
    const lats = needed.map((r) => r.lat).join(',');
    const lons = needed.map((r) => r.lng || r.lon).join(',');
    const models = Object.values(MODEL_SLUGS).join(',');
    const hourly = Object.values(VARIABLE_METRIC_MAP).join(',');

    const url = `${OPEN_METEO_BASE}?latitude=${lats}&longitude=${lons}&hourly=${hourly}&models=${models}&forecast_days=8&timezone=GMT&wind_speed_unit=kmh`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Open-Meteo browser fetch failed: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const list = Array.isArray(data) ? data : [data];

    for (const rawItem of list) {
      if (!rawItem) continue;
      const lat = Number(rawItem.latitude);
      const lon = Number(rawItem.longitude);
      let bestDist = Infinity;
      let matchingRegion = null;
      for (const r of needed) {
        const rLat = Number(r.lat);
        const rLon = Number(r.lng || r.lon);
        const dist = Math.hypot(lat - rLat, lon - rLon);
        if (dist < bestDist) {
          bestDist = dist;
          matchingRegion = r;
        }
      }
      if (matchingRegion && bestDist <= 1.0) {
        const series = normalizeOpenMeteoPayload(rawItem, matchingRegion);
        clientSeriesCache.set(matchingRegion.id, { timestamp: now, series });
      }
    }
  }

  const result = {};
  for (const r of regions) {
    const cached = clientSeriesCache.get(r.id);
    if (cached) result[r.id] = cached.series;
  }
  return result;
}

/**
 * Fetch and normalize forecast using BROWSER -> OPEN-METEO -> RENDER VARUNA PROCESSING.
 * If browser direct fetch is unavailable, cleanly falls back to server-side /api/forecast.
 */
export async function fetchForecast({ region = 'delhi_ncr', variable = 'temperature', leadTime = '48h' }) {
  const leadH = typeof leadTime === 'string'
    ? (leadTime.endsWith('d') ? parseInt(leadTime, 10) * 24 : parseInt(leadTime, 10))
    : (leadTime || 48);

  const regObj = REGIONS.find((r) => r.id === region) || { id: region, lat: 28.6139, lon: 77.2090 };

  // Primary Path: BROWSER -> OPEN-METEO -> RENDER VARUNA PROCESSING
  try {
    const seriesMap = await fetchOpenMeteoBatch([regObj]);
    const series = seriesMap[region];
    if (series) {
      const response = await fetch(`${getApiBase()}/api/forecast/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region,
          variable,
          lead_time_hours: leadH,
          series,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return normalizeForecastResponse(data, leadTime);
      }
    }
  } catch (err) {
    console.warn('Browser direct Open-Meteo fetch failed, falling back to server path:', err);
  }

  // Fallback Path: Server-side GET /api/forecast
  const params = new URLSearchParams();
  if (region) params.append('region', region);
  if (variable) params.append('variable', variable);
  if (leadH !== null && leadH !== undefined && !Number.isNaN(leadH)) {
    params.append('lead_time_hours', leadH);
  }

  const url = `${getApiBase()}/api/forecast?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Backend API error (${response.status}): ${errorBody || response.statusText}`);
  }

  const data = await response.json();
  return normalizeForecastResponse(data, leadTime);
}

/**
 * Normalizes the backend /api/forecast response for the UI without altering scientific truth.
 */
export function normalizeForecastResponse(raw, requestedLeadTime) {
  const {
    region_id = 'delhi_ncr',
    variable = 'temperature',
    unit = '°C',
    data_mode = 'LIVE',
    validated = false,
    weighting_scheme = 'equal_fallback_untrained',
    weighting_reason = null,
    regime = {},
    models_used = 4,
    degraded = false,
    timeline = [],
    horizon_note = null,
    attribution = '',
    issued_at = new Date().toISOString(),
  } = raw;

  const leadH = typeof requestedLeadTime === 'string'
    ? (requestedLeadTime.endsWith('d') ? parseInt(requestedLeadTime, 10) * 24 : parseInt(requestedLeadTime, 10))
    : (requestedLeadTime || 48);

  // Selected target forecast point: require exact match for requested lead
  const exactTarget = timeline.find((curr) => curr.lead_time_hours === leadH);
  const isLeadAvailable = Boolean(exactTarget);
  const target = exactTarget || null;

  const members = target ? (target.models || {}) : {};
  const weights = target ? (target.weights || {}) : {};
  const actualLeadH = exactTarget ? exactTarget.lead_time_hours : null;

  // Verify weights sum
  const weightValues = Object.values(weights);
  const totalWeight = weightValues.reduce((a, b) => a + b, 0);

  // Look up regional domain metadata
  const baseRegion = REGIONS.find((r) => r.id === region_id) || {
    id: region_id,
    name: region_id,
    state: '',
    zone: '',
    regime: regime.name || '',
    lat: 28.6139,
    lng: 77.2090,
    elevation: '0m',
    stationsCount: 28,
  };

  const regionObj = {
    ...baseRegion,
    regime: regime.name || baseRegion.regime,
  };

  // Identify top driving model from real adaptive weights
  const topKey = Object.keys(weights).reduce((best, curr) => {
    return (weights[curr] || 0) > (weights[best] || 0) ? curr : best;
  }, 'ecmwf_ifs');

  const topModelMeta = CANONICAL_MODEL_NAMES[topKey] || { name: topKey };
  const topWeight = weights[topKey] || 0;

  const isAdaptive = weighting_scheme === 'adaptive_xgboost';

  // Model breakdowns
  // Model breakdowns
  const models = {
    ifs: {
      id: 'ecmwf_ifs',
      name: CANONICAL_MODEL_NAMES.ecmwf_ifs.name,
      type: CANONICAL_MODEL_NAMES.ecmwf_ifs.type,
      value: members.ecmwf_ifs ?? null,
      weight: weights.ecmwf_ifs ?? 0,
      leadTimeHours: actualLeadH,
      unit,
      predictedError: target?.predicted_errors?.ecmwf_ifs ?? null,
    },
    aifs: {
      id: 'ecmwf_aifs',
      name: CANONICAL_MODEL_NAMES.ecmwf_aifs.name,
      type: CANONICAL_MODEL_NAMES.ecmwf_aifs.type,
      value: members.ecmwf_aifs ?? null,
      weight: weights.ecmwf_aifs ?? 0,
      leadTimeHours: actualLeadH,
      unit,
      predictedError: target?.predicted_errors?.ecmwf_aifs ?? null,
    },
    gfs: {
      id: 'ncep_gfs',
      name: CANONICAL_MODEL_NAMES.ncep_gfs.name,
      type: CANONICAL_MODEL_NAMES.ncep_gfs.type,
      value: members.ncep_gfs ?? null,
      weight: weights.ncep_gfs ?? 0,
      leadTimeHours: actualLeadH,
      unit,
      predictedError: target?.predicted_errors?.ncep_gfs ?? null,
    },
    icon: {
      id: 'dwd_icon',
      name: CANONICAL_MODEL_NAMES.dwd_icon.name,
      type: CANONICAL_MODEL_NAMES.dwd_icon.type,
      value: members.dwd_icon ?? null,
      weight: weights.dwd_icon ?? 0,
      leadTimeHours: actualLeadH,
      unit,
      predictedError: target?.predicted_errors?.dwd_icon ?? null,
    },
    blend: {
      id: 'varuna_blend',
      name: 'VARUNA BLEND',
      value: target?.blend ?? null,
      leadTimeHours: actualLeadH,
      unit,
    },
  };

  const whyThisBlend = {
    topModel: isAdaptive && isLeadAvailable
      ? {
          key: topKey,
          name: topModelMeta.name,
          pct: topWeight,
          isDominant: true,
        }
      : {
          key: 'none',
          name: 'No dominant model',
          pct: topWeight,
          isDominant: false,
        },
    explanation: !isLeadAvailable
      ? `Forecast for requested lead +${leadH}h is not available in the source NWP series.`
      : (isAdaptive
          ? `${topModelMeta.name} is allocated the highest weight (${topWeight}%) because the XGBoost meta-model predicted the lowest contextual error for ${regionObj.name} at +${actualLeadH}h lead.`
          : (weighting_reason || 'Equal-weight fallback across available forecast members. No ML meta-model trained or validated for this variable.')),
  };

  // Recharts timeseries formatting
  const timeseries = timeline.map((pt) => ({
    time: formatChartTime(pt.time, pt.lead_time_hours),
    valid_time: pt.time,
    lead_time_hours: pt.lead_time_hours,
    IFS: pt.models?.ecmwf_ifs ?? 0,
    AIFS: pt.models?.ecmwf_aifs ?? 0,
    GFS: pt.models?.ncep_gfs ?? 0,
    ICON: pt.models?.dwd_icon ?? 0,
    VARUNA: pt.blend ?? 0,
    weights: pt.weights || {},
  }));

  // Alert level evaluation
  const alertInfo = (isLeadAvailable && target?.blend !== null && target?.blend !== undefined)
    ? determineAlertLevel(variable, target.blend)
    : { level: 'Unavailable', reason: `Forecast point for +${leadH}h lead is unavailable in source NWP series.` };

  return {
    region: regionObj,
    variable: {
      id: variable,
      label: variable.charAt(0).toUpperCase() + variable.slice(1).replace('_', ' '),
      unit,
    },
    dataMode: data_mode,
    isLeadAvailable,
    leadAvailable: isLeadAvailable,
    available: isLeadAvailable,
    initializationTime: issued_at,
    validTime: target?.time || null,
    leadTime: requestedLeadTime || (actualLeadH !== null ? `+${actualLeadH}h` : `+${leadH}h`),
    leadHours: actualLeadH,
    forecastValue: target?.blend ?? null,
    unit,
    alertLevel: alertInfo.level,
    alertReason: alertInfo.reason,
    models,
    weightsSum: totalWeight,
    timeseries,
    whyThisBlend,
    supportedHorizons: ['24h', '48h', '72h', '120h', '7d'],
    availableHorizonHours: timeline.length,
    horizonNote: isLeadAvailable ? horizon_note : (horizon_note || `Forecast point for +${leadH}h lead is unavailable in source NWP series.`),
    weightingScheme: weighting_scheme,
    weightingReason: weighting_reason,
    provenance: {
      region: region_id,
      variable,
      lead_time_hours: actualLeadH,
      models_used,
      acquisition_path: 'browser_open_meteo_direct',
      processing_endpoint: `${getApiBase()}/api/forecast/process`,
      weighting_scheme,
      weighting_reason,
      validated,
      data_mode,
      timestamp: issued_at,
      attribution,
      degraded,
    },
  };
}

/**
 * Ensures client has fetched the Open-Meteo series and warmed Render's SQLite cache
 * so subsequent calls to /api/weights, /api/explain, /api/extremes, or /api/analyze
 * hit the local cache and never call Open-Meteo from Render (preventing 429 errors).
 */
async function ensureServerWarmed(regionId, leadH = 48, variable = 'temperature') {
  try {
    let cached = clientSeriesCache.get(regionId);
    const now = Date.now();
    if (!cached || now - cached.timestamp > CLIENT_CACHE_TTL_MS) {
      const regObj = REGIONS.find((r) => r.id === regionId) || { id: regionId, lat: 28.6139, lon: 77.2090 };
      const seriesMap = await fetchOpenMeteoBatch([regObj]);
      if (seriesMap[regionId]) {
        cached = { timestamp: now, series: seriesMap[regionId] };
      }
    }
    if (cached?.series) {
      await fetch(`${getApiBase()}/api/forecast/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region: regionId,
          variable,
          lead_time_hours: leadH,
          series: cached.series,
        }),
      });
    }
  } catch {
    // Best-effort warm
  }
}

/**
 * Fetch adaptive weights from /api/weights.
 */
export async function fetchWeights({ region = 'delhi_ncr', variable = 'temperature', leadTime = '48h' } = {}) {
  const leadH = typeof leadTime === 'string'
    ? (leadTime.endsWith('d') ? parseInt(leadTime, 10) * 24 : parseInt(leadTime, 10))
    : (leadTime || 48);

  await ensureServerWarmed(region, leadH, variable);

  const params = new URLSearchParams({ region, variable, lead_time_hours: leadH });
  const response = await fetch(`${getApiBase()}/api/weights?${params.toString()}`);
  if (!response.ok) throw new Error(`Weights fetch failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Fetch provider status telemetry from /api/providers/status.
 */
export async function fetchProvidersStatus() {
  const response = await fetch(`${getApiBase()}/api/providers/status`);
  if (!response.ok) throw new Error(`Providers status fetch failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Fetch verified skill metrics from /api/skill.
 */
export async function fetchSkill({ variable = 'temperature', region = null } = {}) {
  const params = new URLSearchParams({ variable });
  if (region) params.append('region', region);
  const response = await fetch(`${getApiBase()}/api/skill?${params.toString()}`);
  if (!response.ok) throw new Error(`Skill fetch failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Fetch extreme weather alerts from /api/extremes.
 */
export async function fetchExtremes({ region = 'delhi_ncr', leadTime = '48h', simulate = false } = {}) {
  const leadH = typeof leadTime === 'string'
    ? (leadTime.endsWith('d') ? parseInt(leadTime, 10) * 24 : parseInt(leadTime, 10))
    : (leadTime || 48);

  await ensureServerWarmed(region, leadH, 'rainfall');

  const params = new URLSearchParams();
  if (region) params.append('region', region);
  if (leadH !== null && leadH !== undefined) params.append('lead_time_hours', leadH);
  if (simulate) params.append('simulate', 'true');

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${getApiBase()}/api/extremes${query}`);
  if (!response.ok) throw new Error(`Extremes fetch failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Fetch explainability attribution and feature importances from /api/explain.
 */
export async function fetchExplain({ region = 'delhi_ncr', variable = 'temperature', leadTime = '48h' } = {}) {
  const leadH = typeof leadTime === 'string'
    ? (leadTime.endsWith('d') ? parseInt(leadTime, 10) * 24 : parseInt(leadTime, 10))
    : (leadTime || 48);

  await ensureServerWarmed(region, leadH, variable);

  const params = new URLSearchParams({
    region,
    variable,
    lead_time_hours: String(leadH),
  });

  const response = await fetch(`${getApiBase()}/api/explain?${params.toString()}`);
  if (!response.ok) throw new Error(`Explain fetch failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Trigger fresh adaptive ensemble analysis via POST /api/analyze.
 * Recomputes adaptive weighting and blends NWP members for the specified context.
 */
export async function fetchAnalyze({ region = 'delhi_ncr', variable = 'temperature', leadTime = '48h' } = {}) {
  const leadH = typeof leadTime === 'string'
    ? (leadTime.endsWith('d') ? parseInt(leadTime, 10) * 24 : parseInt(leadTime, 10))
    : (leadTime || 48);

  await ensureServerWarmed(region, leadH, variable);

  const response = await fetch(`${getApiBase()}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      region,
      variable,
      lead_time_hours: leadH,
    }),
  });
  if (!response.ok) throw new Error(`VARUNA Analysis request failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Backward-compatible alias for fetchAnalyze.
 */
export const fetchAiAnalysis = fetchAnalyze;

/**
 * Health check from /api/health.
 */
export async function fetchHealth() {
  const response = await fetch(`${getApiBase()}/api/health`);
  if (!response.ok) throw new Error(`Health check failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Concurrency-controlled promise executor.
 */
async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: err.message || 'Request failed' };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetch operational regional forecasts for all 12 configured regions.
 * Uses a single browser-side multi-coordinate Open-Meteo request and a single
 * POST /api/forecast/process batch call to Render, eliminating provider rate limits.
 */
export async function fetchRegionalForecasts(arg1 = {}, arg2 = 'temperature', arg3 = '48h') {
  let regions = REGIONS;
  let variable = 'temperature';
  let leadTime = '48h';

  if (Array.isArray(arg1)) {
    regions = arg1;
    variable = typeof arg2 === 'string' ? arg2 : 'temperature';
    leadTime = arg3 || '48h';
  } else if (typeof arg1 === 'object' && arg1 !== null) {
    if (arg1.regions) regions = arg1.regions;
    if (arg1.variable) variable = arg1.variable;
    if (arg1.leadTime) leadTime = arg1.leadTime;
  }

  const leadH = typeof leadTime === 'string'
    ? (leadTime.endsWith('d') ? parseInt(leadTime, 10) * 24 : parseInt(leadTime, 10))
    : (leadTime || 48);

  // Primary Path: Single-batch browser Open-Meteo fetch + Render batch processing
  try {
    const seriesMap = await fetchOpenMeteoBatch(regions);
    const batch = [];
    for (const r of regions) {
      if (seriesMap[r.id]) {
        batch.push({
          region: r.id,
          variable,
          lead_time_hours: leadH,
          series: seriesMap[r.id],
        });
      }
    }

    if (batch.length === regions.length) {
      const response = await fetch(`${getApiBase()}/api/forecast/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch }),
      });

      if (response.ok) {
        const data = await response.json();
        const results = data.results || [];
        const resultMap = new Map(results.map((res) => [res.region_id, res]));

        return regions.map((region) => {
          const raw = resultMap.get(region.id);
          if (raw) {
            return {
              ...region,
              forecast: normalizeForecastResponse(raw, leadTime),
              error: null,
            };
          }
          return {
            ...region,
            forecast: null,
            error: 'Region processing failed',
          };
        });
      }
    }
  } catch (err) {
    console.warn('Batch browser fetch encountered an issue, falling back to sequential path:', err);
  }

  // Fallback Path: Sequential requests via fetchForecast
  return runWithConcurrency(regions, 1, async (region) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const forecast = await fetchForecast({
          region: region.id,
          variable,
          leadTime,
        });
        return {
          ...region,
          forecast,
          error: null,
        };
      } catch (err) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 60));
          continue;
        }
        return {
          ...region,
          forecast: null,
          error: err.message || 'API unavailable',
        };
      }
    }
  });
}

