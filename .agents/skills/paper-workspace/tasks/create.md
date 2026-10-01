# Creating a workspace

Goal: a canvas someone reads in a couple of minutes without help, a guided tour of the real code, not a dump of
files. Every paper, note, tag and color earns its place. Also read [../reference/format.md](../reference/format.md)
before writing JSON, and [../reference/visual-style.md](../reference/visual-style.md) when choosing shapes and colors
(unless the project's existing workspaces already show the style to match).

## 1. Research the code

- Find the **entry point** (route, command, UI event, job, consumer) and trace the flow to its **outcomes**
  (response, stored data, event, rendered UI).
- For each step record the file, the exact line range, and the trimmed first line (for `anchor`). Read those lines
  by range; don't guess line numbers and don't read whole files you don't need.
- Note branches (validation failure, cache hit/miss, errors), async boundaries, external systems.
- Existing workspaces: run `outline.mjs` on one (not `--code`) to copy its conventions (tag names, colors, layout).
- Project structure: one project, or a workspace of **child projects** (top-level dirs with their own
  `package.json`, `pom.xml`, `go.mod`, `.git`…)? Each snippet's project/directory becomes its folder.

## 2. Plan the story before the layout

Write a short outline (in your head or scratch, not on the canvas):

- **Title**: the question or change ("How a password reset works", "Feature: rate-limited login").
- **Steps** (usually 4–10): snippet (file + lines), one-line caption, what connects it to the next.
- **Categories** to scan for (status, role, risk) and their encoding (tags, title bar color).
- **Reasoning** (why, decisions, gotchas, open questions) → notes.
- **Supporting context** (models, config, types) → to the side.
- **Legend** whenever colors or edge styles carry meaning.
- **Tests**: off by default. If the user didn't say, ask once ("Include the test files on the canvas?"). If not,
  list them in a green "How to verify" note. If yes, each test paper sits right beside or under the paper it tests
  (same lane, same folder when its path fits, otherwise just outside, level with it), linked by a short dotted
  `tests` edge. Never a "Tests" group, folder, lane or row.

More than ~12 snippets: split it (high-level flow with shapes + a second workspace via an `off-page` shape, or a
grouped region).

## 3. Choose a layout

| Pattern | Use it for | Arrangement |
|---|---|---|
| **Story lanes** (default) | Flows crossing layers or services; features; changes | See below |
| **Pipeline** | Linear flows | Left → right, edges `right` → `left`, wrap after ~4 |
| **Layered** | Architectural layers | One container per layer (folder if it's a directory, else group), stacked or as columns |
| **By folder** | A module or change across directories | One folder per directory, papers in reading order |
| **Flowchart + code** | Logic with decisions | Shapes column on the left, each linked (dotted) to its code on the right |
| **Hub** | "What uses X?" | Central snippet, related ones around it, labeled edges |
| **Sequence** | Service/actor interactions | One column per participant, time going down |
| **Before / after** | Refactors | Two groups side by side, or old behavior as shapes/notes |

Avoid grids sorted by folder or kind: they show *what* exists, not *how it flows*.

### Story lanes

```
                     step 1        step 2         step 3          step 4         step 5
                  ┌─────────────────────────────────────────────────────────────────────┐
 folder project-a │ [actor] ──→ [Button.tsx] ──→ [Dialog.tsx]                           │
                  ├─────────────────────────────────────────────────────────────────────┤
 folder project-b │                                └──→ [router.ts] ──→ [service.ts]    │
                  ├─────────────────────────────────────────────────────────────────────┤
 group External   │                                                      (cloud: Payment API)
                  └─────────────────────────────────────────────────────────────────────┘
```

- **Lanes**: one full-width lane per participant, in call order top → bottom. A lane is a **`folder`** (one per child
  project, or per top-level module in a single project); a `group` only for participants with no single location
  (external systems, a cross-directory domain). Light body tint. All lanes share `x` and width so columns line up.
- **Steps**: one column per step; the paper goes in the lane where the code runs. Column `x` = previous `x` +
  previous width + 100. A call into another layer moves one column right **and** one lane down.
- **Edges** follow the data: same-lane `right` → `left`; cross-lane leave `right`/`bottom`, enter `left`/`top`, with
  `path: "rounded"` or `"step"`. Label with the verb and data (`GET /orders/:id/items`, `returns OrderItem[]`).
  Draw the return as a dashed edge only when it matters.
- **Number** annotations in column order (`1 ·`, `2 ·`…).
- **Supporting items stay by their step**: notes beside their snippet, screenshots above/below their UI step, tests
  (if wanted) beside their subject.
- **Actors / external systems** open and close the story: caller far left of the top lane, database / API far right.
- Longer than ~8 columns: wrap into a second band (repeat lane titles) or split with an `off-page` shape.

## 4. Compute the layout

```
x_next     = x_prev + width_prev + 100
row_y_next = row_y + max_height_in_row + 30 (caption) + 120
```

Children start at `{16, 52}` in a group, `{16, 56}` in a folder (40 between papers); grow the container to fit + 16
padding (+30 for a caption on the last row). Editor sizes and multi-snippet math: `reference/format.md`.

## 5. Write, validate, report

1. Write `.paperworkspace/<Human Readable Name>.workspace` in one go (parents before children, defaults omitted).
2. `node <skill>/scripts/validate.mjs "<file>"`; fix every `ERROR`, judge each `WARN`.
3. Check what the script can't: the story reads left → right; every snippet has a caption; meaningful colors/edge
   styles are in a legend; tests only if wanted.
4. Tell the user the path, how to open it (click it in the Explorer or the **Paper Workspace** panel), a two-line
   summary of the tour, and what the tags and colors mean.

A complete small example: [../examples/login-flow.workspace](../examples/login-flow.workspace) (open only if unsure of
the JSON shape). Notice there: the multi-snippet file is 12 + 640 + 12 = 664 wide, its second editor starts at
40 + 250 + 30 + 16 = 336; the flowchart links to code with dotted arrowless edges; the pink note is attached to its
snippet.
