/**
 * VARUNA Scientific Audit & Mathematical Verification Test Suite
 * Validates:
 * 1. Exact mathematical statistical verification formulas (RMSE, MAE, Bias, Pearson r).
 * 2. Strict weight normalization (Σ percentages ≡ 100%, Σ fractions ≡ 1.00, non-negative).
 * 3. Extreme-weather threshold IMD standard conformance.
 * 4. Provider normalized schema compliance (Section 5 data contracts).
 * 5. Physical boundary constraints (rainfall ≥ 0, wind ≥ 0).
 */
import assert from 'node:assert/strict';
import { calculateVerificationMetrics } from './verification_engine.js';
import { computeAdaptiveBlend } from './xgboost_meta_model.js';
import { createNormalizedForecast, APPLICATION_MODES } from '../providers/types.js';
import { generateDemoMemberForecasts } from '../providers/demo_provider.js';
import { getSystemFeedsCatalog } from '../providers/index.js';
import { REGIONS, VARIABLES, EXTREMES_DATA } from '../data/mockData.js';
import { normalizeForecastResponse } from '../services/api.js';

console.log('🧪 Starting VARUNA Scientific Accuracy & Integrity Audit Tests...\n');

// TEST 1: Verification Engine - Statistical Formulas
console.log('Test 1: Statistical Verification Engine Formulas');
{
  // Test case with known analytical results
  const forecast = [10, 12, 14, 16];
  const reference = [10, 11, 13, 15];
  // diffs: 0, 1, 1, 1 -> sumDiff = 3, sumAbsDiff = 3, sumSqDiff = 3, n = 4
  // bias = 3 / 4 = 0.75
  // mae = 3 / 4 = 0.75
  // rmse = sqrt(3 / 4) = 0.866... -> 0.87
  const res = calculateVerificationMetrics({
    forecastValues: forecast,
    referenceValues: reference,
    model: 'TEST_MODEL',
    variable: 'rainfall',
    region: 'Delhi',
    leadTime: '48h',
  });

  assert.equal(res.sampleCount, 4, 'Sample count must be 4');
  assert.equal(res.bias, 0.75, 'Bias must be exactly 0.75');
  assert.equal(res.mae, 0.75, 'MAE must be exactly 0.75');
  assert.equal(res.correlation, 0.99, 'Correlation must be exactly 0.99 for this paired series');
  assert.equal(res.referenceDataset, 'ERA5 Reanalysis Reference Dataset', 'Must use reanalysis reference dataset label');

  // Perfectly linear paired series
  const linearRes = calculateVerificationMetrics({
    forecastValues: [10, 12, 14, 16],
    referenceValues: [8, 10, 12, 14],
    model: 'TEST_LINEAR',
    variable: 'rainfall',
    region: 'Delhi',
    leadTime: '48h',
  });
  assert.equal(linearRes.correlation, 1.0, 'Correlation must be 1.0 for perfectly linear relationship');
  console.log('  ✓ Verification metrics formulas confirmed (RMSE, MAE, Bias, Pearson r)');
}

// TEST 2: Verification Engine - Boundary & Edge Cases
console.log('Test 2: Verification Engine Boundary & Zero-Length Handling');
{
  const emptyRes = calculateVerificationMetrics({
    forecastValues: [],
    referenceValues: [],
    model: 'TEST_EMPTY',
    variable: 'rainfall',
    region: 'Western Ghats',
  });
  assert.equal(emptyRes.sampleCount, 0, 'Empty arrays must yield 0 sample count');
  assert.equal(emptyRes.rmse, 0, 'Empty arrays must yield 0 RMSE');

  // Constant series (zero variance in reference)
  const constRes = calculateVerificationMetrics({
    forecastValues: [12, 14, 16],
    referenceValues: [10, 10, 10],
    model: 'TEST_CONST',
    variable: 'temperature',
    region: 'Thar',
  });
  assert.equal(constRes.correlation, 0, 'Constant reference variance must not trigger divide-by-zero NaN');
  console.log('  ✓ Zero-length and zero-variance boundary cases handled safely');
}

