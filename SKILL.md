---
name: paper-workspace
description: Read, explain, and create Paper Workspace canvases (`.paperworkspace/*.workspace` files). Use when the user asks what a workspace shows or means, wants a workspace/diagram/canvas explained, or asks to explain how a feature, flow, or piece of code works visually — build a workspace that lays out the real code snippets, diagram shapes, notes, and arrows on a canvas.
---

# Paper Workspace

Paper Workspace is a VS Code / Cursor / Windsurf extension that lays code out "like papers on a desk": an infinite
canvas holding **live, editable snippets of real files**, next to diagram shapes, sticky notes, text, images, groups,
and arrows. Each canvas is a JSON file in `.paperworkspace/<Name>.workspace` at the project root. The files are meant
to be committed, so a workspace is documentation that points at the real code.

This skill covers two jobs:

1. **Read**: take a `.workspace` file and explain what it is for, what each part says, and how the parts connect.
2. **Create**: study a feature or workflow in the codebase and write a new `.workspace` that explains it.

Both jobs need the file format, so it comes first.

---

## 1. File format (version 2)

```jsonc
{
  "version": 2,
  "nodes": [ /* boxes and editors; array order = stacking order, parents before children */ ],
  "edges": [ /* arrows between any two nodes */ ]
}
```

### Coordinates

- Units are canvas pixels. `x` grows to the right, `y` grows downward.
- `position` is the node's **top-left corner**. It is **relative to its parent** (a `group` or `file`) when the node
  has a `parent`, and absolute on the canvas otherwise. To get a node's absolute position, add up the positions of the
  node and all its ancestors.
- `width` / `height` are the box size. Minimum 20, maximum 2000.

### Node kinds

Every node has `id` (a unique string), `type`, `position {x, y}`, `width`, `height`, and an optional `parent`.
Readers must skip kinds they don't recognize.

| `type` | What it is | Own fields |
|---|---|---|
| `file` | A paper for one source file. It holds one or more `editor` nodes. | `file` (path), `annotation?`, `title?`, `showTitle?` |
| `editor` | A live code editor over the whole file, scrolled to a **target** line range. It always lives inside a `file`. | `parent` (**required**, the file node id), `target? {start,end}`, `anchor?`, `annotation?`, `title?`, `showTitle?` |
| `group` | A titled, colored area. Any box (file, text, note, shape, media, group) can sit inside it. | `title`, `color?`, `textColor?`, `fontSize?`, `fontWeight?`, `titlePosition?`, `strokeColor?`, `strokeWidth?`, `strokeStyle?`, `annotation?` |
| `shape` | A diagram shape with a label (see the shape list below). | `shape`, `text`, `color?`, `strokeColor?`, `textColor?`, `fontSize?`, `fontWeight?`, `annotation?` |
| `note` | A sticky note, plain text on a colored square. | `text`, `color?` (background, default `#ffec99`), `textColor?`, `fontSize?` (default 14), `fontWeight?` |
| `text` | Free text with no background (titles, headings, labels). | `text`, `color?` (text color), `fontSize?` (default 18), `fontWeight?` |
| `media` | An image or video. | `src` (path, usually `.paperworkspace/media/<workspace>/<name>`), `annotation?` |

Field details:

- **`file` / `src` paths** are relative to the project root (the folder that contains `.paperworkspace/`), with `/`
  separators, for example `src/auth/login.ts`. Absolute paths are allowed but won't work on other machines.
- **`target`** is a 1-based, inclusive line range, like the line numbers in the editor gutter. It marks the lines the
  snippet is *about*: the editor opens scrolled there and highlights them. With no `target`, the editor shows the
  whole file from the top.
- **`anchor`** is the **trimmed text of line `target.start`**. If the file changes, the extension searches for this
  text to move the target to the right lines. Always set it when you set `target`.
- **`annotation`** is a small italic caption drawn centered **below** the box. If it is missing there is no caption;
  `""` shows an empty caption. Text and note nodes don't have annotations.
