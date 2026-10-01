# Visual style: shapes, colors, tags, notes, edges

Read this when you pick shapes, colors, tags or edge styles. A workflow file (e.g. `workflows/code-change-canvas.md`)
may override these defaults, and existing workspaces in the project win over both: match their style.

## Shape ids

Unknown ids render as a rectangle. Default sizes in parentheses. Defaults: fill `#ffffff`, outline `#2b2f36`, 14px.

- **General**: `rectangle` (160×80), `rounded`, `square`, `ellipse`, `circle`, `diamond` (140×100), `parallelogram`,
  `hexagon`, `triangle`, `triangle-right`, `pentagon`, `octagon`, `star`, `plus`, `trapezoid`, `cylinder` (90×110),
  `cloud`, `document`, `multi-document`, `note-shape`, `card`, `callout`, `callout-rounded`, `cube`, `tape`,
  `actor` (50×90, label below).
- **Flowchart**: `terminator` (start/end, 160×60), `rectangle` (process), `diamond` (decision), `parallelogram`
  (data in/out), `predefined-process` (call into another module), `document`, `multi-document`, `cylinder`
  (database), `internal-storage` (memory/cache), `manual-input`, `manual-operation`, `hexagon` (setup), `delay`,
  `stored-data`, `display` (UI output), `loop-limit`, `off-page` (continues in another workspace), `connector`
  (60×60), `merge`, `sort`, `collate`, `or`, `summing-junction`, `annotation` (bracket comment).
- **Block arrows**: `arrow-right`, `arrow-left`, `arrow-up`, `arrow-down`, `arrow-double`, `arrow-double-vertical`,
  `chevron` (pipeline step), `pentagon-arrow`.

## Palette (the UI's swatches)

- Dark (lines, text, accents): `#2b2f36` `#3d4450` `#6b2f2f` `#6e4428` `#6b5a24` `#2d5236` `#27405f` `#46315f`
- Light (fills, bodies, notes, title bars): `#ffffff` `#e5e5e5` `#ffc9c9` `#ffd6a5` `#ffec99` `#b2f2bb` `#c5e3ff` `#e5dbff`
- Tag colors, in turn: `#dd7e6b` `#ea9999` `#f9cb9c` `#ffe599` `#b6d7a8` `#a2c4c9` `#a4c2f4` `#9fc5e8` `#b4a7d6` `#d5a6bd`
- Canvas background: `#e4e5e8`.

## Each channel answers one question

**Tags** (words for categories, 2–6 tags, 1–2 words each):

- *Change status*: `New`, `Modified` (deleted files become red notes). See `workflows/code-change-canvas.md`.
- *Role*: `Entry point`, `Core logic`, `Config`, `Test`, `Types`, `UI`.
- *Review*: `Needs review`, `Risk`, `TODO`, `Breaking change`.

A paper may carry several. Tags go on the `file` when it has one snippet, on each `editor` when snippets differ.
Tag colors echo the matching title bar color.

**Title bar colors** (`headerColor`, one dimension, usually status):

| Meaning | `headerColor` | Matching tag color |
|---|---|---|
| New | `#b2f2bb` | `#b6d7a8` |
| Modified | `#ffd6a5` | `#f9cb9c` |
| Risky / breaking | `#ffc9c9` | `#ea9999` |
| Tests (when status isn't the dimension) | `#e5dbff` | `#b4a7d6` |
| Unchanged context | leave it out | — |

**Body colors** (groups, folders, multi-snippet files): one light tint per layer, e.g. blue `#c5e3ff` client, green
`#b2f2bb` server, purple `#e5dbff` storage, grey `#e5e5e5` neutral/legend. Don't reuse a title-bar color for another
meaning; leave bodies neutral when title bars already carry color.

**Targets**: highlight the exact lines (the hunk, the function body, the decision). Two places in one file = two
editors, not one big target.

**Annotations**: one phrase + step number: `2 · Checks the limiter before bcrypt`; for changes, lead with the status:
`Modified · now returns 429`.

**Notes** (1–4 short lines, 220–300 wide):

| Color | Intent |
|---|---|
| Yellow `#ffec99` (default) | Explanation, "why" |
| Pink `#ffc9c9` | Warning, bug, risk, breaking change |
| Blue `#c5e3ff` | Background, good to know, links |
| Green `#b2f2bb` | Decision / result / how to verify |
| Red `#ea9999` | Deleted file (what, why, replaced by) |

Place a note inside the container it's about, beside a paper with a dotted arrowless edge, or under the title when
it's about the whole canvas.

**Edges** (the verbs): solid = call / control flow; dashed = async, event, callback, return value; dotted with
`endMarker: "none"` = "implemented by", "see also", note attachment. Label with a verb (`calls`, `emits user.created`,
`on 401`, `yes` / `no`, `tests`); label every edge leaving a decision. Color only to encode something (e.g. `#6b2f2f`
error path) and put it in the legend. `rounded` / `step` paths in grid layouts, `curve` in free-form. Set sides to
follow the reading direction.

**Legend**: whenever colors or edge styles carry meaning, a small `group` titled `Legend` (grey `#e5e5e5`) near the
title, one row per meaning: a ~40-tall `rectangle` shape filled with the color and labeled, or a short `text`.

**Media**: a real screenshot of a UI step, saved under `.paperworkspace/media/<Workspace Name>/`, ~480 wide, captioned,
linked to the paper that renders it with a dotted arrowless `renders` edge.

## Layout conventions

- Title: `text` top-left, `fontSize` 32–40, `fontWeight` 700; optional subtitle (16–18, `#3d4450`) saying what it
  covers and where to start.
- Spacing: 80–120px between boxes in a row, 100–160px between rows; captions take 30px.
- Snippets of 5–40 lines read best; width 520–720.