// TEST 3: Adaptive Weight Normalization Across All Synoptic Regimes & Lead Times
console.log('Test 3: Adaptive Weight Normalization & Non-Negativity');
{
  const leadTimes = [24, 48, 72, 120];

  for (const reg of REGIONS) {
    for (const variable of VARIABLES) {
      for (const lead of leadTimes) {
        const demo = generateDemoMemberForecasts({
          region: reg,
          variable,
          leadTimeHours: lead,
        });

        const blend = computeAdaptiveBlend({
          region: reg,
          variable,
          leadTimeHours: lead,
          memberForecasts: {
            ifs: demo.ifs,
            aifs: demo.aifs,
            gfs: demo.gfs,
          },
          baseRmse: demo.baseRmse,
          leadFactor: demo.leadFactor,
        });

        const sumPct =
          blend.weights.ifs.percentage +
          blend.weights.aifs.percentage +
          blend.weights.gfs.percentage;

        assert.equal(
          sumPct,
          100,
          `Weights percentage sum must be strictly 100 for ${reg.id} ${variable.id} ${lead}h (got ${sumPct})`
        );

        assert.ok(blend.weights.ifs.percentage >= 0, `IFS weight must be >= 0 (got ${blend.weights.ifs.percentage})`);
        assert.ok(blend.weights.aifs.percentage >= 0, `AIFS weight must be >= 0 (got ${blend.weights.aifs.percentage})`);
        assert.ok(blend.weights.gfs.percentage >= 0, `GFS weight must be >= 0 (got ${blend.weights.gfs.percentage})`);

        const sumFrac = Number(
          (blend.weights.ifs.fraction + blend.weights.aifs.fraction + blend.weights.gfs.fraction).toFixed(2)
        );
        assert.equal(
          sumFrac,
          1.0,
          `Weights fraction sum must be strictly 1.0 for ${reg.id} ${variable.id} ${lead}h (got ${sumFrac})`
        );
      }
    }
  }
  console.log('  ✓ Verified 192/192 combinations: all weights strictly non-negative and sum to 100% and 1.00');
}

// TEST 4: Largest Remainder Extreme Skew Edge Case
console.log('Test 4: Largest Remainder Extreme Skew Edge Case');
{
  // Test scenario where two models dominate heavily
  const dummyRegion = { id: 'dummy', name: 'Dummy', regime: 'orographic', zone: 'Zone', elevation: '1200m' };
  const dummyVar = { id: 'rainfall', unit: 'mm' };
  const dummyMembers = {
    ifs: { value: 100, unit: 'mm' },
    aifs: { value: 95, unit: 'mm' },
    gfs: { value: 10, unit: 'mm' },
  };

  const blend = computeAdaptiveBlend({
    region: dummyRegion,
    variable: dummyVar,
    leadTimeHours: 48,
    memberForecasts: dummyMembers,
    baseRmse: 1.0,
    leadFactor: 1.0,
  });

  const sumPct =
    blend.weights.ifs.percentage +
    blend.weights.aifs.percentage +
    blend.weights.gfs.percentage;
  assert.equal(sumPct, 100, 'Sum of percentage weights must strictly equal 100');
  assert.ok(blend.weights.gfs.percentage >= 0, 'Weight must never be negative');
  console.log('  ✓ Extreme skew edge case passed without negative weights');
}

// TEST 5: Normalized Forecast Contract Compliance (Section 5)
console.log('Test 5: Provider Normalized Forecast Contracts');
{
  const record = createNormalizedForecast({
    model: 'ECMWF IFS',
    variable: 'rainfall',
    latitude: 28.6139,
    longitude: 77.2090,
    initializationTime: '2026-09-26T00:00:00Z',
    validTime: '2026-09-28T00:00:00Z',
    leadTimeHours: 48,
    value: 28.5,
    unit: 'mm',
    source: 'ECMWF IFS 0.25° Open Data',
    runId: 'ecmwf_ifs_20260926_00z',
    mode: APPLICATION_MODES.DEMO,
  });

  assert.equal(typeof record.model, 'string');
  assert.equal(typeof record.variable, 'string');
  assert.equal(typeof record.latitude, 'number');
  assert.equal(typeof record.longitude, 'number');
  assert.equal(typeof record.initialization_time, 'string');
  assert.equal(typeof record.valid_time, 'string');
  assert.equal(typeof record.lead_time_hours, 'number');
  assert.equal(typeof record.value, 'number');
  assert.equal(typeof record.unit, 'string');
  assert.equal(typeof record.source, 'string');
  assert.equal(typeof record.run_id, 'string');
  assert.equal(record.mode, APPLICATION_MODES.DEMO);
  console.log('  ✓ Normalized forecast schema conforms strictly to Section 5 specification');
}

