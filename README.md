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

## The demo

Plan for a 3 minute pitch and 2 minutes of questions.

1. **Spread.** Press play. Two years of Dallas 311 reports appear block by block. "This is what fragmented looks like: 4 systems, no shared IDs."
2. **Broken.** Point at the side panel: CBRE's claim crossed out, with 3 measured links below it. Next door and same owner are lit; pipes and streets is gray.
3. **Proof.** Click `[ proof ]`. The model is frozen on Jul 1, 2026. Press play. Watch columns turn green as reports land on the buildings it flagged. "It called 1,228 of 2,000. Chance would have called about 128."
4. **Next 90 days.** The city becomes a terrain of expected reports that rises as you drag forward.
5. **Act.** Click the top hotspot. The camera flies in and the owner's other buildings arc out. Show why, what spreading costs, and the crew's plan. **Hold to approve.**

## Who does what

| Area | Owner | First task |
|---|---|---|
| **Pipeline and model** (`backend/`) | Open | Run the pipeline, then improve the network features (time-decayed Hawkes kernel, report type mix) |
| **Console** (`web/`) | `ronakkasaram` | Polish the 5-step demo path, then the 60-second stranger test |
| **API and what-if** (`backend/server.py`, new) | Open | Serve hotspots, and recompute a plan when a judge changes an assumption |
| **Numbers, Devpost, pitch** | Open | Ask CBRE mentors for the real rent and downtime numbers in `plan.ASSUMPTIONS` |

Claim a row by putting your login in it here and in [AGENTS.md](AGENTS.md).

**Work in parallel.** The console runs on the committed files in `web/public/data/`, so nobody waits on the pipeline. If a field changes, update [docs/CONTRACT.md](docs/CONTRACT.md) in the same commit and post on the board.

## Run it

```bash
# console only (uses the committed data)
cd web && npm install && npm run dev          # http://localhost:5173

# full pipeline (about 6 minutes)
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
  plan.py        reports prevented next door, dollars, WHOLZR underwriting, buyer matching, crew plan
  build.py       runs everything and writes web/public/data/
web/src/
  main.js        deck.gl + MapLibre map: spread, proof and next-90-days modes, time slider
  panels.js      claim card, hotspot list, dossier, hold to approve
```

## Privacy and honesty

- People are never named. Owner names become a hash. Only company owners (LLC, INC, LP and similar, never trusts) keep a name, because buyer matching needs it. Home addresses are hidden in the console by default.
- Owners that DCAD marks confidential (Texas Tax Code 25.025) are dropped. Over-65, disability and veteran fields are never loaded.
- Homestead owners get help first: the plan offers City of Dallas repair programs, not a purchase offer.
- Nothing is sent. Approvals stay in the browser.
- Placeholder numbers are marked "Placeholder" in `plan.ASSUMPTIONS` and in `meta.json`. Replace them with mentor numbers before judging.

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
