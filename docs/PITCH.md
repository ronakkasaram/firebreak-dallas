# Presenting Firebreak

A guide for whoever is at the table. Read it once out loud before judging.

## Deadlines and logistics

| When | What |
|---|---|
| Sat Nov 7, 11:00-11:15 pm | Initial Devpost submission (required) |
| Sun Nov 8, 12:00 pm | Final Devpost submission |
| Sun Nov 8, 1:00-4:00 pm | Judging at tables in ECSW / ECSS. Table numbers are posted in Discord |
| Sun Nov 8, 5:00 pm | Closing ceremony, ATEC Auditorium |

- Enter up to three tracks: CBRE "Predict Before It Spreads", plus two HackUTD tracks that fit (for example Overall and Design, once they are announced).
- Check the CBRE Discord channel. The brief says extra resources are posted there after the opening ceremony.
- Judges spend about 2 minutes per table. Have the console open on `#detect`, zoomed to the city, with the timebar at today.

Booth checklist:
- [ ] Laptop charged, charger, a second screen if you have one.
- [ ] `cd web && npm run dev` running. Also open the hosted preview as a backup.
- [ ] Hotspot connection (for the live 311 feed). Without internet the console says "replay · 48 h" and still works.
- [ ] Browser zoom at 100%, other tabs closed, notifications off.
- [ ] This page printed or on a phone.

## The safety net: press T

The **Tour** button (or `T`) runs the whole demo by itself in about 90 seconds: Detect, the cluster alarm,
the hidden same-owner network, the 90-day forecast, the backtest replay, one building simulated with its firebreaks, the budget plan, a
council district brief and the Evidence tab. Every caption is read from the data files. Talk over it, pause
it (the pause button), step with ‹ ›, or press Esc to take over. If a judge arrives mid-explanation, press T.

`⌘K` (or `/`) opens search and commands: type "brief", "backtest", "export", a street name or a company.

## The 30-second version

> "CBRE's brief says property networks are too fragmented to detect hidden dependencies. We tested that on
> every building in Dallas: 241,000 buildings from the appraisal district joined to 650,000 city 311
> reports, with no shared IDs. Problems do spread: a report next door raises a building's odds 26%, a
> report at another building with the same owner raises them 20%, and pipes and streets don't matter.
> Firebreak predicts where distress spreads next, simulates what happens if you fix one building, and
> turns a budget into a ranked list of interventions with the dollars protected. It's live on today's
> 311 feed."

## The 2-minute walkthrough (the demo path)

Press the number keys; they switch views.

1. **Detect (key 1).** "This is every property report in Dallas, the last 60 days." Press space to play
   a year. "The squares are emerging clusters: places reporting faster than their own history. Cluster 1
   has 37 houses with a new case where we expected under one." Point at the live dot in the top bar:
   "These are reports filed since our snapshot, pulled from Dallas Open Data, and this list shows which
   buildings' outlook just went up because of them."
2. **Predict (key 2).** "Next 90 days. Of the 2,000 buildings we flagged on a quarter the model never
   saw, 61% got a report, against a 6.5% base rate: 9.6 times better than chance." Click Backtest and
   press play: the columns turn blue as reports land. "This is the proof replaying."
3. **Simulate (key 3).** Click any building. "We run 400 possible futures for this building and every
   building within 700 m, with a self-exciting spread model fitted to all of Dallas." Click "Find 3
   firebreaks". "These are the three buildings whose repair prevents the most reports at other houses.
   The chart shows the expected reports with and without them."
4. **Act (key 4).** Drag the budget. "Give it a budget and costs, and it picks the buildings that prevent
   the most reports per dollar, counting the reports they would set off next door. We rank by reports, not
   property value, so rich blocks don't jump the queue. Export the work orders, hold to approve. Nothing is
   sent: a human signs off."
   Then click **District brief**: "Every council office gets its own page: what's happening in its
   district, its spread rate, its fairness check and its next 10 actions. One click copies it into an email."
