# Devpost submission (paste-ready)

**Project name:** Firebreak

**Tagline (under 200 characters):** Property distress spreads like fire. Firebreak predicts where it spreads next in Dallas, house by house, and tells you which buildings to fix first to stop it.

**Tracks:** CBRE: Predict Before It Spreads. Add up to two HackUTD tracks that fit (for example Overall, Design).

---

## Inspiration

CBRE's brief makes a claim to break: *"Commercial property networks are too fragmented to detect hidden
dependencies."* Dallas is a good test. Its appraisal roll, its 311 system and its business records share
no IDs. We wanted to know whether problems at one building really do spread to others, and if they do,
whether you can stop the spread before it happens.

## What it does

Firebreak is a console that goes from detecting a problem to acting on it, in five steps:

1. **Detect:** every property report in Dallas, plus a live pull of reports filed today. Emerging clusters are flagged with a subset-scan statistic, and the spread rate is shown by month and council district.
2. **Predict:** each of 241,588 buildings gets a 90-day forecast. On a quarter the model never saw, **61% of its top 2,000 got a report, against a 6.5% base rate**. A certified list promises at most 10% wrong, and it held at 7.1%.
3. **Simulate:** click any building and Firebreak runs 400 possible futures for it and its neighbours. It then searches for the three "firebreaks", the repairs that spare the most reports at other houses.
4. **Act:** give it a budget and it ranks interventions by reports prevented per dollar, exports work orders, and waits for a human to approve. A portfolio view shows owners how much of their risk comes from neighbours they don't control.
5. **Evidence:** a model card with every test, including the ones that failed.

It is packaged as a product, not a notebook:

- **A product site** that leads with the problem, then shows how it works with real screenshots. It has a street lookup into the console, a proof table that lists the misses next to the wins, the data contract as endpoints, illustrative pricing and an FAQ. Every number is read live from the pipeline's files.
- **A Home screen for each team** (code compliance, owners and managers, acquisitions), with today's clusters, role-specific next moves and a data-health table.
- **A cases inbox:** each approved playbook becomes a case that moves from Approved to Crew dispatched to Resolved, with a timestamped log, a route and a CSV export.
- **Film mode** (press F) records the promo from the live product: the guided tour, full screen, between title and end cards.

Built for the people who act on it:

- **Every building gets a Distress Factor** from 1 to 10, like a flood factor, plus a two-year timeline of its reports.
- **The hidden network is drawn on the map:** arcs from each building with a report this year to the same company's other buildings.
- **A watchlist:** follow any building, and Firebreak flags it when a new live 311 report lands at it or nearby.
- **A stress test** injects hypothetical reports at any building and shows the cascade they set off.
- **Each council district gets a one-page brief** and tomorrow's crew route, planned with nearest-neighbour and 2-opt and handed off to Google Maps.
- **Property owners see the share of their risk that comes from buildings they don't own**, and which outside buildings to fix or buy first.
- **Root cause:** click a building and Firebreak traces the chain of earlier reports that most likely set it off, each link with its probability, back to the origin (Hawkes branching posterior).
- **A resolution playbook (press R on a cluster):** an agent runs the console's own tools one visible step at a time. It traces the cluster to its origin, simulates it, picks firebreaks, costs the work orders, routes a crew, then stops for a person to hold Approve. It is a fixed plan of tool calls, not an LLM, so every number in its log is computed.
- **A neural field (FALCON):** our sparse-sensor ConvLSTM research model, retrained on 104 weeks of Dallas. Buildings are sensors that only report when someone calls. It maps likely new hotspots and blind spots, and dispatches search crews on its belief.
- **A deal desk** for acquisition leads: offer waterfall, seller odds by discount band and expected fee per contact, from our WHOLZR underwriting engine.
- **For buyers who repair and resell**, each lead shows its natural buyers: the company portfolios next door that lose the most if it tips. A drive-for-dollars loop plans the route.

