# Making the promo

Firebreak records its own promo. Film mode plays the guided tour full screen, with the console's chrome hidden,
between a title card and an end card. Every shot is the live product, so nothing has to be staged or edited in.

## Record the full film (2 min 7 s)

1. Run the console (`cd web && npm run dev`) or open the published preview.
2. Close other tabs and set the window to 1920 × 1080. A 16:9 window gives a clean frame.
3. Start a screen recording:
   - macOS: press `Cmd-Shift-5`, then "Record Selected Portion" over the browser window.
   - OBS: use a Window Capture source and set the canvas to 1920 × 1080 at 60 fps.
4. Open the console and press `F`. The window goes full screen.
5. Stop recording when the end card fades, about 2 min 7 s later. Press `Esc` at any time to stop the film.

The title card holds for 4 seconds and the end card for 5 seconds, which leaves room for a fade in an editor.
The storyboard on the product site (section 07) lists each shot with its start time.

## The 45-second cut

The judges' video slot and social posts want something short. Cut these five shots out of the full recording.
The timings are from the full film.

| Cut | From the film | Length | Voice-over |
|---|---|---|---|
| 1 | Title card, 0:00 | 4 s | "One neglected house raises the odds for every house around it." |
| 2 | "Distress clusters, and spreads", 0:13 | 9 s | "Firebreak watches every building in Dallas, 241,588 of them, and flags where distress is clustering faster than its own history." |
| 3 | "Trace it to the origin", 0:22 | 9 s | "It traces each new problem back to the building that most likely started it." |
| 4 | "One building, 400 futures", 1:08 | 15 s | "Click any building and it plays out 400 futures, then finds the three repairs that spare the most neighbours." |
| 5 | End card, 2:02 | 5 s | "Tested on a quarter the model never saw. Predict it. Trace it. Stop it." |

Read every number in the voice-over from the console on the day you record: the build changes them.

## The live demo instead of a video

To show the resolution playbook, record it directly instead of using film mode:

1. Press `0` for Home.
2. Click **Resolve** on the top cluster. The playbook runs six logged steps in about 10 seconds.
3. Hold **Approve**.
4. Press `0` again. The case is now in the inbox.
5. Mark it **Crew dispatched**.

This is the 40-second story of the product: from alarm to approved case, with a person in the loop.

## Stills

The product site uses real screenshots in `web/public/shots/` (WebP, 1230 × 872). To refresh them after a
build:

1. Open each view at a 1440 × 900 window.
2. Move the pointer to the bottom-right corner.
3. Take the screenshot and convert it with `cwebp -q 82`.

| File | View |
|---|---|
| `predict.webp` | Predict > Forecast, 3D |
| `home.webp` | Home, compliance workspace |
| `neural.webp` | Predict > Neural field, crews dispatched |
| `simulate.webp` | Simulate the top hotspot, firebreaks found |
| `playbook.webp` | Playbook finished on cluster 1 |
| `brief.webp` | Act > District brief with its route |
| `evidence.webp` | Evidence |

## Rules for anything we publish

- **Numbers:** use only numbers that appear in the console, and quote them as the console shows them.
- **Privacy:** never show an owner's name. Homes appear at the 100-block level, which the console already does.
- **Pricing:** the prices on the product site are illustrative pilot pricing. Say so wherever they appear.