5. **Evidence (key 5).** "Every claim is tested here, including the ones that failed." Point at the
   closure study: "We asked whether closing a code case fast protects the neighbours. It doesn't, beyond
   what was already there, and we show the placebo that proves it. Closing a ticket isn't fixing a house."

Close: "Firebreak is to blight what First Street is to floods: a forecast you can act on, house by house."

## The 3-minute version

Add these between steps 3 and 4:
- **Portfolio (Act, Portfolio tab, or search a company name).** "For a property manager: pick a
  portfolio. This column is how much of each building's risk comes from neighbours they don't own. That is
  the hidden dependency CBRE's brief talks about, measured."
- **Fairness (Evidence).** "Dallas spent $2.56M on AI trash-truck cameras; 68% of the citations landed in
  three districts. Before anyone acts on our list, we audit it by council district. Five districts were
  under-served at first; our district-fair re-ranking fixes all five and costs two points of precision."

## Features to reach for when a judge asks "can it do X?"

| Ask | Where | What to say |
|---|---|---|
| "How bad is this building?" | Click it (any view) | "Distress Factor 7 out of 10, like a flood factor. The strip is two years of its reports by week." |
| "What happens if it gets worse?" | Simulate > Stress test, +10 | "Ten new reports here today means about N more within 700 m over 90 days, through the same cascade the model learned." |
| "Whose problem is it?" | Simulate > Who this building pushes on | "Its reports raise these neighbours' odds. That's the part of the problem its owner doesn't pay for." |
| "What would you do with $500K?" | Act > Budget plan, drag the slider | "Ranked by reports prevented per dollar. The curve shows where more money stops paying." |
| "Who uses this tomorrow morning?" | Act > District brief > 20 stops | "Each council office gets a brief and tomorrow's crew route: N km, about N hours, open in Google Maps." |
| "What's in it for a property owner?" | Act > Portfolio (search a company) | "Share of their risk coming from buildings they don't own, and the outside buildings to fix or buy first." |
| "And the wholesale angle?" | Act > Acquisition leads, open a lead | "Natural buyers next door: the portfolios that lose most if this house tips. A drive-for-dollars loop plans the route." |
| "Is it real time?" | The live dot, top bar | "New 311 reports since our snapshot, matched to buildings and re-scored." |
| "Show me the hidden dependency." | Detect, press `N` | "Each arc runs from a building with a report this year to another building with the same owner. That link raises the odds 1.20×. About 5,900 buildings sit on one." |
| "Can I keep an eye on a building?" | Open a building, press Follow | "It's ringed on the map, and the Detect panel flags it when a new 311 report lands at it or near it." |

## How it maps to what CBRE asked for

| CBRE brief | Firebreak |
|---|---|
| "a clear, live-demoable, working prototype" (the only scoring rule) | Runs in the browser on real Dallas data, with a live 311 feed |
| "connects fragmented real estate data" | DCAD roll + 311 + business tenants, joined by address with no shared IDs |
| "detect hidden dependencies" | Next door 1.26×, same owner 1.20×, pipes and streets 0.99× (measured on buildings with no prior report) |
| "predict cascading failures" | Hawkes spread model; Monte Carlo cascades; stress test (inject a shock, watch it spread); spread rate R by month and district |
| "quantify business impact" | Value at stake, value lost next door, rent exposed, value protected per dollar |
| "execute solutions before disruptions spread" | Firebreak search, budget plan, crew routes, district briefs, work-order export, human approval |
| "move beyond passive visualization" | Every view ends in an action: simulate, plan, approve, export |
| "real-time risk-scoring engines" | Live feed re-scores the neighbours of every new report |
| "self-updating dependency graphs" | Trigger arcs (each report linked to the one that most likely set it off); inbound and outbound push for every building; owner-to-owner exposure |

