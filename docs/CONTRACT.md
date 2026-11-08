# The contract

The pipeline writes 11 files to `web/public/data/` (the last two, `falcon.json` and `falcon.bin`, are optional). The console reads only these files. If you change a field, change this file in the same commit and post on the board.

## meta.json

| Field | Meaning |
|---|---|
| `as_of` | Last day of 311 data (`YYYY-MM-DD`). "Today" in the console. |
| `horizon_days` | 90. Every risk is the chance of a new property report within this many days. |
| `events_start` | Day 0 for `events.bin` (`as_of` minus 730 days). |
| `backtest_cutoff` | The date the proof-mode model is frozen on. |
| `counts` | `buildings`, `tenants`, `reports`, `infra_failures`, `by_class`, `placed_by` (`311` or `street`). |
| `model` | Held-out test results: `base` (own history only) and `network` (plus hidden links), each with `auc`, `avg_precision`, `watch_list`, `watch_precision`, `watch_lift`, `cases_caught`, `base_rate`. Also `by_class`. |
| `edges` | `block`, `owner` and `infrastructure`: `edge` (plain English), `ratio`, `rate_exposed`, `rate_matched`, `exposed_buildings`, `per_cutoff`. |
| `assumptions` | Every number not measured from data, each with `value` and `source`. |
| `classes` | Index to name for `buildings.bin` `class`: `home`, `multifamily`, `commercial`, `industrial`. |
| `kinds` | Index to name for `events.bin` `kind`: `code`, `rental`, `tenant`, `construction` (unused), `vacancy`, `nuisance`, `infra`. |
| `buildings_layout`, `events_layout` | Where each column sits in the `.bin` files: `name`, `dtype`, `offset` (bytes), `length`. |
| `buyers` | Top 25 repeat company buyers: `name`, `buys_2y`, `classes`. |
| `audit` | Held-out checks at `cutoff`. `lead_time`: `capacity_per_day`, `visits`, `cases`, and per ranking (`network`, `base`, `district_fair`, `last_year_count`) `cases_reached_early`, `share_of_cases`, `median_days_ahead`, `mean_days_ahead`. `fairness` and `fairness_after_rerank`: `watch_list`, `city_recall`, `city_precision`, and `districts` (one row per council district: `district`, `buildings`, `cases`, `flagged`, `case_share`, `flag_share`, `precision`, `recall`, `recall_ratio`, `fdr_ratio`, `under_served`, `over_flagged`). |

## buildings.bin

One record per building, column after column, little-endian. Read it with `meta.buildings_layout` (see `web/src/data.js`).

| Column | Type | Meaning |
|---|---|---|
| `lon`, `lat` | float32 | Position |
| `value` | float32 | DCAD market value, dollars |
| `risk` | uint8 | Live risk. `risk / 255` = probability of a new report in 90 days |
| `lift` | uint8 | `lift / 255 / 4` = probability points the network adds over the base model |
| `risk_backtest` | uint8 | Risk as of `backtest_cutoff`, from a model that never saw later data |
| `hit_backtest` | uint8 | 1 if the building really got a report in the 90 days after `backtest_cutoff` |
| `class` | uint8 | Index into `meta.classes` |
| `reports_365` | uint8 | Property reports at this building in the last year (capped at 255) |
| `mu` | float32 | Hawkes background rate today: expected reports per day with no recent reports nearby |
| `district` | uint8 | Dallas city council district (1 to 14, 0 if unknown), from the nearest 311 record |
| `risk_lo`, `risk_hi` | uint8 | Venn-Abers calibrated interval for `risk`, `/ 255` |
| `certified` | uint8 | 1 if on today's certified list (conformal selection, at most 10% expected wrong) |
| `push_nb` | uint16 | `/ 5000` = Hawkes expected reports in the next 90 days set off by neighbours' recent reports |
| `push_share` | uint8 | `/ 255` = share of this building's expected reports that come from neighbours (the rest is its background and its own recent reports) |
| `spare` | uint16 | `/ 5000` = expected reports at other buildings prevented if this one is stabilized now (first order) |
| `street` | uint16 | Index into `search.json` `streets` (street name and zip, no house number) |
| `block` | uint16 | 100-block of the house number (0 if none) |
| `owner` | uint16 | 1-based index into `search.json` `owners` (company portfolios with 3+ buildings), 0 for none |

## events.bin

Every 311 report in the last 730 days, sorted by time.

