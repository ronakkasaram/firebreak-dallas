# The contract

The pipeline writes 4 files to `web/public/data/`. The console reads only these files. If you change a field, change this file in the same commit and post on the board.

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

## events.bin

Every 311 report in the last 730 days, sorted by time.

| Column | Type | Meaning |
|---|---|---|
| `lon`, `lat` | float32 | Position |
| `day` | uint16 | Days since `events_start` |
| `kind` | uint8 | Index into `meta.kinds`. `infra` (6) is a pipe, street or signal failure. Everything else is a property report |

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
