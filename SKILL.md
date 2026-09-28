---
name: paper-workspace
description: Read, explain, and create Paper Workspace canvases (`.paperworkspace/*.workspace` files), and resolve `paperworkspace:` references the user pastes. Use when the user asks what a workspace shows or means, pastes a `paperworkspace:...#type/id` reference to one of its items, wants a workspace/diagram/canvas explained, asks to explain how a feature, flow, or piece of code works visually, or asks for a canvas of changed code (current branch, session work, a feature, fix, PR, or code review; see workflows/code-change-canvas.md) — build a canvas that lays out the real code snippets, folders, diagram shapes, sticky notes, tags, colors, and arrows so the story reads at a glance.
---

# Paper Workspace

Paper Workspace is a VS Code / Cursor / Windsurf extension that lays code out "like papers on a desk": an infinite
canvas holding **live, editable snippets of real files**, next to project folders, diagram shapes, sticky notes, text,
images, groups, and arrows. Each canvas is a JSON file in `.paperworkspace/<Name>.workspace` at the project root. The
files are meant to be committed, so a workspace is documentation that points at the real code.

This skill covers three jobs:

1. **Read**: take a `.workspace` file and explain what it is for, what each part says, and how the parts connect.
2. **Resolve a reference**: the user pasted `paperworkspace:<workspace>#<type>/<id>`; find that item and act on it.
3. **Create**: study a feature, a flow, or a change that was just made, and write a `.workspace` that explains it.

All three need the mental model (section 1) and the file format (section 2), so they come first.

### Workflow files

This file is the foundation: what a workspace is, the format, and the general rules for reading and building one. The
[`workflows/`](workflows/) folder next to it holds **workflow files**: recipes for specific kinds of canvas, with
conventions (tag names, colors, what to include) that teams are expected to customize.

| Workflow file | Read it when the user asks for… |
|---|---|
| [`workflows/code-change-canvas.md`](workflows/code-change-canvas.md) | A canvas of code that changed: the current branch, this session's work, a feature, fix or PR, or a code review |

When a request matches a workflow file, **read that file before planning the canvas** and follow it. Its conventions
override the defaults in section 5; everything else in this file (format, layout math, references, validation) still
applies. If the project has other files in `workflows/`, check their titles too.

---

## 1. Mental model: a workspace describes a workflow

A workspace is **not a pile of files**. It is an argument or a tour: "this is how X works" or "this is what changed
and why". Every element has a job in that story, and the author chose each element *because of* its job. When you
read a canvas, recover those jobs. When you build one, pick each element for its job.

### What each element means

| Element | Its job in the story | Read it as | Use it for |
|---|---|---|---|
| **`text`** (large, bold) | Title, headings | "The question this canvas / area answers" | One title at the top-left; optional section headings |
| **`file` + `editor`** | Evidence: the real code | "This is where it happens" | A step of the flow; the editor's `target` is the exact lines that matter |
| **`folder`** | Scope in the project tree | "These papers live in / belong to this directory" | Grouping papers by module or package, e.g. everything a feature touched in `src/auth` |
| **`group`** | A concept area (not tied to a path) | "These belong together: a layer, a phase, a subsystem, a legend" | Layers (UI / API / DB), phases (Before / After), a legend |
| **`note`** (sticky note) | The author's voice | "Why", gotchas, decisions, open questions, TODOs | Anything a caption can't say in one phrase |
| **`annotation`** (caption below a box) | A label for one box | "The role of this one thing", often a numbered step | Every snippet: `1 · Validates the token` |
| **`tags`** (chips on files, editors, folders) | Categories that cut across the layout | "This paper is a *New* / *Entry point* / *Test* / *Risk*" | Status and role, so the reader can scan for a category anywhere on the canvas |
| **`headerColor`** (title bar color) | Fast, pre-attentive category | "Same color = same kind" (e.g. green = new, orange = modified) | Encoding one dimension, usually change status; always explain it in a legend |
| **`color`** (body of a folder, group, or multi-snippet file) | Area tint | "This region is layer/subsystem X" | One tint per layer or subsystem, consistent across the canvas |
| **`shape`** | Abstract step or thing without code | Flowchart meaning (decision, storage, actor, external service…) | The high-level flow, external systems, deleted files, things with no code to show |
| **edge** | Relationship | "calls", "emits", "reads", "on error", "implemented by", "see also" | Every meaningful connection; the label is the verb |
| **`media`** | Screenshot or recording | "What the user sees" / the visible result | UI results, before/after screenshots, architecture images |
| **`locked`** | Reference material | "Don't edit this; it's the baseline" | Only when the user asks |