- **`title`** is the name label above a file or editor's top-left corner (it stays readable when zoomed out). If it is
  missing, a file shows its base name (`login.ts`) and an editor the trimmed text of its first `target` line (the base
  name without a target). **`showTitle`** turns the label on or off; it is on by default for both
  kinds, so only write `"showTitle": false` to hide one.
- **`text`** in shapes, notes, and text nodes is plain text. `\n` makes a new line, and there is no Markdown.
- **Colors** are always `#rrggbb`. A shape's `color` can also be `"none"` (outline only). Invalid colors are ignored.
- **`fontWeight`** is 100–900 (400 regular, 600 semibold, 700 bold). **`fontSize`** is 6–200.

### File nodes and their editors (the core concept)

A `file` node is the paper for one source file. The code itself is shown by its `editor` children. There are two
layouts, and the extension enforces them when it loads the file:

**One snippet (combined node).** The file header and the editor render as a single box. The file's size is what
counts, and the editor fills it below the 40px header:

```
editor.position = { x: 0, y: 40 }
editor.width    = file.width
editor.height   = file.height - 40
```

In this layout the **file's** `annotation` is shown, not the editor's.

**Several snippets (group layout).** The file becomes a padded container, and each editor can be moved on its own.
The editors are stacked vertically:

```
first editor:   { x: 12, y: 40 }
next editor:    y = previous.y + previous.height + (previous has annotation ? 30 : 0) + 16
file.width  >=  max(editor.x + editor.width) + 12            (at least 640 + 24)
file.height >=  max(editor.y + editor.height + annotation space) + 12
```

Here each **editor's** `annotation` captions its snippet. Use this layout to show several parts of the same file, such
as a function and the helper it calls. Don't create two `file` nodes for the same path.

A good height for an editor that shows `n` target lines is `30 + (n + 2) * 19 + 8`, clamped to 150–560. The default
editor width is 640. 520–720 works well for code.

### Groups

A group has a 36px title bar and 16px of padding, so its first child usually sits at `{ x: 16, y: 52 }`. The group
must be big enough to hold its children: `width >= child.x + child.width + 16` and
`height >= child.y + child.height + 16`, plus 30 more if the child has an annotation. Groups can be nested.

The title can be styled: `textColor`, `fontSize` (default 14) and `fontWeight` (default 600), and `titlePosition`
places it at `top-left` (default), `top-center`, `top-right`, `bottom-left`, `bottom-center` or `bottom-right`. A
title bigger than 14px makes the bar taller: `max(36, ceil(fontSize × 1.25) + 18)`. A bottom title bar takes that
room at the bottom instead, so children can start at `y: 16`.

The border can be styled too: `strokeColor` (default: a shade of the background), `strokeWidth` in px (default 1.5)
and `strokeStyle`: `solid` (default), `dashed`, `dotted` or `none`.

### Edges (arrows)

```jsonc
{
  "id": "l1",
  "source": "<node id>",            // any node: file, editor, shape, note, text, group, media
  "target": "<node id>",
  "sourceSide": "right",            // top | right | bottom | left; if omitted, picked from the layout
  "targetSide": "left",
  "path": "curve",                  // curve (default) | straight | step | rounded
  "color": "#27405f",               // default: canvas text color
  "width": 2,                       // px, default 2
  "dash": "solid",                  // solid (default) | dashed | dotted
  "startMarker": "none",            // none (default) | arrow | open-arrow | circle | diamond
  "endMarker": "arrow",             // arrow is the default
  "label": "calls",                 // optional text on the line; long labels wrap, "\n" breaks a line
  "labelColor": "#...", "fontSize": 14, "fontWeight": 600,
  "labelBackground": "#ffec99"      // box behind the label; "none" = transparent; default: canvas background
}
```

Edges can point at a specific **editor** (snippet) or at the whole **file** node. When a file has several snippets,
point at the editor so the arrow lands on the exact code.

### Shape ids

Unknown ids render as a rectangle. Default sizes are in parentheses.

- **General**: `rectangle` (160×80), `rounded`, `square`, `ellipse`, `circle`, `diamond` (140×100), `parallelogram`,
  `hexagon`, `triangle`, `triangle-right`, `pentagon`, `octagon`, `star`, `plus`, `trapezoid`, `cylinder` (90×110),
  `cloud`, `document`, `multi-document`, `note-shape`, `card`, `callout`, `callout-rounded`, `cube`, `tape`,
  `actor` (50×90, label drawn below it).
