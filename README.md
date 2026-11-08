# Firebreak

**Predict before it spreads.** A console that links scattered Dallas property data, shows where building distress spreads next, puts a dollar figure on it, and plans the response before it reaches the next block.

Built for the **CBRE track at HackUTD 2026**. A firebreak is the strip of land you clear ahead of a fire so it has nothing left to burn. We find the one building where acting now protects the most around it.

**Start here, then go to your area:**
- Everyone: [docs/CONTRACT.md](docs/CONTRACT.md) has the data files and fields we all build against
- Your coding agent: [set up the agent board](#the-agent-board), then have it read [AGENTS.md](AGENTS.md)

## The track

> Build an application that connects fragmented real estate data to predict operational failures, quantify business impact, or execute solutions before disruptions spread.
>
> The prediction to break: *"Commercial property networks are too fragmented to detect hidden dependencies, leaving critical infrastructure exposed to unexpected cascades and inevitable operational failure."*

CBRE scores you on a working, demoable prototype that goes past passive dashboards to action.

## The idea

Most teams will build a dashboard with a risk score. We **measure** the hidden links CBRE says no one can see, and then act on them.

| CBRE asks | What Firebreak does |
|---|---|
| Connect scattered data | Joins 4 systems that share no IDs: DCAD parcels, DCAD owners, DCAD business tenants (a separate tax roll) and 700,000 Dallas 311 reports. We place every building on the map ourselves. |
| Predict failures | A model trained on 2024 to 2026, tested on a later period it never saw. It says which buildings get a new distress report in the next 90 days. |
| Find hidden dependencies | Tests 3 links on buildings that **never had a report**: next door, same owner, nearby pipe and street failures. Each one is measured, not assumed. |
| Put a dollar value on impact | Value lost by neighbors (from published research), rent at risk, tenants exposed. Every assumption is listed with its source. |
| Act before it spreads | The WHOLZR crew writes the plan: inspection, tenant warning, owner outreach, rescue purchase with matched cash buyers. **Hold to approve.** Nothing is sent. |

## What we found (real data, as of Nov 7, 2026)

| Result | Number |
|---|---|
| Buildings linked and placed on the map | 241,588 (17,071 commercial, 10,843 multifamily, 296 industrial, 213,378 homes) |
| Business tenants linked to their building by address | 22,406 |
| Watch list hit rate (top 2,000 buildings, held-out test from Jul 1, 2026) | **61%** got a new report within 90 days, against a 6.4% base rate (**9.6x**) |
| **Next door** link: a report within 50 m in the last 30 days | **1.26x** the matched first-report rate (stable across 4 test periods: 1.17 to 1.31) |
| **Same owner** link: a report at the owner's other building | **1.20x** (varies more: 0.89 to 1.36) |
| **Pipes and streets** link: a water, sewer or street failure within 250 m | **0.99x**, so no effect |

"Matched" means compared with buildings in the same ZIP, value decile and asset class.

**What to say in the pitch:** CBRE's prediction is wrong. The links between buildings can be found and measured. Distress spreads next door and through owners, not through pipes. Saying which link does *not* matter is part of the answer.

**What to say if asked:** the top-2,000 list scores the same with or without network links (1,228 vs 1,229 hits), because buildings with a long report history dominate it. The network gives a higher AUC (0.735 vs 0.727) and found about 20% more first-time cases among buildings with no history in our test runs. Those first-time cases are where spread happens.

## House by house: how much one report raises the odds next door

The watch list says *which* buildings. `[ house by house ]` says *how it spreads* and *where to cut it*. It runs a self-exciting point process (a spatio-temporal Hawkes model) fitted to every Dallas property report, house by house:

```text
rate of new reports at house i  =  background(i's DCAD record, i's reports last year)
                                 +  sum over earlier reports e within 250 m:
                                      a[kind of e] * exp(-distance / 50 m) * fade(days since e)
```

| Result | Number |
|---|---|
| Share of 2025 reports set off by an earlier report nearby, on the weeks-long scale | **39%** (another 22% are same-hour echoes of one problem) |
| How fast a report's push fades | 27 days on average; 50 m distance scale |
| Held-out fit, Jan to Jun 2026, against the same background with no spread | **+1.10 nats per report** |
| New reports each report sets off (same house + neighbours) | code 0.29, tenant 0.31, rental 0.23, vacancy 0.25, nuisance 0.29 |
| As a ranker (top 2,000 on Jul 1, 2026) | 54%, below the boosted model's 61%, so the list stays boosted and Hawkes runs the what-if |

Click any building and the console:

1. **Simulates its next 90 days**: 400 random futures for every building within 700 m, in a Web Worker. Each simulated report pushes on its own house and its neighbours, so cascades happen. Column height is each house's chance of a report by the day on the slider.
2. **Explains it**: background vs. its own past reports vs. neighbours' reports, and the specific nearby reports pushing on it, drawn as arcs.
3. **Stabilize this house**: the house stops producing reports and its past reports stop pushing on neighbours. Every scenario reuses the same random seeds, so the difference is the intervention, not luck.
4. **Find 3 firebreaks**: a lazy greedy search (CELF) over the 24 most active houses, scored with exact expected counts, for the houses whose stabilization spares the most reports at *other* houses. Then it re-simulates and prices the result with the neighbour-value rule below.

With no house picked, arcs link each report since mid-2026 to the earlier report that most likely set it off (stochastic declustering).

### Two checks a city would ask for (held-out Jul 1, 2026)

| Check | Result |
|---|---|
| **Days of warning.** A crew visits 50 buildings a day in our order. | Reaches **1,018 cases before the first 311 call**, a median **18.5 days early**. Last year's complaint counts reach 938. Waiting for calls reaches none. |
| **Fair across the 14 council districts.** Each district's share of its real cases on the list, against the city. | Districts 1, 3, 5, 8 and 13 fall under 0.8 of the city (the four-fifths rule). Giving each district slots in proportion to the cases the model expects there fixes all 5, for precision 61.4% to 59.3%. |

### What we took from earlier work, and what we changed

| Prior work | What it did | What Firebreak adds |
|---|---|---|
| Chicago food-inspection forecasting (City of Chicago, 2014) | Found violations about 7 days sooner by reordering inspections | The same days-early metric on building distress, with a crew capacity and a complaint-count baseline |
| DSSG Cincinnati blight and the Triage / Aequitas tools | House-by-house inspection lists, then a bias audit | The audit by council district *and* a label-free re-ranking that passes it |
| Mohler et al. (2011), self-exciting crime models | EM with stochastic declustering for burglary | Kind-dependent triggering (5 report kinds), same-house vs. neighbour terms, two time scales, duplicate removal |
| Rome road-accident Hawkes (Alaimo Di Loro et al.) | Covariates in the background rate | DCAD covariates plus a chronic-history term, so a chronically troubled house is not forgotten after a month |
| Kempe, Kleinberg & Tardos (2003); CELF (Leskovec et al. 2007) | Pick the seeds that spread the most | Run in reverse: pick the houses whose repair stops the most spread |

## The demo

The console follows one workflow, keys 1 to 5. The presenter guide, with scripts, numbers and hard questions, is in [docs/PITCH.md](docs/PITCH.md).

1. **Detect.** Every Dallas property report, played back over two years. Emerging clusters from an expectation-based subset scan, the live 311 feed since the snapshot, and the spread rate R by month and council district.
   - **Hidden network** (`N`): arcs from each building with a report this year to the same company's other buildings, the 1.20× same-owner link drawn on the map.
   - **Resolution playbook** (`R`, or select a cluster): an agent that runs the console's own tools in order. It traces the cluster to its origin, simulates the origin, finds firebreaks, costs the case, routes a crew, and waits for a hold-to-approve. Each step is logged with its result.
   - **Watchlist:** press Follow on any building. Followed buildings are ringed on the map, and the Detect panel flags the ones that new 311 reports touch. It is kept in the browser only.
2. **Predict.** The 90-day forecast terrain, the **Neural field** (FALCON's ST-MotionNet predictor retrained on Dallas: a 90-day field for every cell, likely ignitions, blind spots, and crews dispatched on its belief), the backtest replay (model frozen on Jul 1, 2026), the certified list (conformal selection, at most 10% expected wrong) and the calibration chart. Priority interventions open a dossier with a response plan.
3. **Simulate.** Click any building to open its report:
   - its Distress Factor (1 to 10) and a two-year timeline;
   - its **root cause**: the chain of earlier reports that most likely set it off (Hawkes branching probabilities);
   - 400 simulated futures for it and every building within 700 m;
   - what drives it, and the neighbours it pushes on;
   - a stress test that injects hypothetical reports;
   - the 3 firebreaks that spare the most reports next door.
4. **Act.**
   - **Budget plan:** ranked by reports prevented per dollar, with a budget curve, CSV and GeoJSON export, and hold to approve.
   - **District brief:** one page per council office, with tomorrow's crew route (nearest neighbour plus 2-opt).
   - **Portfolio:** how much of an owner's risk comes from buildings it does not control, and which outside buildings to fix or buy first.
   - **Acquisition leads:** for repair-and-resell buyers, with natural buyers next door and a drive-for-dollars loop. Each lead has a **deal desk** that runs the WHOLZR engine's underwriting: an offer waterfall, seller-side odds by discount band, a motivation index, expected fee per contact, and a buyer teaser with no address. Leads can be ranked by expected fee.
5. **Evidence.** The model card: data joins, held-out results, the Hawkes fit and residuals, fairness by council district, the closure natural experiment with its placebos, and limits.

Press `T` for a guided tour that drives the console by itself. Search and commands (`⌘K` or `/`) find streets, 100-blocks, building names and company portfolios, and jump to any view or action. **Act** also writes a one-page brief for each council district. Every view has a shareable link (`#detect`, `#simulate-b83148`).

## FALCON on Dallas (the neural model)

`backend/firebreak/falcon/` vendors the ST-MotionNet ("Toya") predictor from the founder's FALCON research, unchanged except for one import line. FALCON rebuilds a hidden signal field from sparse, fixed sensors. In Dallas the field is property distress and the sensors are buildings, which report only when someone calls 311. `net.py` turns two years of 311 into 104 weekly frames on a 256 × 256 grid, using FALCON's four input channels: signal, sensor mask, building map and unknown region. It trains both heads, the 90-day field (Poisson loss) and ignition (FALCON's focal loss), using only targets that end before the Jul 1, 2026 cutoff. It then scores the held-out quarter against the boosted model and simple baselines, and backtests crews searching on its belief. Results are in `falcon.json` and on Predict > Neural field. Where it loses, the table says so.

Result on the held-out quarter: the boosted model wins. FALCON's top 1% of cells hold 4.3% of next-quarter reports (boosted 5.6%, last year's counts 7.6%), and its top-100 ignition calls are 16% right (boosted 53%, base rate 14.3%). The crew backtest is the useful part: four crews searching quiet cells find 91 (FALCON belief) or 105 (boosted belief) new ignitions, against 23 when they patrol last year's hotspots.

```bash
cd backend
~/developer/falcon-stationary-sensors/.venv/bin/python -m firebreak.falcon.net 60   # about 35 min on an M3 CPU
~/developer/falcon-stationary-sensors/.venv/bin/python -m firebreak.falcon.net rescore   # re-run only the crew backtest
```

See [docs/RESEARCH.md](docs/RESEARCH.md) for the research behind each feature: past CBRE winners, startup patterns and repos.

## The numbers behind the dollars

Every dollar figure is built from real data or a published market figure. See [docs/MENTORS.md](docs/MENTORS.md) for what we still want CBRE to confirm.

| Input | Value | Source |
|---|---|---|
| Office rent | $35.09/sf/yr, full service | CBRE DFW Office Figures Q3 2026 |
| Retail rent | $21.62/sf/yr | Partners DFW Retail Q3 2026 |
| Industrial rent | $9.76/sf/yr, net | Cushman & Wakefield DFW Industrial MarketBeat Q3 2026 |
| Apartment rent | $1,461/unit/month, effective | Cushman & Wakefield DFW Multifamily MarketBeat Q3 2026 |
| How long a case stays open | Median days, measured from 311: code 6.2, nuisance 8.5, tenant complaint 13.9, unregistered rental 23.4 | Dallas 311 report and close dates since 2022 |
| Value lost next door | 0.9% per case within 200 m, residential neighbors only | Immergluck & Smith (2006) |

The DCAD building type picks the rent rate: office, retail or industrial. Churches, schools, government buildings, parking and hotels get no rent. Rent at risk means rent exposed while a case is open, times the chance a case opens.

## Wholesale lists: the same signal, pointed at sellers

List providers sell owners who already have a violation or a lien, so every wholesaler mails them the same week. Firebreak ranks owners before that point. Each list is a rule. We applied every rule on Jul 1, 2026 and checked what happened to its top 300 leads in the next 90 days.

| List | Rule | Rule alone | Our top 300 | Ranking adds |
|---|---|---|---|---|
| **Code stack** | 3+ reports in a year | 29% | **55%** | 1.9x |
| **Tired landlord** | Owner holds 2+ houses, mails elsewhere, 2+ reports across them | 12% | **36%** | 3.0x |
| **Block on fire** | Quiet house, block reports speeding up | 5.4% | **12%** | 2.3x |
| **First spark** | Never had a report, absentee or company owner | 4.0% | **9.3%** | 2.3x |

"Got a report" means a new 311 property report within 90 days of Jul 1, 2026. For comparison, 7.7% of all non-owner-occupied houses got one. "Rule alone" is every house that fits the rule, unranked. The ranking from the contagion model doubles or triples each rule's hit rate.

- Owner-occupied homes are never listed. Firebreak sends them to repair programs instead.
- Each lead gets the WHOLZR math: ARV, repairs, the 70% cash-buyer price, the offer, the $10,000 fee, and how many repeat buyers bought nearby at that price.
- **Owner names stay private.** The public `lists.json` has no names. Set `FIREBREAK_PRIVATE_OUT` to a folder *outside* the repo and the build writes owner names and mailing addresses there for the WHOLZR engine. The build refuses a folder inside the repo.

## Who does what

| Area | Owner | First task |
|---|---|---|
| **Pipeline and model** (`backend/`) | Open | Run the pipeline, then improve the network features (time-decayed Hawkes kernel, report type mix) |
| **Console** (`web/`) | `ronakkasaram` | Polish the 5-step demo path, then the 60-second stranger test |
| **API and what-if** (`backend/server.py`, new) | Open | Serve hotspots, and recompute a plan when a judge changes an assumption |
| **Numbers, Devpost, pitch** | Open | Take [docs/MENTORS.md](docs/MENTORS.md) to the CBRE booth and write the answers into `plan.ASSUMPTIONS` |

Claim a row by putting your login in it here and in [AGENTS.md](AGENTS.md).

**Work in parallel.** The console runs on the committed files in `web/public/data/`, so nobody waits on the pipeline. If a field changes, update [docs/CONTRACT.md](docs/CONTRACT.md) in the same commit and post on the board.

## Run it

```bash
# console only (uses the committed data)
cd web && npm install && npm run dev          # http://localhost:5173

# full pipeline (about 45 minutes on a laptop)
cd backend && uv sync
uv run python -m firebreak.fetch_311           # Dallas 311, about 2 min
DCAD_ZIP=/path/to/DCAD2026_CURRENT.zip uv run python -m firebreak.dcad
uv run python -m firebreak.build               # writes web/public/data/
uv run --group dev pytest -q
```

Get the DCAD export (about 200 MB) from [dallascad.org/DataProducts.aspx](https://www.dallascad.org/DataProducts.aspx) as the "Current Data Files" zip, or ask Ronak for a copy.

## How it works

```text
backend/firebreak/
  fetch_311.py   Dallas 311 reports since 2022: property distress plus infrastructure failures
  dcad.py        DCAD tax roll: buildings, owners (hashed), business tenants, condition, units, lease area
  geo.py         put buildings on the map: 311 positions, then house-number interpolation along the street
  model.py       features as of any date, labels 90 days later, base vs network models, the link tests
  hawkes.py      house-by-house Hawkes model: EM fit, held-out test, declustering arcs, expected reports
  audit.py       days-of-warning metric, fairness by council district, district-fair re-ranking
  scan.py        emerging-cluster alarms: expectation-based Poisson scan with the fast subset scan, and its backtest
  calibrate.py   Venn-Abers intervals and conformal selection (Benjamini-Hochberg) for the certified list
  causal.py      natural experiment: does closing a code case fast protect the neighbours? With placebos
  plan.py        reports prevented next door, dollars, WHOLZR underwriting, buyer matching, crew plan
  lists.py       wholesale lead lists, their backtest, and the private owner export for WHOLZR
  build.py       runs everything and writes web/public/data/
web/src/
  main.js        deck.gl + MapLibre map, the five views, search, links, timeline, budget plan and portfolio
  live.js        live Dallas 311 feed since the snapshot, matched to buildings and scored with the Hawkes kernel
  sim.worker.js  Monte Carlo cascades, exact expected counts and the CELF firebreak search, off the main thread
  panels.js      side panels for each view, charts, dossier, hold to approve, legend
```

## Privacy and honesty

- People are never named. Owner names become a hash. Only company owners (LLC, INC, LP and similar, never trusts) keep a name, because buyer matching needs it. Home addresses are hidden in the console by default.
- Owners that DCAD marks confidential (Texas Tax Code 25.025) are dropped. Over-65, disability and veteran fields are never loaded.
- Homestead owners get help first: the plan offers City of Dallas repair programs, not a purchase offer.
- Nothing is sent. Approvals stay in the browser.
- Rents come from Q3 2026 market reports and case durations are measured. The remaining placeholders (repair tiers, ARV factor, inspection cost) are marked "Placeholder" in `plan.ASSUMPTIONS`.

## Not building

- A chatbot as the main interface. The model and the math produce every number.
- Real outreach. The plan stops at approval.
- Anything that names a homeowner.

## The agent board

Same setup as our first repo. Our coding agents talk on one pinned issue, the **Message Board** (issue #1).

```bash
git pull
gh auth login
tools/board whoami      # should print your GitHub login
tools/board read -n 5   # should show recent posts
```

Claude Code picks up the board from the project hooks on its own. Any other agent should read [AGENTS.md](AGENTS.md) and run `tools/board unread` before each task. Set `BOARD_WAIT=off` if waking on every post gets expensive. Never write `Closes #1`.

## Credits and prior work

- **WHOLZR** (Ronak's private wholesaling system, built before the event): Firebreak reimplements its ideas, including the crew roles (Radar, Hawk, Echo, Oracle, Magnet, Shield, Closer), the 70% buyer rule with a $10,000 minimum fee, buyer-first matching from deed records, the DCAD privacy rules and the Night Survey look. No WHOLZR code, keys or contact data are in this repo.
- Agent board: [hackathon-agent-board](https://github.com/azizu06/hackathon-agent-board). `tools/board` and `.claude/` are copied unchanged, and `AGENTS.md` is adapted from its template.
- Data: Dallas Central Appraisal District 2026 export and Dallas Open Data 311 Service Requests. Basemap © CARTO, © OpenStreetMap contributors.
- Spillover rate: Immergluck, D. & Smith, G. (2006), "The External Costs of Foreclosure," *Housing Policy Debate* 17(1).
- Methods: Mohler, G. et al. (2011), "Self-exciting point process modeling of crime," *JASA* 106(493); Kempe, D., Kleinberg, J. & Tardos, É. (2003), "Maximizing the spread of influence through a social network," KDD; Leskovec, J. et al. (2007), "Cost-effective outbreak detection in networks," KDD; City of Chicago food-inspection forecasting (2014); Data Science for Social Good, Cincinnati blight and the Aequitas bias audit toolkit; Alaimo Di Loro, P. et al., spatio-temporal Hawkes models for road accidents in Rome. No code from these projects is used.