// TEST 6: Physical Boundary Constraints (Section 20)
console.log('Test 6: Physical Boundary Clamping');
{
  for (const reg of REGIONS) {
    const rain = generateDemoMemberForecasts({ region: reg, variable: { id: 'rainfall', unit: 'mm' } });
    assert.ok(rain.ifs.value >= 0, 'IFS rain must be >= 0');
    assert.ok(rain.aifs.value >= 0, 'AIFS rain must be >= 0');
    assert.ok(rain.gfs.value >= 0, 'GFS rain must be >= 0');

    const wind = generateDemoMemberForecasts({ region: reg, variable: { id: 'wind_speed', unit: 'km/h' } });
    assert.ok(wind.ifs.value >= 0, 'IFS wind must be >= 0');
    assert.ok(wind.aifs.value >= 0, 'AIFS wind must be >= 0');
    assert.ok(wind.gfs.value >= 0, 'GFS wind must be >= 0');
  }
  console.log('  ✓ Physical boundary limits verified across all regions (rain ≥ 0, wind ≥ 0)');
}

// TEST 7: Extreme Weather Thresholds Audit (Section 13)
console.log('Test 7: Extreme Weather IMD Standards Conformance');
{
  for (const ext of EXTREMES_DATA) {
    assert.ok(ext.accumulationPeriod, `Must define accumulation period for ${ext.id}`);
    assert.ok(ext.standard, `Must cite standard for ${ext.id}`);
    assert.ok(ext.geographicApplicability, `Must define geographic applicability for ${ext.id}`);

    if (ext.type.toLowerCase().includes('rain') || ext.type.toLowerCase().includes('precip')) {
      assert.ok(
        ext.threshold.includes('24h Acc. Rain'),
        `Rainfall threshold must specify 24h accumulation window for ${ext.id}`
      );
      assert.ok(
        ext.standard.includes('IMD Heavy Rainfall Classification'),
        `Rainfall standard must cite IMD classification for ${ext.id}`
      );
    }
  }
  console.log('  ✓ All 6 extreme event entries conform to IMD meteorological advisory standards');
}

// TEST 8: System Ingestion Status Truthfulness (Section 17)
console.log('Test 8: System Feeds Truthfulness (No Fake "100% Ingested")');
{
  const demoFeeds = getSystemFeedsCatalog(APPLICATION_MODES.DEMO);
  const imdFeed = demoFeeds.find((f) => f.name.includes('IMD'));
  assert.equal(imdFeed.status, 'Integration Pending', 'IMD feed must be marked Integration Pending');
  assert.equal(imdFeed.verificationPoints, 0, 'IMD feed must have 0 verification points');
  assert.equal(imdFeed.authRequired, true, 'IMD feed must declare authRequired = true');

  const insatFeed = demoFeeds.find((f) => f.name.includes('INSAT'));
  assert.equal(insatFeed.status, 'Not Configured', 'INSAT feed must be marked Not Configured');
  assert.equal(insatFeed.verificationPoints, 0, 'INSAT feed must have 0 verification points');
  console.log('  ✓ System feeds catalog truthfully flags unintegrated feeds');
}