- **Flowchart**: `terminator` (start/end pill, 160×60), `rectangle` (process), `diamond` (decision), `parallelogram`
  (input/output data), `predefined-process` (subroutine or call into another module), `document`, `multi-document`,
  `cylinder` (database), `internal-storage` (memory/cache), `manual-input`, `manual-operation`, `hexagon`
  (preparation/setup), `delay` (wait/timer), `stored-data`, `display` (UI output), `loop-limit`, `off-page` (continues
  elsewhere), `connector` (60×60 circle), `merge`, `sort`, `collate`, `or`, `summing-junction`,
  `annotation` (bracket-style comment).
- **Arrows (block shapes)**: `arrow-right`, `arrow-left`, `arrow-up`, `arrow-down`, `arrow-double`,
  `arrow-double-vertical`, `chevron` (pipeline step), `pentagon-arrow`.

Shape defaults: white fill (`#ffffff`), dark grey outline (`#2b2f36`), 14px label.

### Built-in palette

These are the swatches the UI offers. Use them so your workspaces match ones people make by hand.

- Dark (lines, text, strong accents): `#2b2f36` `#3d4450` `#6b2f2f` `#6e4428` `#6b5a24` `#2d5236` `#27405f` `#46315f`
- Light (fills, group backgrounds, notes): `#ffffff` `#e5e5e5` `#ffc9c9` `#ffd6a5` `#ffec99` `#b2f2bb` `#c5e3ff` `#e5dbff`

The canvas background is light grey (`#e4e5e8`) by default.

---

## 2. Reading and explaining a workspace

Follow these steps when the user asks what a workspace shows, or asks you to explain one.

1. **Find it.** Workspaces are in `.paperworkspace/*.workspace` at the project root. If there are several and the user
   didn't say which one, list them by name.
2. **Parse the JSON and build the tree.** Index nodes by `id`, group children under their `parent`, and put each
   `editor` under its `file`. Compute absolute positions when layout matters (for example, to tell which side of the
   canvas something is on).
3. **Resolve every snippet against the real code.** For each editor, open `file` and read lines
   `target.start–target.end`, plus a few lines around them. Check that line `target.start` still matches `anchor`. If
   it doesn't, find the anchor text nearest the old line, as the extension would, and mention that the target has
   drifted. **The code is the content of the workspace. Don't explain a snippet from its file name alone.**
4. **Recover the intent.** Look for these clues, roughly in this order:
   - Big `text` nodes (large `fontSize` or bold) near the top-left usually hold the title and the question the
     workspace answers.
   - `group` titles name the areas or layers (for example "Client", "API", "Database").
   - `note`s are the author's explanations, warnings, and open questions.
   - `annotation`s caption individual snippets and shapes. They often say *why* the snippet matters.
   - Edge labels name the relationships (such as "calls", "emits", "reads", "on error").
5. **Read the diagram notation.**
   - Arrow direction is flow or dependency: from `source` to `target`, unless the markers say otherwise
     (`startMarker` arrows mean both ways).
   - Dash style carries meaning. A common convention is **solid** for direct calls or control flow, **dashed** for
     async work, events, or return values, and **dotted** for "related" or "see also". Say what the workspace itself
     seems to use rather than assuming.
   - Line and fill colors usually encode categories. Infer the legend from how they are used, or from a legend node if
     there is one.
   - Shapes follow flowchart meaning: `terminator` is start/end, `diamond` is a decision (its outgoing edge labels are
     the branches), `cylinder` is storage, `parallelogram` is data in or out, `actor` is a user or external system,
     `cloud` is an external service, and `predefined-process` is a call into another module.
   - Layout usually encodes order. Flows read left to right or top to bottom, and nearby things are related.
6. **Walk the graph.** Find the entry points (nodes with no incoming edges, `terminator`s, or `actor`s) and follow the
   edges. That order is the story the author is telling.
