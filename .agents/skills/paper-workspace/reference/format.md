# File format (version 2)

Read this when you **write** a workspace. Reading one only needs `scripts/outline.mjs`. Shape ids and colors are in
[visual-style.md](visual-style.md).

```jsonc
{
  "version": 2,
  "tags": [ /* optional: { "id": "t_new", "label": "New", "color": "#b6d7a8" } */ ],
  "tagPlacement": "top",   // optional: right (default) | bottom | left | top
  "nodes": [ /* boxes and editors; array order = stacking order, parents before children */ ],
  "edges": [ /* arrows between any two nodes */ ]
}
```

Optional top-level fields to preserve but not to write: `showTags: false` (hides chips), `customColors` (color picker
history, no visual effect).

## Coordinates

- Canvas pixels; `x` grows right, `y` grows down. Round to integers.
- `position` is the **top-left corner**, **relative to the parent** (`group`, `folder` or `file`) when there is one,
  absolute otherwise.
- `width` / `height`: 20–2000.

## Node kinds

Every node: `id` (unique), `type`, `position {x,y}`, `width`, `height`, optional `parent`. Readers skip unknown kinds.

| `type` | What it is | Own fields |
|---|---|---|
| `file` | Paper for one source file; holds 1+ `editor`s | `file` (path), `annotation?`, `title?`, `showTitle?`, `headerColor?`, `color?`, `tags?`, `locked?` |
| `editor` | Live editor over the whole file, scrolled to and highlighting `target`; always inside a `file` | `parent` (**required**, file id), `target? {start,end}`, `anchor?`, `annotation?`, `title?`, `showTitle?`, `headerColor?`, `tags?`, `locked?` |
| `folder` | A project directory: container with a file-like title bar | `folder` (path, `""` = root), `annotation?`, `title?`, `showTitle?`, `headerColor?`, `color?`, `tags?`, `locked?` |
| `group` | Titled colored area for a concept | `title`, `color?`, `textColor?`, `fontSize?`, `fontWeight?`, `titlePosition?`, `strokeColor?`, `strokeWidth?`, `strokeStyle?`, `annotation?`, `locked?` |
| `shape` | Diagram shape with a label | `shape`, `text`, `color?` (fill or `"none"`), `strokeColor?`, `textColor?`, `fontSize?`, `fontWeight?`, `annotation?` |
| `note` | Sticky note | `text`, `color?` (background, default `#ffec99`), `textColor?`, `fontSize?` (14), `fontWeight?` |
| `text` | Free text, no background | `text`, `color?` (text color), `fontSize?` (18), `fontWeight?` |
| `media` | Image or video | `src` (usually `.paperworkspace/media/<workspace>/<name>`), `annotation?` |