Two of CBRE's three "hidden dependencies" turned out to be real and measurable, even on buildings that had
never had a report:

- A report **next door** raises a building's odds **1.26×**.
- A report at **another building with the same owner** raises them **1.20×**.
- **Shared pipes and streets: 0.99×**, no effect.

## How we built it

- **Data:** the DCAD 2026 certified roll (buildings, owners, tenants) and 2.5 years of Dallas 311 from the Socrata API. They are joined by normalised address and house-number interpolation.
- **Prediction:** gradient-boosted trees, with and without network features. Every claim is tested on a later quarter the model never saw.
- **Spread:** a spatio-temporal **Hawkes process** fitted by EM with stochastic declustering, with two time scales, kind-specific triggering and covariates in the background rate. It gains +1.10 nats per report over a no-spread model. Its residuals were checked with Ogata's time-rescaling test.
- **Simulation:** Monte Carlo cascades with common random numbers, run in a Web Worker. The firebreak search uses lazy greedy (CELF) influence maximisation, run in reverse.
- **Alarms:** an expectation-based Poisson scan with the fast subset scan (Neill 2012), with significance judged against a year of weekly maxima.
- **Calibration:** Venn-Abers intervals, plus conformal selection with Benjamini-Hochberg for the certified list.
- **Fairness and causality:** a council-district fairness audit (four-fifths rule) with district-fair re-ranking. A ring difference-in-differences natural experiment on case-closure speed, with placebo tests.
- **Neural field:** the ST-MotionNet predictor from our FALCON research (CNN encoder, ConvLSTM with self-attention, Poisson and focal-loss heads) in JAX, trained on 256 × 256 weekly frames with the same Jul 1 cutoff.
- **Front end:** deck.gl and MapLibre, with binary columnar data so 241,588 buildings render in the browser.

## Challenges we ran into

- **No shared IDs.** No source shares an ID with any other, so every join is fuzzy.
- **Our most sophisticated model ranks worse than the simpler one.** The Hawkes model hits 54% on the top 2,000, against the boosted model's 61%. So the boosted model ranks, and the Hawkes model runs the what-ifs.
- **Calibration broke at looser settings.** The certified list held at 10%, but at 20% it ran to 26% wrong because summer was quieter than spring. We only certify at 10%.
- **Our neural network lost.** FALCON's top 1% of cells caught 4.3% of next-quarter reports, the boosted model 5.6%. Its ignition calls were 16% right, the boosted model's 53%. What survived is its search idea: crews sent to quiet cells find 4.6× the new hotspots that crews patrolling last year's hotspots do.
- **The closure study came back negative.** Closing a code case fast looks protective (−8%), but the same gap existed before the case was even opened, so it isn't causal. We show that instead of hiding it.

## Accomplishments that we're proud of

- **It's all real.** Every number in the console comes from real public data and a held-out test, with nothing synthetic.
- **It flags problems early.** A 50-visit-a-day crew following Firebreak reaches 1,018 cases a median **18.5 days before** the first call.
- **It is fair across districts.** Five council districts were under-served at first. After re-ranking none are, at a cost of two points of precision.
- **It never ranks by property value**, so rich blocks don't jump the queue.

## What we learned

- **Distress spreads, but slowly and locally.** About 39% of reports were set off by an earlier report nearby. The typical delay is about a month and the typical distance is about 50 m.
- **Closing a ticket is not fixing a house.**

## What's next for Firebreak

- **More cities.** Any city on the Open311 standard plus a county appraisal roll can run the same pipeline.
- **Inside a building.** For a property manager the nodes become assets, and the links become work orders and alarms.
- **A pilot with a code-compliance team or a property manager**, measuring prevented cases against a control area.

## Built with

python, numpy, scipy, scikit-learn, pandas, javascript, deck.gl, maplibre, vite, web-workers, socrata, dallas-open-data