7. **Explain it** in this order:
   - **Purpose**, in one or two sentences: what question the workspace answers.
   - **Map**: the areas or groups and what each one holds.
   - **Walkthrough**: the flow step by step, citing real code (`path:line`) and saying what each snippet does in that
     step.
   - **Notation**: what the colors, dashes, and shapes mean here, if it isn't obvious.
   - **Gaps**: stale targets, files that no longer exist, dangling ideas in notes, or steps the diagram skips that you
     can see in the code.

If the user asks a follow-up about one node, answer from the code at its target, not only from its label.

---

## 3. Creating a workspace that explains a feature or workflow

The goal is a canvas someone can read in a couple of minutes without anyone explaining it. Treat it as a guided tour
of the real code, not a dump of files.

### Step 1: Research the code first

- Find the **entry point** (route, command handler, UI event, CLI command, job, or message consumer) and trace the
  flow to its **outcomes** (response, stored data, emitted event, rendered UI).
- For each step, record the file, the exact line range of the relevant function or block, and the text of its first
  line (for `anchor`). Read the lines themselves. Don't guess line numbers.
- Note the branches (validation failure, cache hit or miss, error paths), async boundaries (queues, events,
  callbacks), and external systems (databases, third-party APIs).

### Step 2: Plan the story before the layout

Write a short outline:

- **Title**: the question being answered, for example "How a password reset works".
- **Steps**: usually 4–10. For each one, the snippet, a one-line caption, and what connects it to the next step.
- **Supporting context**: data models, config, key types. These go to the side, not in the main path.
- **Legend**: only if you use more than one edge style or color category.

Keep it focused. Each snippet should earn its place. If a flow needs more than about 12 snippets, split it: show the
high-level flow with shapes, and put the detail in a second workspace (use an `off-page` shape to point to it), or in
a grouped region.

### Step 3: Choose a layout pattern

| Pattern | Use it for | Arrangement |
|---|---|---|
| **Pipeline** | Linear request/processing flows | Snippets left → right in reading order, edges `right` → `left`. Wrap to a new row below after about 4 snippets. |
| **Layered** | Flows that cross architectural layers | One `group` per layer (UI / API / domain / storage) stacked top → bottom or placed as columns. Edges cross between layers. |
| **Flowchart + code** | Logic with decisions | A column of shapes (`terminator` → `rectangle` → `diamond`…) on the left. Each shape links with a dotted edge to the snippet that implements it on the right. |
| **Hub** | "What uses X?" and module overviews | The central snippet in the middle, related snippets around it, edges labeled with the relationship. |
| **Sequence** | Interactions between services or actors | One column per participant (`actor`/`cloud`/group), time going down, labeled horizontal edges between columns. |

### Step 4: Visual conventions

Use these unless the project already has its own style (check existing workspaces first and match them):

- **Title**: a `text` node at the top-left, `fontSize` 32–40, `fontWeight` 700. Below it, an optional subtitle
  `text` (16–18, color `#3d4450`) that says what the canvas covers and where to start.
- **Captions**: give every snippet an `annotation` that states its role in one short phrase, for example
  "1 · Validates the token". Numbering the steps makes the reading order obvious.
- **Notes** (`note`, default yellow `#ffec99`) are for explanations that don't fit a caption: why the code is built
  this way, gotchas, invariants. Use pink `#ffc9c9` for warnings and known bugs, and blue `#c5e3ff` for "good to know".
  Keep each note to 1–4 short lines, sized about 220–280 wide.
- **Groups** tint areas with the light palette, one color per layer or subsystem (for example blue `#c5e3ff` for the
  client, green `#b2f2bb` for the server, purple `#e5dbff` for storage). Use the same color for the same concept on
  every workspace you create.
- **Edges**:
  - Solid: direct call or control flow.
  - Dashed: async, event, callback, or return value.
  - Dotted, no arrowhead (`endMarker: "none"`): "implemented by" or "see also", such as a flowchart shape linking to
    its code.
  - Label edges with a verb ("calls", "emits `user.created`", "on 401", "yes" / "no"), and label every edge that
    leaves a decision.
  - Use `path: "rounded"` or `"step"` in tidy grid layouts, and `"curve"` for free-form layouts.
  - Set `sourceSide`/`targetSide` so the arrows follow the reading direction.