Words to use with CBRE engineers: priority interventions ranked by impact, work orders, portfolio-level
impact, reactive to proactive to predictive, SLA, value protected. Avoid "wholesale leads" at the CBRE
table; call that tab "acquisition leads" and mention it only if asked about revenue.

Bridge to commercial real estate: "The engine doesn't care what a node is. Here nodes are buildings and
the links are measured from 311. Inside a CBRE campus, nodes are assets and the links are work orders and
alarms. The same fit, simulation and firebreak search apply."

## Numbers cheat sheet

All from `web/public/data/` (meta.json, hawkes.json, alarms.json, evidence.json). Re-check after each build.

| Claim | Number |
|---|---|
| Buildings | 241,588 |
| Property reports (since 2022) | 649,925 |
| Top-2,000 precision, held-out 2026-07-01 | 61.4% vs 6.45% base rate (9.6×) |
| AUC, network vs own history | 0.735 vs 0.727 |
| Next door / same owner / infrastructure | 1.26× / 1.20× / 0.99× |
| Lead time, 50 visits a day | 1,018 cases reached a median 18.5 days before the first call |
| Same crew ranking by last year's complaints | 938 cases |
| Hawkes held-out gain | +1.10 nats per report over no spread |
| Reports set off by a nearby earlier report | 39% |
| Spread rate R, by month | about 0.24 in Aug-Sep 2026; each problem becomes about 1.3 reports |
| Time-rescaling KS | 0.156 vs 0.259 with no spread |
| Certified list (promised at most 10% wrong) | realised 7.1% wrong on the held-out quarter; 243 buildings certified today |
| Fairness | 5 districts under-served (1, 3, 5, 8, 13); none after re-ranking; precision 61.4% to 59.3% |
| Cluster alarms, backtest | top 3 clusters a week kept reporting at 2.0× baseline for 60 days (busiest cells by count: 1.75×) |
| Closure study | -8.0% [-14.2, -3.0] after, but -7.3% [-13.0, -1.0] in the 180 days before: the gap predates the closure, so no causal effect |

## Hard questions, honest answers

- **"Isn't 311 just measuring who complains?"** Partly. That's why we audit recall by council district and
  re-rank so every district gets its share. We also show the network edges on buildings that had never had
  a report, so it's not just "the same complainers again".
- **"Your fancy spread model ranks worse than the boosted trees?"** Yes: 54% vs 61% on the top 2,000. So
  the boosted model ranks, and the Hawkes model does what trees can't: simulate interventions and cascades.
  We use each where it's measurably better.
- **"Is the calibration real?"** The certified list kept its 10% promise (7.1%). At 20% it broke (26%)
  because summer 2026 was quieter than spring, so we only certify at 10%, and the Evidence tab shows the
  failure.
- **"Does fixing a house actually help the neighbours?"** Our own natural experiment on closure speed says
  closing a ticket fast does not, beyond pre-existing differences. Randomised trials in Philadelphia found
  real repairs of abandoned houses cut nearby gun violence 8-13%, while trash cleanup alone did nothing.
  So the plan recommends repairs and purchases, not faster ticket closure.
- **"Where do the dollar numbers come from?"** Published rates: 0.9% value loss per distressed house within
  200 m (Immergluck & Smith 2006), Q3 2026 DFW asking rents. Repair costs are labelled placeholders you can
  edit in the Act tab.
- **"How fast is it?"** The backend build takes about 30 minutes on a laptop. In the browser, a 400-future
  simulation runs in about a second in a Web Worker; the firebreak search scores hundreds of scenarios in a
  few seconds.
- **"Privacy?"** Owner names never reach the browser. Homes are shown at the 100-block level, like police
  crime maps. Owner-occupied homes are never on any lead list. Nothing is sent from the console.
- **"How is this different from Dallas's camera program?"** City Detect flags what already happened, and
  20,000 flags became 57 citations. Firebreak forecasts what is about to spread, says how sure it is,
  audits fairness first, and ends at a human approval.