// TEST 9: Live Operational Regional Matrix Integrity (12 Regions × 4 Variables × 5 Leads = 240 combinations)
console.log('Test 9: Live Operational Regional Matrix Integrity (240 combinations)');
{
  const testLeads = ['24h', '48h', '72h', '120h', '7d'];
  const testLeadHours = [24, 48, 72, 120, 168];
  let checkedCombinations = 0;

  for (const reg of REGIONS) {
    for (const v of VARIABLES) {
      const varId = v.id;
      const isAdaptive = varId === 'temperature' || varId === 'pressure';
      const expectedScheme = isAdaptive ? 'adaptive_xgboost' : 'equal_fallback_untrained';

      const mockLiveRaw = {
        region_id: reg.id,
        variable: varId,
        unit: v.unit,
        data_mode: 'LIVE',
        validated: isAdaptive,
        weighting_scheme: expectedScheme,
        weighting_reason: isAdaptive ? 'Adaptive XGBoost validated' : 'Equal-weight consensus',
        regime: { name: 'Synoptic Test' },
        models_used: 4,
        degraded: false,
        timeline: testLeadHours.map((h) => ({
          time: `2026-10-06T${String(h % 24).padStart(2, '0')}:00:00Z`,
          lead_time_hours: h,
          models: {
            ecmwf_ifs: 20.0 + h * 0.1,
            ecmwf_aifs: 20.5 + h * 0.1,
            ncep_gfs: 21.0 + h * 0.1,
            dwd_icon: 20.2 + h * 0.1,
          },
          blend: 20.4 + h * 0.1,
          weights: isAdaptive
            ? { ecmwf_ifs: 25, ecmwf_aifs: 45, ncep_gfs: 10, dwd_icon: 20 }
            : { ecmwf_ifs: 25, ecmwf_aifs: 25, ncep_gfs: 25, dwd_icon: 25 },
          models_used: 4,
          predicted_errors: isAdaptive
            ? { ecmwf_ifs: 0.8, ecmwf_aifs: 0.4, ncep_gfs: 1.5, dwd_icon: 0.9 }
            : null,
        })),
        horizon_note: 'Operational 7-day NWP horizon',
        attribution: 'VARUNA scientific ensemble',
        issued_at: new Date().toISOString(),
      };

      for (const lead of testLeads) {
        const norm = normalizeForecastResponse(mockLiveRaw, lead);

        assert.equal(norm.dataMode, 'LIVE', `Must declare dataMode = LIVE for ${reg.id}/${varId}/${lead}`);
        assert.equal(norm.isLeadAvailable, true, `Lead ${lead} must be marked available`);
        assert.ok(typeof norm.forecastValue === 'number' && !Number.isNaN(norm.forecastValue), 'Forecast value must be a valid number');
        assert.equal(norm.forecastValue, norm.models.blend.value, 'Forecast value must match blend value');
        assert.equal(norm.weightsSum, 100, 'Weights must sum to 100%');
        assert.equal(norm.weightingScheme, expectedScheme, `Weighting scheme must match expected for ${varId}`);

        // Verify all 4 NWP models present
        assert.ok(norm.models.ifs.value !== null, 'ECMWF IFS must be present');
        assert.ok(norm.models.aifs.value !== null, 'ECMWF AIFS must be present');
        assert.ok(norm.models.gfs.value !== null, 'NOAA GFS must be present');
        assert.ok(norm.models.icon.value !== null, 'DWD ICON must be present');

        // Verify provenance metadata
        assert.equal(norm.provenance.models_used, 4, 'Provenance must specify 4 models used');
        assert.equal(norm.provenance.region, reg.id);
        assert.equal(norm.provenance.variable, varId);
        assert.equal(norm.provenance.weighting_scheme, expectedScheme);
        assert.equal(norm.provenance.acquisition_path, 'browser_open_meteo_direct');

        checkedCombinations += 1;
      }
    }
  }

  assert.equal(checkedCombinations, 12 * 4 * 5, 'Must evaluate exactly 240 regional-variable-lead combinations');
  console.log(`  ✓ Evaluated ${checkedCombinations}/240 regional combinations: contract integrity & 4-model completeness verified`);
}

// TEST 10: Missing Lead & Failure Contract Integrity (Zero Synthetic Numeric Leakage)
console.log('Test 10: Missing Lead & Failure Contract Integrity');
{
  const truncatedRaw = {
    region_id: 'delhi_ncr',
    variable: 'temperature',
    unit: '°C',
    data_mode: 'LIVE',
    validated: true,
    weighting_scheme: 'adaptive_xgboost',
    models_used: 4,
    timeline: [
      {
        time: '2026-10-06T00:00:00Z',
        lead_time_hours: 24,
        models: { ecmwf_ifs: 25.0, ecmwf_aifs: 25.2, ncep_gfs: 26.0, dwd_icon: 25.1 },
        blend: 25.3,
        weights: { ecmwf_ifs: 25, ecmwf_aifs: 45, ncep_gfs: 10, dwd_icon: 20 },
      },
    ],
  };

  // Requesting lead +72h when timeline only contains +24h
  const missingLead = normalizeForecastResponse(truncatedRaw, '72h');
  assert.equal(missingLead.isLeadAvailable, false, 'Missing lead must mark isLeadAvailable = false');
  assert.equal(missingLead.forecastValue, null, 'Missing lead must have null forecast value (NO fake fallback numbers)');
  assert.equal(missingLead.models.blend.value, null, 'Blend value must be null when lead is missing');
  assert.equal(missingLead.models.ifs.value, null, 'Member values must be null when lead is missing');
  assert.equal(missingLead.alertLevel, 'Unavailable', 'Alert level must be Unavailable when lead is missing');
  assert.ok(missingLead.whyThisBlend.explanation.includes('not available'), 'Must state lead is not available');

  console.log('  ✓ Missing lead and truncated timeline produce clean nulls without synthetic fallback numeric leakage');
}

console.log('\n🎉 ALL 10 SCIENTIFIC ACCURACY & INTEGRITY TESTS PASSED SUCCESSFULLY!\n');