- **Spacing**: leave about 80–120px between boxes in a row and 100–160px between rows, so labels and captions have
  room. Captions take about 30px below a box. Don't overlap boxes unless one is inside a group.
- **Size to the content**: size editors to their target (see the height formula in section 1), and use 520–720 for
  the width. A snippet of 5–40 lines reads best. Point at a function body, not a whole file.

### Step 5: Compute the layout

Work out coordinates deliberately instead of guessing. For a row-based layout:

```
x_next = x_prev + width_prev + GAP_X          (GAP_X ≈ 100)
row_y_next = row_y + max_height_in_row + caption(30) + GAP_Y   (GAP_Y ≈ 120)
```

For children inside a group, start at `{16, 52}` and grow the group to fit them, plus 16px padding (and 30px for a
caption on the last row).

Use readable, unique ids so the edges are easy to check, such as `title`, `g_api`, `f_router`, `e_router_login`,
`s_decide`, `n_why_retry`, `l_router_to_service`. For a file with one snippet, use a matching pair such as
`f_x` / `e_x`.

### Step 6: Write the file

- Path: `.paperworkspace/<Human Readable Name>.workspace`. Create `.paperworkspace/` if it doesn't exist. Leave out
  these characters from the name: `< > : " / \ | ? *`. Don't overwrite an existing workspace unless the user asks.
- Order the nodes so **every parent comes before its children**. Within a parent, later nodes draw on top.
- Pretty-print with 2-space indentation. Leave out fields that are default or unset, so the file stays small and
  diffs stay readable. Round coordinates to integers.

### Step 7: Validate before you finish

Check every item on this list:

- [ ] The JSON parses. `version` is `2`. `nodes` and `edges` are arrays.
- [ ] Every `id` is unique across nodes, and edge ids are unique across edges.
- [ ] Every `parent` refers to an existing node. Editors' parents are `file` nodes, and every other box's parent is a
      `group`. There are no cycles.
- [ ] Every `file` path exists relative to the project root, and every file node has at least one editor.
- [ ] Every `target` is within the file's line count, and `anchor` equals the trimmed text of line `target.start`.
- [ ] Single-editor files: the editor is at `{0, 40}`, width equals the file width, and height is the file height
      minus 40. Multi-editor files: the editors fit inside the file with the padding described above.
- [ ] Children fit inside their groups, and top-level boxes don't overlap.
- [ ] Every edge `source`/`target` refers to an existing node id. Edges pointing at missing ids are silently dropped.
- [ ] Colors are `#rrggbb` (or `"none"` for a shape fill), and shape ids come from the list in section 1.

Then tell the user the file path and how to open it: click it in the Explorer, or open it from the **Paper
Workspace** activity-bar panel. Give a two-line summary of the tour the canvas presents. If the workspace is already
open, the canvas reloads from the saved file.

---

## 4. Complete example

This example shows a login flow: a decision flowchart on the left, the real code on the right, a service file with two
snippets, and a note.

