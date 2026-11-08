# Research: what wins, what sells, and what we borrowed

Written overnight on Nov 7-8, 2026, while building. This file covers four things:

1. What past CBRE winners at HackUTD built.
2. Which features made comparable startups successful, and the Firebreak version of each.
3. The open-source repos and papers worth knowing.
4. How the FALCON research maps onto this problem.

Each borrowed idea names its source, so a judge can ask "where did that come from?" and get a straight answer.

## 1. The brief, point by point

From `CBRE-ChallengeStatement-HackUTD2026.pdf`, "The Invisible Network". The prediction to break:
*"Commercial property networks are too fragmented to detect hidden dependencies, leaving critical
infrastructure exposed to unexpected cascades and inevitable operational failure."*

| What the brief asks for | Where Firebreak answers it |
|---|---|
| "uniquely connects fragmented real estate data" | DCAD roll + Dallas 311 + business tenants, joined by address with no shared IDs. The owner graph links buildings across town |
| "detect hidden dependencies" | Measured links: next door 1.26×, same owner 1.20×, pipes and streets 0.99×. The hidden network is drawn on the map (key `N`) |
| "predict cascading operational failures" | Hawkes spread model, Monte Carlo cascades, stress test, and the FALCON neural field (Predict > Neural field) |
| "recognize the root cause" (the lore) | **Root cause** on every building: the chain of earlier reports that most likely set this one off, with probabilities |
| "quantify business impact" / "quantifying financial risk" | Value at stake, rent exposed, value protected per dollar, and the budget frontier |
| "execute direct solutions before disruptions spread" | Firebreak search, budget plan, crew routes, and the **Resolution playbook**, which runs the whole response for an alarm and stops at a human approval |
| "move beyond passive dashboards to actionable intelligence" | Every view ends in an action: simulate, plan, route, approve, export |
| "real-time risk-scoring engines" | Live Dallas 311 feed re-scores neighbours; the watchlist flags followed buildings |
| "self-updating dependency graphs" | Trigger arcs and the owner network rebuild from the data, and live reports join them as they arrive |
| "orchestrate agentic AI workflows that execute resolution plans" | Resolution playbook: a visible, step-by-step agent that calls the console's own tools (root cause, simulate, firebreaks, plan, route, brief) and logs each result |
| "a clear, live-demoable, working prototype" (the only scoring rule given) | Browser console on real data, a 10-step guided tour (`T`), and a hosted preview as backup |

## 2. Past CBRE winners at HackUTD

Read from the Devpost galleries (winner badges on each project page).

| Year | Winner | What it built |
|---|---|---|
| 2025 (Lost in the Pages) | **Pact** | AI-assisted contract drafting, multi-party approval workflow, Solana anchoring (also won Best Use of Solana) |
| 2025 | **TrustEstate AI** | Map-first property search with Gemini fact-checking of listing data, compare and analytics views (React, Google Maps) |
| 2025 | **Cura** | Commercial property forecasting, pros and cons, market sentiment, property comparisons |
| 2024 (Ripple Effect, brief: sustainable office buildings) | **Eco Fast Track** | Arduino water-flow sensors with a web dashboard, benchmarks and automatic email alerts (also won Veolia) |
| 2024 | **Greenify** | Emissions calculator with a "Sustainability Score" and a GPT-4 advice chatbot |
| 2024 | **EcoVerse** | (page has little text) |
| 2022 | CustomAssure, Scrutiny | AI/ML for customer experience (UTD CS news) |

Patterns across the winners:

- **A score a person understands.** For example, the Sustainability Score. Firebreak's version is the Distress Factor, 1 to 10.
- **Sensors and alerts**, as in Eco Fast Track. Firebreak's version is the live 311 feed, the watchlist and the FALCON sensor framing.
- **An AI assistant that does work.** Pact drafts contracts and Greenify answers questions. Firebreak's version is the Resolution playbook, built as a transparent agent and not a chatbot.
- **A polished, map-first UI with a real workflow,** not a notebook.

No past winner tested its claims on held-out data or showed a failed test. That is Firebreak's clearest edge, so keep the Evidence tab in the demo.

Another hackathon in the same category: the **Memphis City Hackathon 2025** "Blight Data Analytics" winner, BlightPredictor (Pixelz), was a risk map from historical data. Firebreak goes further on four points: house by house, with a measured spread model, interventions, and a held-out backtest.

## 3. Startups: why they work, and the Firebreak version