Containment: `group` and `folder` hold any box; `file` holds only `editor`s. **A note can't sit inside a file**: put
it beside the file (or in the file's folder/group) and attach it with an edge.

## Field details

- **Paths** (`file`, `folder`, `src`): relative to the project root, `/` separators.
- **`target`**: 1-based inclusive line range; the editor opens there and highlights it. No target = whole file, no
  highlight.
- **`anchor`**: the **trimmed text of line `target.start`**; the extension re-finds the target by it when the file
  changes. Always set it with `target`.
- **`annotation`**: italic caption centered **below** the box (takes 30px). Missing = none. Not on text/note.
- **`title`**: label above the top-left corner. Default: base name (file/folder) or first target line (editor). Set
  it only when a role reads better ("Login route"). `"showTitle": false` hides it.
- **`headerColor`**: title bar color of a file, editor or folder. Use the light palette.
- **`color`**: body tint of a folder or of a file with **several** snippets (no effect on single-snippet files).
- **`tags`**: ids from the top-level `tags` (define once: `id`, `label` ≤ 40 chars, unique ignoring case, `color`).
  Only files, editors and folders take tags. **A single-editor file shows the file's tags**, so put them on the file.
- **`tagPlacement`** `"top"` puts chips on the title row; use it when papers sit side by side.
- **`locked`**: can't be moved/edited on the canvas; everything inside is locked too. Only when the user asks.
- **`text`**: plain text, `\n` for new lines, no Markdown.
- Colors are `#rrggbb`. `fontWeight` 100–900, `fontSize` 6–200.

## File nodes and their editors

**One snippet (combined node)**: the file's size counts; the editor fills it under the 40px header. The **file's**
annotation, tags, headerColor and lock are shown.

```
editor.position = { x: 0, y: 40 };  editor.width = file.width;  editor.height = file.height - 40
```

**Several snippets**: the file is a padded container; each **editor's** annotation/tags/headerColor apply to it.

```
first editor:  { x: 12, y: 40 }
next editor:   y = prev.y + prev.height + (prev has annotation ? 30 : 0) + 16
file.width  >= max(editor.x + editor.width) + 12          (640 editors → 664)
file.height >= max(editor.y + editor.height + annotation space) + 12
```

Editor height for `n` target lines: `30 + (n + 2) * 19 + 8`, clamped 150–560. Width 640 (520–720 fine).

## Folders and groups

| | Title bar | Padding | First child | Fit rule |
|---|---|---|---|---|
| `folder` | 40 | 16 | `{16, 56}`, papers side by side 40 apart | `w >= child.x + child.w + 16`, `h >= child.y + child.h (+30 caption) + 16` |
| `group` | 36 | 16 | `{16, 52}` | same |

- A file inside a folder must be a file of that directory (`<folder>/…`). One folder node per directory.
- Group title style: `textColor`, `fontSize` (14), `fontWeight` (600), `titlePosition` `top-left` (default) |
  `top-center` | `top-right` | `bottom-left` | `bottom-center` | `bottom-right`. Title bar height
  `max(36, ceil(fontSize × 1.25) + 18)`; a bottom title puts that room at the bottom (children can start at `y: 16`).
- Group border: `strokeColor`, `strokeWidth` (1.5), `strokeStyle` `solid` | `dashed` | `dotted` | `none`.

## Edges

```jsonc
{ "id": "l1", "source": "<node id>", "target": "<node id>",   // any node kind
  "sourceSide": "right", "targetSide": "left",                  // top|right|bottom|left; omitted = auto
  "path": "curve",            // curve (default) | straight | step | rounded
  "points": [{ "x": 640, "y": 120 }],  // optional bend points (canvas coordinates), source → target order
  "color": "#27405f", "width": 2,
  "dash": "solid",            // solid (default) | dashed | dotted
  "startMarker": "none",      // none (default) | arrow | open-arrow | circle | diamond
  "endMarker": "arrow",       // arrow (default)
  "label": "calls", "labelColor": "#…", "fontSize": 14, "fontWeight": 600,
  "labelBackground": "#ffec99",    // "none" = transparent
  "labelAt": 0.25,            // 0 (source) … 1 (target) along the line; omitted = 0.5
  "labelOffset": { "x": 0, "y": -16 } }   // shift off the line; omitted = on it
```

When a file has several snippets, point edges at the **editor** so the arrow lands on the code.

## Defaults and ids

- Default sizes: editor 640×380, text 240×40, note 220×220, group 480×320, folder 720×480, shape 160×80, media ≤ 480.
- Readable unique ids: `title`, `g_api` (group), `d_auth` (folder), `f_router` / `e_router` (file + its editor),
  `s_decide`, `n_why_retry`, `m_screen`, `l_router_to_service`, `t_new`. Users paste references to these.

## Writing the file

- Path: `.paperworkspace/<Human Readable Name>.workspace` (create the folder if needed; no `< > : " / \ | ? *`).
  Never replace an existing workspace from scratch; edit it in place ([../tasks/update.md](../tasks/update.md)).
- Every parent before its children in `nodes`; later nodes draw on top.
- 2-space indentation; leave out default/unset fields.
- Run `node <skill>/scripts/validate.mjs <file>`. Without Node, check by hand: unique ids; valid parents (editor →
  file, others → group/folder) in order; paths exist; no duplicate file/folder paths; targets in range with matching
  anchors; editor geometry above; children fit; tags defined; edge ends exist; colors `#rrggbb`.