```json
{
  "version": 2,
  "nodes": [
    { "id": "title", "type": "text", "text": "How login works", "fontSize": 36, "fontWeight": 700,
      "position": { "x": 0, "y": 0 }, "width": 520, "height": 50 },
    { "id": "subtitle", "type": "text", "text": "From the POST /login route to a session cookie. Start at the top left.",
      "color": "#3d4450", "fontSize": 16, "position": { "x": 0, "y": 56 }, "width": 720, "height": 28 },

    { "id": "g_flow", "type": "group", "title": "Flow", "color": "#e5e5e5",
      "position": { "x": 0, "y": 120 }, "width": 232, "height": 520 },
    { "id": "s_start", "type": "shape", "parent": "g_flow", "shape": "terminator", "text": "POST /login",
      "position": { "x": 16, "y": 52 }, "width": 200, "height": 60 },
    { "id": "s_valid", "type": "shape", "parent": "g_flow", "shape": "diamond", "text": "Password\nvalid?",
      "color": "#ffec99", "position": { "x": 31, "y": 172 }, "width": 170, "height": 110 },
    { "id": "s_session", "type": "shape", "parent": "g_flow", "shape": "rectangle", "text": "Create session",
      "position": { "x": 16, "y": 342 }, "width": 200, "height": 70 },
    { "id": "s_db", "type": "shape", "parent": "g_flow", "shape": "cylinder", "text": "sessions",
      "color": "#e5dbff", "position": { "x": 71, "y": 432 }, "width": 90, "height": 70 },

    { "id": "f_route", "type": "file", "file": "src/routes/auth.ts",
      "annotation": "1 · Route parses the body and delegates",
      "position": { "x": 340, "y": 120 }, "width": 640, "height": 260 },
    { "id": "e_route", "type": "editor", "parent": "f_route", "target": { "start": 14, "end": 26 },
      "anchor": "router.post('/login', async (req, res) => {",
      "position": { "x": 0, "y": 40 }, "width": 640, "height": 220 },

    { "id": "f_service", "type": "file", "file": "src/services/authService.ts",
      "position": { "x": 1080, "y": 120 }, "width": 664, "height": 576 },
    { "id": "e_verify", "type": "editor", "parent": "f_service", "target": { "start": 31, "end": 44 },
      "anchor": "export async function verifyPassword(email: string, password: string) {",
      "annotation": "2 · Compares the bcrypt hash",
      "position": { "x": 12, "y": 40 }, "width": 640, "height": 250 },
    { "id": "e_session", "type": "editor", "parent": "f_service", "target": { "start": 60, "end": 72 },
      "anchor": "export async function createSession(userId: string) {",
      "annotation": "3 · Stores the session and returns its id",
      "position": { "x": 12, "y": 336 }, "width": 640, "height": 198 },

    { "id": "n_timing", "type": "note", "color": "#ffc9c9",
      "text": "Unknown emails still run bcrypt,\nso response time doesn't reveal\nwhich accounts exist.",
      "position": { "x": 340, "y": 460 }, "width": 260, "height": 140 }
  ],
  "edges": [
    { "id": "l1", "source": "s_start", "sourceSide": "bottom", "target": "s_valid", "targetSide": "top" },
    { "id": "l2", "source": "s_valid", "sourceSide": "bottom", "target": "s_session", "targetSide": "top", "label": "yes" },
    { "id": "l3", "source": "s_session", "sourceSide": "bottom", "target": "s_db", "targetSide": "top", "dash": "dashed", "label": "writes" },
    { "id": "l4", "source": "s_start", "sourceSide": "right", "target": "f_route", "targetSide": "left", "dash": "dotted", "endMarker": "none" },
    { "id": "l5", "source": "e_route", "sourceSide": "right", "target": "e_verify", "targetSide": "left", "label": "calls" },
    { "id": "l6", "source": "e_route", "sourceSide": "right", "target": "e_session", "targetSide": "left", "label": "then calls", "path": "rounded" },
    { "id": "l7", "source": "n_timing", "sourceSide": "right", "target": "e_verify", "targetSide": "left", "dash": "dotted", "endMarker": "none", "color": "#6b2f2f" }
  ]
}
```

Things to notice:

- The multi-snippet file `f_service` is 12 + 640 + 12 = 664 wide. The second editor starts at 40 + 250 + 30 (caption)
  + 16 = 336, and the file height is 336 + 198 + 30 + 12 = 576.
- The group holds its shapes starting at `{16, 52}`, and all positions inside it are relative to the group.
- The flowchart links to its code with dotted, arrowless edges, while the code-to-code edges use solid "calls" arrows.

In a real workspace, every `target` and `anchor` must come from reading the actual file.

---

## 5. Quick reference

- Location: `.paperworkspace/*.workspace` (JSON, version 2).
- File header 40px. File padding 12. Gap between snippets 16. Caption space 30. Group header 36. Group padding 16.
- Default sizes: editor 640×380, text 240×40, note 220×220, group 480×320, shape 160×80, media up to 480.
- Editor height for `n` target lines: `30 + (n+2)*19 + 8`, clamped to 150–560.
- Edge defaults: `curve`, 2px, `solid`, no start marker, `arrow` end marker.
- Array order is stacking order. Parents come before children.