| Company | What made it work | Firebreak version |
|---|---|---|
| **Datadog Watchdog RCA** | It groups related anomalies into one "story". The story shows the service where the problem started and the downstream services it hit, so engineers see the origin, not 40 alerts | **Root cause**: for any building, the chain of earlier reports that most likely set it off (Hawkes branching probabilities). For a cluster, the origin buildings most of its cases descend from |
| **Datadog Service Map** | Dependencies are drawn automatically from observed traffic; Airbnb used it to find dependencies nobody knew existed | The hidden owner network and trigger arcs, drawn from data, not from a hand-made diagram |
| **Samsara / Uptake** | A prioritized backlog of "what to fix first". A flagged asset becomes a work order in a few clicks, and several tasks are bundled into one case | Budget plan ranked by reports prevented per dollar, work-order CSV, and the playbook bundling a cluster into one case with a crew route |
| **Palantir Foundry** | Data objects ("nouns") plus governed actions ("verbs"). What-if scenarios run on a fork and are merged only by an approved action | Simulate is the fork: stress test and firebreaks change nothing until a person approves the plan. Hold-to-approve is the governed action |
| **First Street (Risk Factor)** | One number per property, 1 to 10, that a homebuyer understands. Zillow put it on listings. Lesson from Dec 2025: Zillow pulled the scores after accuracy complaints from a listing service | Distress Factor 1 to 10, always shown with its calibrated interval and the held-out hit rate, so the number can be defended |
| **Cherre** | A real estate knowledge graph built by entity resolution across municipal sources. "Owner unmasking" walks the graph from a parcel to the investor behind LLCs | Address-level join of DCAD and 311 with no shared IDs; owner portfolios and same-owner arcs. Owner names never reach the browser |
| **PropStream / DealMachine / BatchLeads** | List stacking (several distress filters at once), driving for dollars with planned routes, and skip tracing | Four stacked distress lists with backtested hit rates; drive-for-dollars loop. Skip tracing is deliberately absent: nothing gets sent |
| **Tolemi BuildingBlocks** (Syracuse) | Cities buy one place where all building data lives, with a vacancy risk score | District briefs: one page per council office, with its fairness check |
| **Zillow Zestimate** | A number on every home, even the ones not for sale, plus a public error rate | Every building gets a forecast and the console publishes its error rates (Evidence) |

## 4. Repos worth knowing

Stars as of Nov 8, 2026 (`gh api`). "Used" means Firebreak copies or reimplements the method; "reference" means it backs a claim or is the path to scale.

**Spread and point processes**
- hongyuanmei/neurawkes (230★): Neural Hawkes Process. Reference for a neural spread model.
- SimiaoZuo/Transformer-Hawkes-Process (206★): Transformer Hawkes. Reference.
- ant-research/EasyTemporalPointProcess (363★): benchmark harness for neural point processes. Path to compare our EM Hawkes against neural ones.
- X-DataInitiative/tick (617★): Hawkes estimation in C++. Reference for a faster fit.

**Spatio-temporal neural forecasting (the FALCON neighbourhood)**
- liyaguang/DCRNN (1,458★), nnzhan/Graph-WaveNet (827★), VeritasYin/STGCN_IJCAI-18 (1,247★), LeiBAI/AGCRN (444★): graph-recurrent forecasting on sensor networks. Path to run FALCON on the building graph instead of a grid.
- benedekrozemberczki/pytorch_geometric_temporal (2,997★), GestaltCogTeam/BasicTS (1,838★): libraries and benchmarks for the above.
- kfukami/Voronoi-CNN (63★): rebuild a field from sparse sensors with Voronoi tessellation, the closest published cousin of FALCON's sparse-sensor input.
- Kaimaoge/IGNNK (131★): inductive kriging with graph networks, for estimating a value where no sensor exists. Reference for the blind-spot idea.
- LZH-YS1998/STHSL (42★), akaxlh/ST-SHN (22★): spatio-temporal crime prediction (ICDE 2022, IJCAI 2021), the nearest academic task to ours.
- ndrplz/ConvLSTM_pytorch (2,271★), openclimatefix/skillful_nowcasting (301★): ConvLSTM and DeepMind's radar nowcasting. Firebreak's neural field is a nowcast of distress the way these nowcast rain.