| Column | Type | Meaning |
|---|---|---|
| `lon`, `lat` | float32 | Position |
| `day` | uint16 | Days since `events_start` |
| `kind` | uint8 | Index into `meta.kinds`. `infra` (6) is a pipe, street or signal failure. Everything else is a property report |
| `b` | int32 | Index of the building the report is at in `buildings.bin`, or -1 |
| `new_case` | uint8 | 1 unless it repeats the same kind at the same address within 2 days (the Hawkes model counts only new cases) |

## hawkes.json

The house-by-house spread model (`backend/firebreak/hawkes.py`).

| Field | Meaning |
|---|---|
| `params` | `sigma_m` (distance scale), `beta_fast`, `beta_slow` (fade per day), `fast_share`, `fast_delay_hours`, `slow_delay_days`, `radius_m`, `window_days`, `a_self` and `a_nb` by kind, `theta` (background coefficients by covariate, including `chronic`), `kind_share`, `covariates` (means and SDs used for standardising). |
| `fit` | `train`, `test`, `sigmas_tried`, report and pair counts, `em_loglik`, `test_loglik_hawkes`, `test_loglik_poisson`, `test_gain_nats_per_report`, `triggered_share`, `spread_share`, `triggered_share_recent`, `mean_neighbor_exposure`. |
| `branching` | By kind: `same_house` and `neighbours`, new reports each report sets off on the slow scale. |
| `arcs` | Rows of `arcs_columns`: `src_lon`, `src_lat`, `dst_lon`, `dst_lat`, `p` (probability the source set off the destination), `day_since_window_start`, `src_kind` (index into `KINDS`: code, rental, tenant, vacancy, nuisance). |
| `arcs_window_start` | Day 0 for `arcs`. |
| `fit.residuals` | `ks_hawkes`, `ks_poisson`, `n`: Ogata time-rescaling KS distance on the test window. |
| `reproduction` | `months`, `city` (per month: `r`, `amplifier` = 1 / (1 - R), `reports`, `provisional`, `triggered_share`), `districts` (R by month per council district). Realised R, Wallinga-Teunis on the fitted model. |
| `as_ranker` | Top-2,000 precision of the Hawkes forecast on `cutoff` next to the boosted model's. |

## hotspots.json

The 400 buildings with the most at stake, sorted by `usd.exposure`. Each one:

| Field | Meaning |
|---|---|
| `i` | Row in `buildings.bin` |
| `parcel_id`, `address`, `zip`, `lat`, `lon` | DCAD account and location. The console hides house numbers for homes. |
| `asset_class`, `name`, `building_type`, `value`, `year_built`, `sqft`, `units`, `tenants` | From DCAD |
| `homestead`, `absentee` | Owner lives there / mails elsewhere |
| `owner` | `id` (hash), `label` (company name or empty), `buildings`, `reports_elsewhere_365` |
| `portfolio` | `[lon, lat]` of up to 60 other buildings with the same owner (the arcs) |
| `risk`, `risk_base` | Network model and base model probability |
| `history` | `last_90`, `last_365`, `all`, `kinds` (count by kind) |
| `block` | `reports_50m_30d`, `reports_250m_90d`, `infra_250m_180d`, `buildings_250m` |
| `prevented_nearby` | Expected reports prevented at neighbors if this building is stabilized now |
| `usd` | `neighbor_value` (residential, within 200 m), `spillover`, `rent_at_risk`, `days_open` (expected days a case stays open), `rent_use` (`office`, `retail`, `industrial` or null), `exposure` (= spillover + rent at risk) |
| `plan` | `steps` (`crew`, `do`, `cost`), `underwrite` (homes and small multifamily: `arv`, `repairs`, `buyer_price`, `offer`, `fee`, `viable`), `buyers` (`name`, `buys_2y`, `in_zip`), `cost` |

## lists.json

Wholesale lead lists. `as_of`, `backtest_cutoff`, `top` (leads per list) and `lists`, where each list has:

| Field | Meaning |
|---|---|
| `id`, `title`, `pitch`, `rule` | `first_spark`, `code_stack`, `tired_landlord`, `block_fire`, with plain-English text |
| `eligible` | Houses that fit the rule today |
| `backtest` | The rule applied on `backtest_cutoff`: `top`, `hit_rate` (top leads with a report within 90 days), `base_rate` (all non-owner-occupied houses), `lift`, `pool_rate` (the rule's hit rate with no ranking), `rank_lift` |
| `leads[]` | `i`, `parcel_id`, `address`, `zip`, `lat`, `lon`, `asset_class`, `value`, `sqft`, `year_built`, `risk`, `network_pts`, `reports_365`, `reports_all`, `block_90d`, `next_door_30d`, `owner` (`id`, `label`, `buildings`, `absentee`, `out_of_state`), `arv`, `repairs`, `buyer_price`, `offer`, `fee`, `viable`, `buyers_nearby`, `p_two_buyers` |

No owner names or mailing addresses ever go in this file.

## Crew roles (from WHOLZR)

| Crew | Job here |
|---|---|
| Radar | Watches the block and infrastructure around a hotspot |
| Hawk | Sends inspections to find the root cause |
| Echo | Drafts tenant warnings and owner letters (never sends them) |
| Oracle | Underwrites a rescue purchase or a sale to a value-add buyer |
| Magnet | Matches repeat cash buyers from deed records |
| Shield | Compliance: homestead owners get help first, Texas wholesaling disclosure |
| Closer | Assignment and title once a human signs |

## alarms.json

Emerging clusters today (`backend/firebreak/scan.py`): expectation-based Poisson scan with the fast subset scan over each 150 m cell's 24 nearest cells.

| Field | Meaning |
|---|---|
| `as_of`, `cell_m`, `k`, `windows` | Scan settings (windows in days) |
| `clusters` | `window_days`, `score`, `observed` (distinct buildings with a new case), `expected`, `p` and `recurrence_weeks` (against the strongest cluster of every week in the past year), `p_poisson`, `buildings`, `cells` (`[lon, lat]` of each 150 m cell) |
| `backtest` | Top 3 clusters per week followed for `follow_days`: `weeks`, `clusters_followed`, median and pooled observed / expected after, and the same for a control of the busiest cells (`control_*`) |
| `timeline` | Per week: `max_score` and the top 3 `[lon, lat, score]` |

## evidence.json

| Field | Meaning |
|---|---|
| `calibration` | `train_to`, `calibrate_on`, `test_on`, `deciles` (`lo`, `hi`, `predicted`, `observed`), widths, Brier scores, and `selection` (`city_q10`, `by_district_q10`, ... each with `q`, `selected`, `realised_fdr`) |
| `live` | `q`, `certified` (count), `certified_idx` (rows in `buildings.bin`) |
| `closure` | Natural experiment on fast vs slow case closure: `cases`, `fast_cases`, `slow_cases`, and `main`, `placebo_infrastructure`, `placebo_before_case`, each with `effect_per_1000_buildings`, `ci95`, `effect_pct`, `ci95_pct` |

## search.json

| Field | Meaning |
|---|---|
| `streets` | Street name and zip, no house numbers |
| `owners` | Company portfolios with 3+ buildings: `label`, `buildings`. Never a person's name |
| `names` | Building names from DCAD, by row in `buildings.bin` |

## falcon.json and falcon.bin (optional)

Written by `backend/firebreak/falcon/net.py`. This is the FALCON ST-MotionNet ("Toya") predictor, retrained on weekly frames of Dallas 311. It needs `jax`, `equinox` and `optax`. The console hides the Neural field tab when these files are missing.

`falcon.json`:

| Field | Meaning |
|---|---|
| `grid`, `cell_m` | Grid size (256) and cell size in metres |
| `west`, `north`, `dlon`, `dlat` | Grid origin (north-west corner) and cell size in degrees. Row 0 is north. Cell `k` is row `k / grid`, column `k % grid` |
| `layout` | `rate` (uint16 × `scale` = expected new property reports in the next 90 days), `ignite` (uint16 × `scale` = chance a cell with no report in 90 days gets 2 or more), `blind` (uint8, 1 = building cell with no report in 12 weeks) |
| `as_of`, `cutoff` | Today, and the backtest cutoff that every training target ends before |
| `expected_reports_90d` | Sum of `rate` |
| `model` | `width`, `layers`, `epochs`, `frames`, `train_frames`, `val_frames`, `test_frame`, `best_val_poisson` |
| `training_log` | Per epoch: `train`, `val_poisson`, `sec` |
| `backtest` | Held-out quarter. `capture_top_1pct` and `capture_top_5pct`: share of next-quarter reports in the top cells for `falcon`, `boosted_sum`, `last_365_days` and `last_90_days`. `ignition`: `candidates`, `ignited`, `precision_top_100` and `precision_top_500` by ranking, and `base_rate`. `crew_search`: `crews`, `steps_per_crew`, `starts`, and per policy (`falcon`, `boosted_sum`, `last_365_days`, `random_walk`) the `cells`, `reports_found` and `ignitions_found` |

`falcon.bin`: `rate` (uint16, grid²), then `ignite` (uint16, grid²), then `blind` (uint8, grid²), little-endian, at the offsets in `layout`.
