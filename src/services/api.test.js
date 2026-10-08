// Pure-logic tests for the VARUNA frontend API client and adapters.
// Run with `npm test` (Node's built-in test runner, no browser required).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BASE_URL,
  apiBaseUrl,
  leadToHours,
  hoursToLead,
  entryAtLead,
  alertTier,
  UI_TO_MODEL_KEY,
} from './api.js';
import { LEAD_TIMES, HORIZON_CAP_H, RISK_TIERS, REGIONS, VARIABLES, MODELS } from '../data/referenceData.js';

test('API base URL honours VITE_API_BASE_URL and defaults to localhost:8000', () => {
  const base = apiBaseUrl();
  assert.equal(DEFAULT_BASE_URL, 'http://localhost:8000');
  assert.ok(base.startsWith('http'), 'API base URL must be an absolute http(s) URL');
  assert.equal(base.replace(/\/+$/, ''), base, 'no trailing slash');
});

test('lead strings map to backend integer hours both ways', () => {
  for (const lead of LEAD_TIMES) {
    const hours = leadToHours(lead);
    assert.equal(typeof hours, 'number');
    assert.ok(hours > 0 && hours <= HORIZON_CAP_H, `${lead} within the 168 h horizon cap`);
    assert.equal(hoursToLead(hours), lead);
  }
  assert.equal(leadToHours('unknown'), 48, 'unparsable lead falls back to the 48 h default');
  assert.equal(hoursToLead(120), '120h');
});

test('entryAtLead picks the exact backend lead bucket and never fabricates one', () => {
  const timeline = [
    { time: 'T+0', lead_time_hours: 24, blend: 1 },
    { time: 'T+1', lead_time_hours: 48, blend: 2 },
    { time: 'T+2', lead_time_hours: 72, blend: 3 },
  ];
  assert.equal(entryAtLead(timeline, 48), timeline[1]);
  assert.equal(entryAtLead(timeline, 120), null, 'no substitution beyond the timeline');
  assert.equal(entryAtLead([], 24), null);
  assert.equal(entryAtLead(undefined, 24), null);
});

test('alertTier classifies only real threshold crossings', () => {
  const cross = (hazard, severity) => ({ hazard, severity, crossed: true, threshold_label: severity });
  assert.equal(alertTier([]).tier, 'Low');
  assert.equal(alertTier(undefined).tier, 'Low');
  assert.equal(alertTier([cross('temperature', 'moderate')]).tier, 'Low');
  assert.equal(alertTier([cross('wind_speed', 'squall')]).tier, 'High');
  assert.equal(alertTier([cross('rainfall', 'very_heavy')]).tier, 'Critical');
  assert.equal(alertTier([cross('temperature', 'heatwave')]).tier, 'Critical');
  assert.equal(
    alertTier([{ hazard: 'rainfall', severity: 'very_heavy', crossed: false }]).tier,
    'Low',
    'a non-crossing check never raises a tier',
  );
  for (const tier of ['Critical', 'High', 'Low']) {
    assert.ok(RISK_TIERS[tier], `tier ${tier} exists in reference data`);
  }
});

test('UI model keys map to real backend member keys', () => {
  const backendKeys = new Set(MODELS.map((m) => m.key));
  assert.deepEqual(Object.keys(UI_TO_MODEL_KEY).sort(), ['aifs', 'gfs', 'icon', 'ifs']);
  for (const [uiKey, backendKey] of Object.entries(UI_TO_MODEL_KEY)) {
    assert.ok(backendKeys.has(backendKey), `${uiKey} -> ${backendKey} is a real backend model key`);
    assert.notEqual(backendKey, 'ecmwf_aifs025', 'bare ecmwf_aifs025 is forbidden (IFSA025 collision)');
  }
});

test('reference data matches the backend contract', () => {
  assert.equal(REGIONS.length, 12);
  assert.ok(REGIONS.every((r) => typeof r.lat === 'number' && typeof r.lng === 'number'));
  const ids = REGIONS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'region ids unique');

  const rain = VARIABLES.find((v) => v.id === 'rainfall');
  const temp = VARIABLES.find((v) => v.id === 'temperature');
  const pres = VARIABLES.find((v) => v.id === 'pressure');
  const wind = VARIABLES.find((v) => v.id === 'wind_speed');
  assert.equal(rain.validated, true, 'rainfall is a validated adaptive variable');
  assert.equal(temp.validated, true, 'temperature is a validated adaptive variable');
  assert.equal(pres.validated, true, 'pressure is a validated adaptive variable');
  assert.equal(wind.validated, true, 'wind speed is a validated adaptive variable');
  // The UI variable ids are sent verbatim to the API, so they must stay in
  // sync with the backend's accepted values.
  for (const v of VARIABLES) {
    assert.ok(
      ['temperature', 'rainfall', 'wind_speed', 'pressure'].includes(v.id),
      `${v.id} is a backend-supported variable`,
    );
  }
});