**Multi-agent search (FALCON's agent half)**
- oxwhirl/pymarl (2,223★), uoe-agents/epymarl (740★), instadeepai/Mava (941★, JAX): value-decomposition MARL (VDN, QMIX), the family FALCON's agents belong to.

**Calibration, fairness, scan statistics, entity resolution**
- scikit-learn-contrib/MAPIE (1,672★), henrikbostrom/crepes (586★), ip200/venn-abers (208★): conformal and Venn-Abers. Used: Firebreak reimplements Venn-Abers and conformal selection.
- dssg/aequitas (777★), dssg/triage (202★): fairness audit and risk modelling for policy work (University of Chicago DSSG). Used: same four-fifths rule.
- pysal/esda (263★): local hotspot statistics (LISA, Getis-Ord). Reference alongside our subset scan.
- nd7141/influence-maximization (158★): CELF and friends. Used: CELF firebreak search.
- moj-analytical-services/splink (2,563★), dedupeio/dedupe (4,527★), openvenues/libpostal (4,920★), datamade/usaddress (1,641★): probabilistic record linkage and address parsing. Path to a better DCAD and 311 join than our normaliser.
- uber/h3 (6,717★), visgl/deck.gl (14,742★): hex grids and the map engine. Used: deck.gl.

**Time series foundation models (comparison, not used)**
- google-research/timesfm (35,301★), amazon-science/chronos-forecasting (6,274★): pretrained forecasters. A per-district TimesFM baseline is a cheap next step.

## 5. FALCON, mapped onto Dallas

FALCON (the founder's research, `~/developer/falcon-stationary-sensors`) has two halves:

- **ST-MotionNet ("Toya") predictor:** rebuilds and forecasts a hidden signal field on a 256 × 256 map from sparse sensors. It uses a convolutional encoder, a ConvLSTM with self-attention over time, and two heads: a heatmap and a localization map. The stationary-sensor version fixes the sensor positions and lets the readings change.
- **Multi-agent RL agents (VDN, dueling DQN):** they move through a building and use the predictor's belief to find the source.

Dallas 311 has the same shape:

| FALCON | Firebreak |
|---|---|
| Hidden signal field | Property distress across the city |
| Stationary sensors | Buildings, which are fixed. A reading arrives only when someone calls 311 |
| Unknown-region mask | Building cells with no call for 12 weeks: the blind spots |
| Heatmap head | Expected new property reports per cell in the next 90 days |
| Localization head | Where a new hotspot ignites (no report in 90 days, then 2 or more) |
| Agents searching for the source | Inspection crews dispatched toward likely ignitions |

The predictor is the real Toya code, vendored unchanged in `backend/firebreak/falcon/`, and retrained on 104 weekly Dallas frames. Its training targets all end before the same Jul 1, 2026 cutoff the boosted model was frozen on. The backtest is in `falcon.json` and on Predict > Neural field, including where it loses. It does lose: top-1% capture 4.3% against the boosted model's 5.6%, and top-100 ignition precision 16% against 53%. The crew search is what carries over: aimed at quiet cells it finds 91 to 105 new ignitions, against 23 for patrolling last year's hotspots.

Not done: the RL agents are not retrained on Dallas. The crew search in the console uses a greedy policy on the predictor's belief map, and it is labelled that way.

## Sources

- CBRE challenge statement (Google Drive, CBRE-ChallengeStatement-HackUTD2026.pdf)
- Devpost galleries: hackutd-2025.devpost.com, hackutd-ripple.devpost.com (winner badges on project pages)
- [UTD CS: HackUTD hosts its largest hackathon](https://cs.utdallas.edu/26350/hackutd-hosts-its-largest-hackathon-2022/)
- [Memphis City Hackathon 2025](https://memphistn.gov/city-of-memphis-hackathon-2025/)
- [Datadog Watchdog RCA docs](https://docs.datadoghq.com/watchdog/rca/), [Datadog service map](https://datadoghq.com/blog/apm-watchdog-service-map-trace-search)
- [Samsara asset maintenance features](https://www.ccjdigital.com/technology/artificial-intelligence/article/15749298/samsaras-latest-asset-maintenance-features-utilize-ai), [Uptake on Samsara](https://www.samsara.com/marketplace/uptake)
- [Palantir scenarios](https://www.palantir.com/docs/foundry/ontology/overview-ontology-scenario/), [Palantir: why an ontology](https://www.palantir.com/docs/foundry/ontology/why-ontology)
- [Zillow removes climate risk scores (The Real Deal)](https://therealdeal.com/national/2025/12/01/zillow-drops-climate-risk-scores-after-industry-pushback)
- [Cherre: neighborhood-based entity resolution](https://blog.cherre.com/2021/07/02/improving-knowledge-graph-quality-with-neighborhood-based-entity-resolution/), [Cherre knowledge graph 101](https://blog.cherre.com/2022/04/08/knowledge-graphs-101-how-nodes-and-edges-connect-all-the-worlds-real-estate-data)
- [ReSimpli: BatchLeads vs PropStream](https://resimpli.com/blog/batchleads-vs-propstream/), [DealMachine vs PropStream](https://dealmachine.com/propstreamvdealmachine)
