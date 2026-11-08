# Questions for the CBRE mentors

Three CBRE engineers are listed in the challenge PDF. Find them at the CBRE booth or in the CBRE Discord channel, where the "additional resources" are posted after the opening ceremony. Their contact details stay in the PDF and Discord, not in this repo.

Bring the console open on `[ proof ]`. Ask in this order. Write each answer under its question and change `plan.ASSUMPTIONS` in the same commit.

## 1. Numbers we use now

| Assumption | What we use | Source | Ask |
|---|---|---|---|
| Office rent | $35.09/sf/yr, full service | CBRE DFW Office Figures Q3 2026 | Should Downtown or Uptown use the submarket rate instead of the metro average? |
| Retail rent | $21.62/sf/yr | Partners DFW Retail Q3 2026 | Does CBRE publish a DFW retail figure we should use instead? |
| Industrial rent | $9.76/sf/yr, net | Cushman & Wakefield DFW Industrial Q3 2026 | Is CBRE's own Q3 figure different? |
| Apartment rent | $1,461/unit/month, effective | Cushman & Wakefield DFW Multifamily Q3 2026 | Same question. |
| Downtime | Median days a 311 case stays open, by kind (measured, see `meta.json` → `assumptions.days_open`) | Dallas 311, 2022 to today | Is "rent exposed while the case is open" the right frame, or would CBRE count a share of rent, an SLA penalty, or both? |
| Value lost next door | 0.9% per case within 200 m, residential only | Immergluck & Smith (2006) | Does CBRE have a figure for commercial neighbors? |
| Inspection | $450 | Placeholder | What does a CBRE building condition inspection cost? |

## 2. What would make it real for CBRE

1. Is there a dataset in the Discord resources (work orders, sensor readings, lease data) we should plug in next to 311?
2. A facilities manager sees our dossier. Which step in the plan would they actually do this week, and which would they ignore?
3. What is a typical tenant SLA penalty when a building problem stays open too long?
4. CBRE manages portfolios. Should the "same owner" link use CBRE's portfolio lists instead of the DCAD owner?

## 3. Judging

1. How much do the judges weigh the live demo against the Devpost write-up?
2. Do they want to see the code run, or is the console enough?
3. Will they mind that we measure a link and report that it does *not* matter (pipes and streets, 0.99x)? We think that is part of the answer.

## Answers

_Write the mentor's answers here, with their first name and the time._