### Relationships between elements

Meaning comes from **how elements relate**, not only from each one alone. There are four kinds of relationship:

1. **Containment** (`parent`): a box inside a group or folder *belongs to its scope*.
   - A **note inside a group or folder** comments on that whole area ("Everything here runs in the worker process").
     A note on the open canvas is either global (near the title) or attached to something nearby.
   - A **file inside a folder** is a file of that directory (its path should start with the folder's path).
   - An **editor inside a file** is one part of that file; several editors = several parts of the same file that
     matter to the story (e.g. a function and the helper it calls).
   - Nested groups/folders refine scope: `Server` → `Auth module`.
2. **Edges**: explicit relationships. Direction is flow or dependency (source → target). Dash style and color carry
   meaning (see 5.4). An edge from a note to a snippet, dotted and without an arrowhead, *attaches* the comment to
   that code.
3. **Shared tags / shared colors**: papers with the same tag or the same title bar color are in the same category,
   wherever they sit on the canvas. This is how a canvas says "these 4 files are new in this PR" without moving
   them out of their flow position.
4. **Proximity and order**: nearby boxes are related, and flows read left → right or top → bottom. Numbered
   annotations (`1 ·`, `2 ·`…) make the reading order explicit.

Layout encodes the *structure* (flow, layers); tags and colors encode *categories* that cut across it; notes and
annotations carry the *reasoning*; edges carry the *relationships*. A good canvas uses each channel for one purpose.

---

## 2. File format (version 2)

```jsonc
{
  "version": 2,
  "tags": [ /* optional: this workspace's tags, e.g. { "id": "t_new", "label": "New", "color": "#b6d7a8" } */ ],
  "tagPlacement": "top",   // optional: right (default) | bottom | left | top
  "nodes": [ /* boxes and editors; array order = stacking order, parents before children */ ],
  "edges": [ /* arrows between any two nodes */ ]
}
```

### Coordinates

- Units are canvas pixels. `x` grows to the right, `y` grows downward.
- `position` is the node's **top-left corner**. It is **relative to its parent** (a `group`, `folder` or `file`) when
  the node has a `parent`, and absolute on the canvas otherwise. To get a node's absolute position, add up the
  positions of the node and all its ancestors.
- `width` / `height` are the box size. Minimum 20, maximum 2000.

### Node kinds

Every node has `id` (a unique string), `type`, `position {x, y}`, `width`, `height`, and an optional `parent`.
Readers must skip kinds they don't recognize.

| `type` | What it is | Own fields |
|---|---|---|
| `file` | A paper for one source file. It holds one or more `editor` nodes. | `file` (path), `annotation?`, `title?`, `showTitle?`, `headerColor?`, `color?`, `tags?`, `locked?` |
| `editor` | A live code editor over the whole file, scrolled to a **target** line range. It always lives inside a `file`. | `parent` (**required**, the file node id), `target? {start,end}`, `anchor?`, `annotation?`, `title?`, `showTitle?`, `headerColor?`, `tags?`, `locked?` |
| `folder` | A project directory: a container like a group, with a file-like title bar. | `folder` (path, `""` = project root), `annotation?`, `title?`, `showTitle?`, `headerColor?`, `color?`, `tags?`, `locked?` |
| `group` | A titled, colored area for a concept. Any box can sit inside it. | `title`, `color?`, `textColor?`, `fontSize?`, `fontWeight?`, `titlePosition?`, `strokeColor?`, `strokeWidth?`, `strokeStyle?`, `annotation?`, `locked?` |
| `shape` | A diagram shape with a label (see the shape list below). | `shape`, `text`, `color?`, `strokeColor?`, `textColor?`, `fontSize?`, `fontWeight?`, `annotation?` |
| `note` | A sticky note, plain text on a colored square. | `text`, `color?` (background, default `#ffec99`), `textColor?`, `fontSize?` (default 14), `fontWeight?` |
| `text` | Free text with no background (titles, headings, labels). | `text`, `color?` (text color), `fontSize?` (default 18), `fontWeight?` |
| `media` | An image or video. | `src` (path, usually `.paperworkspace/media/<workspace>/<name>`), `annotation?` |

Which boxes can contain which:

- `group` and `folder` can contain any box (`file`, `folder`, `group`, `note`, `text`, `shape`, `media`).
- `file` contains only `editor`s. **A note cannot sit inside a file**; put it next to the file (or inside the file's
  folder/group) and attach it with an edge.

Field details:

- **`file` / `folder` / `src` paths** are relative to the project root (the folder that contains `.paperworkspace/`),
  with `/` separators, for example `src/auth/login.ts` or `src/auth`. Absolute paths are allowed but won't work on
  other machines.
- **`target`** is a 1-based, inclusive line range, like the line numbers in the editor gutter. It marks the lines the
  snippet is *about*: the editor opens scrolled there and **highlights** them. This is how you highlight the
  important piece of code. With no `target`, the editor shows the whole file from the top, with nothing highlighted.
- **`anchor`** is the **trimmed text of line `target.start`**. If the file changes, the extension searches for this
  text to move the target to the right lines. Always set it when you set `target`.
- **`annotation`** is a small italic caption drawn centered **below** the box. If it is missing there is no caption;
  `""` shows an empty caption. Text and note nodes don't have annotations.
- **`title`** is the name label above a file, editor or folder's top-left corner (it stays readable when zoomed out).
  If it is missing, a file shows its base name (`login.ts`), a folder its base name, and an editor the trimmed text
  of its first `target` line (the base name without a target). **`showTitle`** turns the label on or off; it is on by
  default, so only write `"showTitle": false` to hide one. Set a `title` when the base name alone is ambiguous or
  when a short role reads better ("Login route").
- **`headerColor`** (`#rrggbb`) colors the title bar of a file, editor or folder (the header with the path and
  buttons). Leave it out for the theme's default. The header text switches to dark or light to stay readable. Use
  the light palette (section 2, *Built-in palette*) so the path stays legible.
- **`color`** on a `folder`, or on a `file` with **several** snippets, tints the body around its content. A
  single-snippet file has no visible body, so its `color` has no effect.
- **`tags`** on a file, editor or folder is a list of ids from the top-level `tags` array; each is drawn as a colored
  chip beside the paper. Tags belong to the workspace: define each once (`id`, `label` up to 40 characters, `color`;
  labels are unique ignoring case) and refer to it from any number of papers. Undefined ids are dropped. A tag
  definition can exist without any paper using it. **A file with a single editor shows the file's tags** (the
  editor's join them), like its annotation, so put tags on the `file` in that case. Groups, notes, shapes, text and
  media cannot carry tags.
- **`tagPlacement`** (top level) says where chips are drawn: `"right"` (default, beside the paper), `"bottom"`,
  `"left"`, or `"top"` (on the title row, at the top-right corner). Use `"top"` when papers sit close together (for
  example side by side in a folder), so chips don't fall into the gap between them. **`"showTags": false`** hides
  every chip without removing any tag (omit it to show them).
- **`locked`** (`true`, on a file, editor, folder or group) protects it from accidental changes on the canvas: it can't
  be moved, resized, renamed, recolored, re-tagged or deleted, and its code is read-only. Everything inside it is
  locked with it. A lock icon is drawn before its title. Leave it out unless the user asks for a locked paper.
- **`customColors`** (top level, optional) is the color picker's "Custom" row for this workspace: `#rrggbb` values,
  oldest first. It has no effect on how anything is drawn, so leave it out when writing a workspace.
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

In this layout the **file's** `annotation`, `tags`, `headerColor` and lock are shown, not the editor's.

**Several snippets (group layout).** The file becomes a padded container, and each editor can be moved on its own.
The editors are stacked vertically:

```
first editor:   { x: 12, y: 40 }
next editor:    y = previous.y + previous.height + (previous has annotation ? 30 : 0) + 16
file.width  >=  max(editor.x + editor.width) + 12            (at least 640 + 24)
file.height >=  max(editor.y + editor.height + annotation space) + 12
```

Here each **editor's** `annotation`, `tags` and `headerColor` apply to its snippet, and the file's apply to the whole
paper. Use this layout to show several parts of the same file, such as a function and the helper it calls, or the
several hunks a change touched. Don't create two `file` nodes for the same path.

A good height for an editor that shows `n` target lines is `30 + (n + 2) * 19 + 8`, clamped to 150–560. The default
editor width is 640. 520–720 works well for code.

### Folders

A folder node has a 40px title bar (like a file) and 16px of padding, so its first child sits at `{ x: 16, y: 56 }`.
Papers placed side by side in a folder are 40px apart. The folder must be big enough to hold its children:
`width >= child.x + child.width + 16` and `height >= child.y + child.height + 16`, plus 30 more if the child has an
annotation. A file inside a folder should be a file of that directory (its path starts with `<folder>/`); when the
user adds a file from the canvas, the extension puts it in the deepest folder that contains it. The same directory
appears in at most one folder node.

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
  "source": "<node id>",            // any node: file, editor, folder, shape, note, text, group, media
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
- Light (fills, group backgrounds, notes, title bars): `#ffffff` `#e5e5e5` `#ffc9c9` `#ffd6a5` `#ffec99` `#b2f2bb`
  `#c5e3ff` `#e5dbff`
- New tags take these colors in turn (soft, readable with dark text): `#dd7e6b` `#ea9999` `#f9cb9c` `#ffe599`
  `#b6d7a8` `#a2c4c9` `#a4c2f4` `#9fc5e8` `#b4a7d6` `#d5a6bd`

The canvas background is light grey (`#e4e5e8`) by default.

---

## 3. References to a workspace or an item

On the canvas, right-click any item → **Copy reference** (or the empty canvas → **Copy workspace reference**). The
user then pastes it into the chat. The format is:

```
paperworkspace:<workspace path>                   the whole workspace
paperworkspace:<workspace path>#<type>/<node id>  one item
```

- `<workspace path>` is the `.workspace` file relative to the project root, e.g. `.paperworkspace/How login works.workspace`
  (it may contain spaces; it ends at the **last** `#`).
- `<type>` is the node's `type` (`file`, `editor`, `folder`, `group`, `note`, `text`, `shape`, `media`).
- `<node id>` is the node's `id` in that file.

Example: `paperworkspace:.paperworkspace/How login works.workspace#editor/e_verify`.

**When the user pastes one, resolve it before answering:**

1. Open the workspace file and find the node whose `id` matches. If its `type` differs from the reference, trust the
   `id` and mention the mismatch. If the id is gone, say so (it was deleted or the workspace was rewritten) and offer
   the closest candidates by title/annotation.
2. Gather what the item *is*, based on its type:
   - `editor`: its parent `file` path and `target`; read those lines from the real file (re-find them by `anchor` if
     they drifted). This is the code the user means.
   - `file`: the path; if it has one editor, that editor's target is the part the user means; if several, all of
     them.
   - `folder`: the directory and the papers inside it.
   - `group`: its title and everything inside it.
   - `note` / `text` / `shape`: its text; plus what it is attached to (edges) and what contains it (`parent`).
   - `media`: the file at `src` (look at it if you can read images).
3. Gather its context: its `annotation`, `title`, tags (resolved to labels), `headerColor` meaning (from the legend),
   container chain, and incoming/outgoing edges with labels.
4. Then do what the user asked ("fix this", "explain this", "why is this here?") about **that** item, citing
   `path:line`. Don't re-explain the whole workspace unless asked.

When you write about items of a workspace (in chat, a PR description, or a note), you can give their references in
this same format so the user can find them.

---

## 4. Reading and explaining a workspace

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
   - `group` and `folder` titles name the areas: layers, phases, modules.
   - `note`s are the author's explanations, warnings, decisions, and open questions. A note **inside** a group or
     folder is about that area; a note linked by an edge is about the linked item.
   - `annotation`s caption individual boxes. They often say *why* the thing matters and give the step number.
   - Tags: list the workspace's tags and which papers carry each one. A tag used on several papers is a category the
     author wanted to be scannable ("New", "Entry point", "Needs review").
   - Edge labels name the relationships ("calls", "emits", "reads", "on error").
5. **Decode the visual encoding.**
   - Title bar colors (`headerColor`) and body colors (`color`): group papers by color and find what they share (all
     the green ones are new files, all the amber ones were modified…). Prefer an explicit legend (a group titled
     "Legend", or notes/shapes/tags that name the colors) over your own inference, and say when you are inferring.
   - Arrow direction is flow or dependency: from `source` to `target`, unless the markers say otherwise
     (`startMarker` arrows mean both ways).
   - Dash style: a common convention is **solid** for direct calls or control flow, **dashed** for async work, events,
     or return values, and **dotted** for "related", "implemented by" or "see also". Say what the workspace itself
     seems to use rather than assuming.
   - Shapes follow flowchart meaning: `terminator` is start/end, `diamond` is a decision (its outgoing edge labels are
     the branches), `cylinder` is storage, `parallelogram` is data in or out, `actor` is a user or external system,
     `cloud` is an external service, and `predefined-process` is a call into another module.
   - Layout usually encodes order. Flows read left to right or top to bottom, and nearby things are related.
6. **Walk the graph.** Find the entry points (an "Entry point" tag, nodes with no incoming edges, `terminator`s,
   `actor`s, or annotation `1 ·`) and follow the edges and the step numbers. That order is the story.
7. **Explain it** in this order:
   - **Purpose**, in one or two sentences: what question the workspace answers, or what change it documents.
   - **Map**: the areas (groups, folders) and what each one holds.
   - **Walkthrough**: the flow step by step, citing real code (`path:line`) and saying what each snippet does in that
     step, and what its tags/colors say about it.
   - **Notation**: what the tags, colors, dashes, and shapes mean here, if it isn't obvious.
   - **Gaps**: stale targets, files that no longer exist, tags defined but unused, colors without a legend, dangling
     ideas in notes, or steps the diagram skips that you can see in the code.

If the user asks a follow-up about one node, answer from the code at its target, not only from its label.

---

## 5. Creating a workspace

The goal is a canvas someone can read in a couple of minutes without anyone explaining it. Treat it as a guided tour
of the real code, not a dump of files. Every paper, note, tag and color should earn its place.

### 5.1 Research the code first

- Find the **entry point** (route, command handler, UI event, CLI command, job, or message consumer) and trace the
  flow to its **outcomes** (response, stored data, emitted event, rendered UI).
- For each step, record the file, the exact line range of the relevant function or block, and the text of its first
  line (for `anchor`). Read the lines themselves. Don't guess line numbers.
- Note the branches (validation failure, cache hit or miss, error paths), async boundaries (queues, events,
  callbacks), and external systems (databases, third-party APIs).
- Check for existing workspaces in `.paperworkspace/` and reuse their conventions (tag names, colors, layout).

### 5.2 Plan the story before the layout

Write a short outline:

- **Title**: the question being answered or the change being documented, for example "How a password reset works"
  or "Feature: rate-limited login".
- **Steps**: usually 4–10. For each one: the snippet (file + lines), a one-line caption, and what connects it to the
  next step.
- **Categories**: which dimensions the reader needs to scan for (change status, role, risk), and how each is encoded
  (tags, title bar color). See 5.4.
- **Reasoning**: the why, the decisions, the gotchas, the open questions. These become notes.
- **Supporting context**: data models, config, key types. These go to the side, not in the main path.
- **Legend**: whenever colors or edge styles carry meaning.

Keep it focused. If a flow needs more than about 12 snippets, split it: show the high-level flow with shapes, and put
the detail in a second workspace (use an `off-page` shape to point to it), or in a grouped region.

### 5.3 Choose a layout pattern

| Pattern | Use it for | Arrangement |
|---|---|---|
| **Pipeline** | Linear request/processing flows | Snippets left → right in reading order, edges `right` → `left`. Wrap to a new row below after about 4 snippets. |
| **Layered** | Flows that cross architectural layers | One `group` per layer (UI / API / domain / storage) stacked top → bottom or placed as columns. Edges cross between layers. |
| **By folder** | A change or a module spread over directories | One `folder` per directory the work touched; papers inside in reading order; edges between folders. |
| **Flowchart + code** | Logic with decisions | A column of shapes (`terminator` → `rectangle` → `diamond`…) on the left. Each shape links with a dotted edge to the snippet that implements it on the right. |
| **Hub** | "What uses X?" and module overviews | The central snippet in the middle, related snippets around it, edges labeled with the relationship. |
| **Sequence** | Interactions between services or actors | One column per participant (`actor`/`cloud`/group), time going down, labeled horizontal edges between columns. |
| **Before / after** | Refactors, behavior changes | Two groups side by side ("Before", "After"), or old behavior as shapes/notes and new behavior as code. |

### 5.4 Encode meaning deliberately

Each visual channel should answer **one** question. Decide the mapping in the outline, apply it consistently, and
explain it in a legend.

**Tags: the words for categories.** Tags are the explicit, readable labels. Use them for facts the reader will want
to scan for across the whole canvas. Keep the set small (2–6 tags) and the labels short (1–2 words). Useful sets:

- *Change status*: `New`, `Modified` (deleted files become red notes, since the file is gone). The full
  convention is in [`workflows/code-change-canvas.md`](workflows/code-change-canvas.md).
- *Role*: `Entry point`, `Core logic`, `Config`, `Test`, `Types`, `UI`.
- *Review*: `Needs review`, `Risk`, `TODO`, `Breaking change`.

Rules: a paper can carry several tags (e.g. `New` + `Test`). Put tags on the `file` when it has one snippet and on
the `editor` when a multi-snippet file has snippets of different kinds (one hunk new, one modified). Tag colors should
echo the matching title bar color when both encode the same thing (a green `New` tag on a green title bar). Only
files, editors and folders take tags; for a note or shape, write the category into its text or color.

**Title bar colors (`headerColor`): the at-a-glance version of one category.** Pick **one** dimension for title bar
colors, usually change status, and use the light palette. Defaults (a workflow file may override them):

| Meaning | `headerColor` | Matching tag color |
|---|---|---|
| New | `#b2f2bb` (green) | `#b6d7a8` |
| Modified | `#ffd6a5` (orange) | `#f9cb9c` |
| Risky / breaking | `#ffc9c9` (pink) | `#ea9999` |
| Tests (when status isn't the dimension) | `#e5dbff` (purple) | `#b4a7d6` |
| Unchanged context | leave it out (theme default) | — |

Leave context papers (code shown for understanding but not changed) with the default title bar, so the colored ones
stand out.

**Body colors (`color` on groups, folders, multi-snippet files): areas.** One light tint per layer or subsystem, e.g.
blue `#c5e3ff` client, green `#b2f2bb` server, purple `#e5dbff` storage, grey `#e5e5e5` neutral/legend. Don't reuse
a body color for a different meaning than a title bar color on the same canvas, or leave bodies neutral when title
bars already carry color.

**Targets: highlight the code that matters.** The target is the highlight. Point it at the exact lines of the step
(the changed hunk, the function body, the decision), not the whole file. If two separate places in a file matter,
give that file two editors, each with its own target and caption, rather than one big target.

**Annotations: one-phrase role + step number.** Give every snippet (and key shapes) an annotation such as
`2 · Checks the limiter before bcrypt`. For change documentation, lead with what changed: `Modified · now returns 429`.

**Notes: the reasoning.** Sticky notes hold what a caption can't: why the code is built this way, decisions,
trade-offs, gotchas, invariants, open questions, follow-ups. Keep each to 1–4 short lines, about 220–300 wide.
Colors by intent:

- Yellow `#ffec99` (default): explanation, "why".
- Pink `#ffc9c9`: warning, known bug, risk, breaking change.
- Blue `#c5e3ff`: good to know, background, link to other docs.
- Green `#b2f2bb`: decision made / result / how to verify.
- Red `#ea9999`: a deleted file (what it was, why it went, what replaced it).

Place a note where its scope is: **inside a folder or group** when it is about that whole area, **next to a paper
with a dotted, arrowless edge** when it is about one snippet, or **under the title** when it is about the whole
canvas (a summary, "start here").

**Edges: the verbs.**

- Solid: direct call or control flow.
- Dashed: async, event, callback, or return value.
- Dotted, no arrowhead (`endMarker: "none"`): "implemented by", "see also", or a note attached to its subject.
- Label edges with a verb ("calls", "emits `user.created`", "on 401", "yes" / "no", "tests"), and label every edge
  that leaves a decision.
- Color an edge only to encode something (e.g. dark red `#6b2f2f` for the error path) and put it in the legend.
- Use `path: "rounded"` or `"step"` in tidy grid layouts, and `"curve"` for free-form layouts.
- Set `sourceSide`/`targetSide` so the arrows follow the reading direction.

**Legend.** Whenever colors or edge styles carry meaning, add a small `group` titled `Legend` (grey `#e5e5e5` or
white body) near the title with one row per meaning: a small `shape` (`rectangle`, ~40 tall) filled with the color
and labeled with its meaning, or a short `text`. Tags explain themselves through their labels, but if title bar
colors mirror them, the legend should say so.

**Media: show the result.** A screenshot of a UI (a page, a form step, a dialog) makes code about that UI concrete.
Save it under `.paperworkspace/media/<Workspace Name>/`, add a `media` node about 480 wide, caption it, and link it
to the paper that renders it with a dotted, arrowless edge labeled `renders`. Only use real captures.

### 5.5 Visual conventions

Use these unless the project already has its own style (check existing workspaces first and match them):

- **Title**: a `text` node at the top-left, `fontSize` 32–40, `fontWeight` 700. Below it, an optional subtitle
  `text` (16–18, color `#3d4450`) that says what the canvas covers and where to start.
- **Spacing**: leave about 80–120px between boxes in a row and 100–160px between rows, so labels and captions have
  room. Captions take about 30px below a box. Don't overlap boxes unless one is inside a group or folder.
- **Size to the content**: size editors to their target (see the height formula in section 2), and use 520–720 for
  the width. A snippet of 5–40 lines reads best.
- **Titles**: set a `title` on a paper when its role reads better than its file name ("Login route"), and leave it
  out otherwise.

### 5.6 Compute the layout

Work out coordinates deliberately instead of guessing. For a row-based layout:

```
x_next = x_prev + width_prev + GAP_X          (GAP_X ≈ 100)
row_y_next = row_y + max_height_in_row + caption(30) + GAP_Y   (GAP_Y ≈ 120)
```

For children inside a group, start at `{16, 52}`; inside a folder, at `{16, 56}` with 40px between papers. Grow the
container to fit them, plus 16px padding (and 30px for a caption on the last row).

Use readable, unique ids so edges and references are easy to check, such as `title`, `g_api`, `d_auth` (folder),
`f_router`, `e_router_login`, `s_decide`, `n_why_retry`, `l_router_to_service`, `t_new` (tag). For a file with one
snippet, use a matching pair such as `f_x` / `e_x`. The user will copy references to these ids, so meaningful ids
make pasted references readable.

### 5.7 Write the file

- Path: `.paperworkspace/<Human Readable Name>.workspace`. Create `.paperworkspace/` if it doesn't exist. Leave out
  these characters from the name: `< > : " / \ | ? *`. Don't overwrite an existing workspace unless the user asks.
- Order the nodes so **every parent comes before its children**. Within a parent, later nodes draw on top.
- Pretty-print with 2-space indentation. Leave out fields that are default or unset, so the file stays small and
  diffs stay readable. Round coordinates to integers.

### 5.8 Validate before you finish

Check every item on this list:

- [ ] The JSON parses. `version` is `2`. `nodes` and `edges` are arrays.
- [ ] Every `id` is unique across nodes, and edge ids are unique across edges.
- [ ] Every `parent` refers to an existing node. Editors' parents are `file` nodes; every other box's parent is a
      `group` or `folder`. There are no cycles. No note, shape or text has a `file` as parent.
- [ ] Every `file` path exists relative to the project root, and every file node has at least one editor. Every
      `folder` path is an existing directory, and files inside a folder are in that directory.
- [ ] Every `target` is within the file's line count, and `anchor` equals the trimmed text of line `target.start`.
- [ ] Single-editor files: the editor is at `{0, 40}`, width equals the file width, and height is the file height
      minus 40. Multi-editor files: the editors fit inside the file with the padding described above.
- [ ] Children fit inside their groups and folders, and top-level boxes don't overlap.
- [ ] Every tag used on a paper is defined in `tags`, tag labels are unique, and every defined tag is used (or
      intentionally kept). Tags on single-editor files are on the `file`.
- [ ] Every color or edge style that carries meaning is explained by a legend or by tags.
- [ ] Every edge `source`/`target` refers to an existing node id. Edges pointing at missing ids are silently dropped.
- [ ] Colors are `#rrggbb` (or `"none"` for a shape fill), and shape ids come from the list in section 2.

Then tell the user the file path and how to open it: click it in the Explorer, or open it from the **Paper
Workspace** activity-bar panel. Give a two-line summary of the tour the canvas presents and the meaning of its tags
and colors. If the workspace is already open, the canvas reloads from the saved file.

---

## 6. Canvases of changed code

When the user asks for a canvas of a change (the current branch, what you did in this session, a feature, fix or PR,
or a code review), **read [`workflows/code-change-canvas.md`](workflows/code-change-canvas.md) and follow it**. It
covers collecting the change set from git, tagging papers `New` / `Modified` with matching title bar colors,
red notes for deleted files (why, and what replaced them), targeting the changed hunks, linking screenshots of changed
views, and a complete example. Teams customize its conventions, so always read the project's copy instead of relying
on memory.

---

## 7. Example: explaining a flow

A login flow: a decision flowchart on the left, the real code on the right, a service file with two snippets, and a
note.

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
- The pink note is a warning attached to the exact snippet it is about.

In a real workspace, every `target` and `anchor` must come from reading the actual file.

---

## 8. Quick reference

- Location: `.paperworkspace/*.workspace` (JSON, version 2).
- Workflow files: `workflows/*.md` (team-customizable recipes; e.g. `code-change-canvas.md` for canvases of changed code).
- Reference: `paperworkspace:<workspace path>#<type>/<id>` (no `#…` = the whole workspace).
- File header 40px. File padding 12. Gap between snippets 16. Caption space 30.
- Group header 36, padding 16, first child `{16, 52}`. Folder header 40, padding 16, first child `{16, 56}`, 40 between papers.
- Default sizes: editor 640×380, text 240×40, note 220×220, group 480×320, folder 720×480, shape 160×80, media up to 480.
- Editor height for `n` target lines: `30 + (n+2)*19 + 8`, clamped to 150–560.
- Tags: defined once at the top level; used by files, editors and folders only; single-editor files show the file's.
- Edge defaults: `curve`, 2px, `solid`, no start marker, `arrow` end marker.
- Array order is stacking order. Parents come before children.
