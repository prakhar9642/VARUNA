/**
 * VARUNA — static reference data (display metadata only).
 *
 * IMPORTANT: this file contains NO forecast values, NO alert values and NO
 * skill metrics. Everything numeric shown in the UI is fetched from the
 * FastAPI backend (src/services/api.js). What lives here:
 *
 *   - REGIONS: the 12 operational regions. Coordinates are the canonical
 *     values for the whole system (the backend config documents that it takes
 *     them from this file); `validated` / `benchmarked` flags are overlaid at
 *     runtime from GET /api/regions so they can never drift.
 *   - VARIABLES / LEAD_TIMES: UI selection options mirroring the backend
 *     contract (varuna-backend/app/config.py).
 *   - REGIME_CLASSES: the fixed 6-class order of the rule-based regime
 *     classifier (documented in varuna-backend/docs/REGIME_RULES.md); used to
 *     render regime indices returned by the API.
 *   - MODELS: the four Open-Meteo member models plus the VARUNA blend.
 */

export const REGIONS = [
  {
    id: 'delhi_ncr',
    name: 'Delhi NCR',
    state: 'Delhi / Haryana',
    lat: 28.6139,
    lng: 77.209,
    zone: 'North-West Plains',
    elevation: '216m',
  },
  {
    id: 'mumbai_coastal',
    name: 'Mumbai Coastal',
    state: 'Maharashtra',
    lat: 19.076,
    lng: 72.8777,
    zone: 'Konkan Maritime Zone',
    elevation: '14m',
  },
  {
    id: 'western_ghats',
    name: 'Western Ghats (Mahabaleshwar)',
    state: 'Maharashtra / Karnataka',
    lat: 17.9237,
    lng: 73.6586,
    zone: 'High Ghats Escarpment',
    elevation: '1,353m',
  },
  {
    id: 'gujarat_industrial',
    name: 'Jamnagar Petrochemical Belt',
    state: 'Gujarat',
    lat: 22.4707,
    lng: 70.0577,
    zone: 'Kathiawar Coastal Strip',
    elevation: '20m',
  },
  {
    id: 'odisha_coast',
    name: 'Paradip Port / Bay Coast',
    state: 'Odisha',
    lat: 20.3164,
    lng: 86.6085,
    zone: 'Mahanadi Deltaic Littoral',
    elevation: '8m',
  },
  {
    id: 'bengaluru_deccan',
    name: 'Bengaluru Deccan',
    state: 'Karnataka',
    lat: 12.9716,
    lng: 77.5946,
    zone: 'South Interior Plateau',
    elevation: '920m',
  },
  {
    id: 'punjab_agri',
    name: 'Punjab Central Agro-Belt',
    state: 'Punjab',
    lat: 30.901,
    lng: 75.8573,
    zone: 'Indo-Gangetic Basin',
    elevation: '244m',
  },
  {
    id: 'assam_valley',
    name: 'Guwahati / Brahmaputra Valley',
    state: 'Assam',
    lat: 26.1445,
    lng: 91.7362,
    zone: 'Sub-Himalayan Trough',
    elevation: '55m',
  },
  {
    id: 'chennai_coastal',
    name: 'Chennai Coromandel',
    state: 'Tamil Nadu',
    lat: 13.0827,
    lng: 80.2707,
    zone: 'Coromandel Coastal Plain',
    elevation: '6m',
  },
  {
    id: 'rajasthan_thar',
    name: 'Jodhpur / Western Thar',
    state: 'Rajasthan',
    lat: 26.2389,
    lng: 73.0243,
    zone: 'Thar Arid Zone',
    elevation: '231m',
  },
  {
    id: 'kerala_coast',
    name: 'Kochi Malabar Coast',
    state: 'Kerala',
    lat: 9.9312,
    lng: 76.2673,
    zone: 'Malabar Maritime Zone',
    elevation: '4m',
  },
  {
    id: 'central_highlands',
    name: 'Bhopal / Central Highlands',
    state: 'Madhya Pradesh',
    lat: 23.2599,
    lng: 77.4126,
    zone: 'Vindhya Basin Plateau',
    elevation: '527m',
  },
];

/**
 * `validated` mirrors the backend's variable flags (only temperature has a
 * trained, benchmarked meta-model). The API response `validated` field always
 * wins when present — this static copy only pre-labels the switcher.
 */
export const VARIABLES = [
  { id: 'rainfall', label: 'Rainfall', unit: 'mm', icon: '🌧️', precision: 1, validated: true },
  { id: 'temperature', label: 'Temperature', unit: '°C', icon: '🌡️', precision: 1, validated: true },
  { id: 'wind_speed', label: 'Wind Speed', unit: 'km/h', icon: '💨', precision: 1, validated: true },
  { id: 'pressure', label: 'Surface Pressure', unit: 'hPa', icon: '🧭', precision: 1, validated: true },
];

export const LEAD_TIMES = ['24h', '48h', '72h', '120h'];

/** Backend horizon cap (varuna-backend/app/config.py FORECAST_HORIZON_CAP_H). */
export const HORIZON_CAP_H = 168;

/** Fixed order of the 6-class rule-based regime classifier. */
export const REGIME_CLASSES = [
  'Monsoonal Active Surge',
  'Monsoonal Break',
  'Western Disturbance',
  'Pre-Monsoon Convective',
  'Subtropical Heatwave',
  'Post-Monsoon Depression',
];

export function regimeName(index) {
  if (index === null || index === undefined) return null;
  return REGIME_CLASSES[index] ?? null;
}

/**
 * The four member models actually queried from Open-Meteo plus the blend.
 * `key` is the backend model key used in every payload.
 */
export const MODELS = [
  {
    id: 'ifs',
    key: 'ecmwf_ifs',
    openMeteoId: 'ecmwf_ifs025',
    name: 'ECMWF IFS',
    type: 'Physics-Based NWP',
    color: '#2563EB',
    badge: 'IFS-025',
  },
  {
    id: 'aifs',
    key: 'ecmwf_aifs',
    openMeteoId: 'ecmwf_aifs025_single',
    name: 'ECMWF AIFS',
    type: 'AI Weather Model',
    color: '#8B5CF6',
    badge: 'AIFS-ML',
  },
  {
    id: 'gfs',
    key: 'cep_gfs',
    openMeteoId: 'gfs_seamless',
    name: 'NOAA GFS',
    type: 'Physics-Based NWP',
    color: '#059669',
    badge: 'GFS-SEAM',
  },
  {
    id: 'icon',
    key: 'dwd_icon',
    openMeteoId: 'icon_seamless',
    name: 'DWD ICON',
    type: 'Physics-Based NWP',
    color: '#0891B2',
    badge: 'ICON-SEAM',
  },
  {
    id: 'blend',
    key: null,
    openMeteoId: null,
    name: 'VARUNA BLEND',
    type: 'Adaptive Hybrid AI-NWP Engine',
    color: '#D97706',
    badge: 'VARUNA-BLEND',
  },
];

/** Member models only (no blend). */
export const MEMBER_MODELS = MODELS.filter((m) => m.id !== 'blend');

export function modelById(id) {
  return MODELS.find((m) => m.id === id) || MODELS[MODELS.length - 1];
}

export const RISK_TIERS = {
  Critical: '#DC2626',
  High: '#EA580C',
  Moderate: '#D97706',
  Low: '#16A34A',
};
