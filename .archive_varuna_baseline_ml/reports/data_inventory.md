# VARUNA Baseline Data Inventory

- Generated: 2026-09-24T12:40:39.979873+00:00
- Status: **PASS**
- Raw files: 127
- Total rows: 9,582,912

## Source

Real NWP model forecasts (GFS, ECMWF IFS, ICON, GEM) vs ERA5-Land truth for 127 Indian locations, 1 row per (location, valid time, lead). Source: Open-Meteo historical-forecast API, not synthetic.

| field | value |
|---|---|
| hf_repo | Arko007/weathergpt-d1-mos-dataset |
| dataset_url | https://huggingface.co/datasets/Arko007/weathergpt-d1-mos-dataset |
| row_count | 9582912 |
| column_count | 32 |
| is_synthetic | False |
| time min | 2025-08-01 00:00:00+00:00 |
| time max | 2026-08-28 23:00:00+00:00 |
| spatial.lat | [8.179, 34.165] |
| spatial.lon | [69.6093, 94.9084] |
| spatial.elevation_m | [2.0, 3502.0] |
| spatial.n_locations | 127 |
| spatial.admin1_regions | ['Andaman and Nicobar', 'Andhra Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'National Capital Territory of Delhi', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'unknown'] |

- `lead_age_days` `Int64` nulls=0
- `fc_temperature_2m_gfs_seamless` `Float64` nulls=0
- `fc_temperature_2m_ecmwf_ifs025` `Float64` nulls=0
- `fc_temperature_2m_icon_seamless` `Float64` nulls=1,246,759
- `fc_temperature_2m_gem_seamless` `Float64` nulls=63,246
- `fc_precipitation_gfs_seamless` `Float64` nulls=0
- `fc_precipitation_ecmwf_ifs025` `Float64` nulls=32,766
- `fc_precipitation_icon_seamless` `Float64` nulls=1,227,201
- `fc_precipitation_gem_seamless` `Float64` nulls=50,292
- `fc_wind_speed_10m_gfs_seamless` `Float64` nulls=0
- `fc_wind_speed_10m_ecmwf_ifs025` `Float64` nulls=0
- `fc_wind_speed_10m_icon_seamless` `Float64` nulls=1,197,864
- `fc_wind_speed_10m_gem_seamless` `Float64` nulls=111,633
- `fc_relative_humidity_2m_gfs_seamless` `Int64` nulls=0
- `fc_relative_humidity_2m_ecmwf_ifs025` `Float64` nulls=16,383
- `fc_relative_humidity_2m_icon_seamless` `Float64` nulls=1,217,422
- `fc_relative_humidity_2m_gem_seamless` `Float64` nulls=39,624
- `truth_temperature_2m` `Float64` nulls=0
- `truth_precipitation` `Float64` nulls=0
- `truth_wind_speed_10m` `Float64` nulls=0
- `truth_relative_humidity_2m` `Int64` nulls=0
- `loc_id` `String` nulls=0
- `lat` `Float64` nulls=0
- `lon` `Float64` nulls=0
- `elevation_m` `Float64` nulls=0
- `admin1` `String` nulls=0
- `chunk_misses` `Int64` nulls=0
- `valid_time` `Datetime(time_unit='ns', time_zone='UTC')` nulls=0
- `lead_hours` `Int64` nulls=0
- `hour_utc` `Int32` nulls=0
- `doy` `Int32` nulls=0
- `month` `Int32` nulls=0