# Paper Workspace — design

Paper Workspace opens code as movable "papers" on an infinite canvas. Each source file is a **file node** (a group)
holding one or more **editor nodes**: scrollable Monaco editors over the real file, each with an optional **target**
(the line range the snippet is about). Edits go straight to the file, and targets follow the code as it changes.

## Constraints that shaped the design

| Constraint | Consequence |
| --- | --- |
| Must run in VS Code, Cursor and Windsurf/Devin (all VS Code forks) | `engines.vscode: ^1.90.0` (forks lag upstream), only stable APIs, distribute via `.vsix` / Open VSX (forks don't use the MS Marketplace). |
| Extensions cannot embed VS Code's own editors in a webview | Each paper embeds **Monaco**. IntelliSense is bridged: Monaco providers forward to VS Code's `vscode.execute*Provider` commands on the real file (see *IntelliSense* below). Other extension UI (code actions, CodeLens, decorations) is not available inside papers. |
| There is no API to intercept "open file" | "Take over" mode reacts to `tabGroups.onDidChangeTabs`: closes the new text tab and adds a paper instead (a brief flicker is expected). |
| Many live Monaco instances are heavy | Editors are live Monaco instances, but only for nodes in the viewport (`onlyRenderVisibleElements`) and above 35% zoom; otherwise a `monaco.editor.colorize` preview. Scroll positions survive unmount/remount. |
| Canvas is CSS-transformed (zoom) | Monaco ≥ 0.4x corrects mouse coordinates for `transform: scale`; overflow widgets stay in the transformed subtree (`fixedOverflowWidgets: false`) because `position: fixed` breaks under transforms. They go to an `overflowWidgetsDomNode` next to the (clipped) editor so suggestions can extend past small papers; the focused node is raised above its neighbors. |

## Architecture

```
Extension host (Node)                                  Webview (React + @xyflow/react + Monaco)
─────────────────────                                  ─────────────────────────────────────────
WorkspaceStore    mode/target (workspaceState),        App           React Flow canvas, toolbar, minimap,
                  list/create workspaces, addCodeNode                drag & drop, Ctrl+S capture
CanvasProvider    CustomTextEditor for *.workspace  ◄────► FileNode      group per source file: header, + snippet
 └ CanvasSession  one per open canvas: layout sync,    postMessage   EditorNode    child of a FileNode: scrollable Monaco,
                  source-doc sync, autosave                          target highlight, back-to-target, pin
TakeoverController  new text tab → paper               DocStore      one Monaco model per file, shared by
WorkspacesView    side panel tree (mode + papers)                    all papers; ranges tracked by decorations
```

### Source of truth

* **Layout** lives in the `.workspace` `TextDocument` (CustomTextEditor), so VS Code's undo/redo, dirty state and
  file watching work for free. The webview sends full `update`s (debounced); the host replaces the document text and
  ignores the resulting change event (`lastWritten`). Layout is auto-saved (`paperWorkspace.autoSaveLayout`).
* **Code** lives in the real file's `TextDocument`. The webview mirrors it in a Monaco model:
  * local edits → `edit` (Monaco change list) → queued `WorkspaceEdit` per file → `docState {ack, length}`;
  * other edits (native editor, git, formatters, another canvas) → `docChanged` → `pushEditOperations`;
  * a length mismatch after all acks triggers a full resync (`openDoc`).
* **IntelliSense** (`src/extension/language.ts`, `src/webview/language.ts`): completion, hover and signature-help
  providers registered for `paper:` models send `language {id, request}`; the host waits for that file's queued edits
  (so positions refer to the same text), runs `vscode.executeCompletionItemProvider` / `executeHoverProvider` /
  `executeSignatureHelpProvider` and answers `languageResult`. The command API cannot resolve one completion item,
  so `resolveCompletion` re-runs the latest request with `itemResolveCount` (batches of 25, up to item 200) and
  matches the item by index + label; that brings docs and auto-import edits. `vscode.languages` diagnostics are
  pushed as `diagnostics` and shown as Monaco markers. Trigger characters are a fixed common set (the API doesn't
  expose providers' own). Some servers only report problems for files open in a tab (e.g. TypeScript), so squiggles
  can be missing for files that are only on the canvas.
* **Explorer sync**: selecting a single paper (or clicking into one) sends `nodeFocused`; the host runs `revealInExplorer`
  (debounced) and then re-focuses the canvas and its live editor (`restoreFocus`), because that command steals focus.
* **Saving**: Ctrl/Cmd+S inside the canvas is captured before VS Code's webview handler and saves the layout plus
  every dirty file shown on the canvas.

### File nodes, editor nodes and targets

* A **file node** is a React Flow parent; its **editor nodes** are children (`parentId`, `expandParent`). Removing a
  file removes its editors; removing a file's last editor removes the file.
* **One editor = one combined node.** A file with a single editor renders as one node: the file header carries the
  target controls and the editor fills the rest (its React Flow node is hidden, the file size is authoritative, and the
  stored editor sits at `(0, header)` with the file's size). Adding a second editor turns the file into a group: the
  existing editor keeps its size and becomes a padded child. Going back to one editor collapses it again.
* Each editor is a full, scrollable Monaco editor (vertical + horizontal, like VS Code). The wheel scrolls the editor;
  Ctrl/Cmd+wheel over code zooms the canvas with the same step as the pane.
* A **target** (1-based inclusive `{start, end}`) is optional. Targeted editors open scrolled to it, highlight it
  (editor-owned decorations, so sibling editors of the same file don't show it), show a *Back to Lx–y* pill when it
  scrolls out of view, and have a ◎ button to jump back. *Pin* sets the target to the selection, or to the visible
  lines when nothing is selected.
* Targets are tracked in the webview with a model decoration using `AlwaysGrowsWhenTypingAtEdges`: typing Enter on the
  last target line grows it, inserting above shifts it, deleting shrinks it. Changes are written back to the paper.
* `anchor` (trimmed first target line) re-finds the target if the file changed while no canvas was open
  (`relocateRange`: nearest matching line, same length).
* ＋ on a file header adds another editor below the others, seeded with the selection of that file's focused editor.
* **Ctrl/Cmd+click** in an editor (a JSX tag, an identifier, an import path) sends `goToDefinition`; the host asks
  VS Code's `vscode.executeDefinitionProvider` on the real file (so path aliases and re-exports resolve), falling back to
  resolving relative import paths itself. The result is added like any other snippet (short declarations become the
  target, a module path opens the whole file), placed to the right of the clicked file, and revealed. Holding the
  modifier underlines what would be followed.
* Adding from VS Code (selection command, take over, Explorer, drop) goes to the file's existing file node when there
  is one: an editor whose target already covers the lines is revealed, otherwise a new snippet is added below.

## `.workspace` format (v2)

Stored in `<workspace folder>/.paperworkspace/<name>.workspace`; paths are relative to that folder with `/` separators so
papers can be committed and shared.

```json
{
  "version": 2,
  "nodes": [
    { "id": "f_1", "type": "file", "file": "src/pages/business/services/ServicesController.tsx",
      "position": { "x": 720, "y": 120 }, "width": 664, "height": 520 },
    { "id": "e_1", "type": "editor", "parent": "f_1",
      "target": { "start": 5, "end": 12 }, "anchor": "const ServicesController = () => {",
      "position": { "x": 12, "y": 40 }, "width": 640, "height": 230 },
    { "id": "e_2", "type": "editor", "parent": "f_1",
      "position": { "x": 12, "y": 286 }, "width": 640, "height": 222 }
  ],
  "edges": []
}
```

Editor positions are relative to their file node; parents are written before children. v1 files (flat `code` nodes
with a `range`) are migrated on load to a file node with one targeted editor.

Board nodes sit next to files and can be nested in groups (`parent` = a group id, position relative to it):

```json
{ "id": "g_1", "type": "group", "title": "Services flow", "color": "#c5e3ff", "position": { "x": 0, "y": 0 }, "width": 700, "height": 600 },
{ "id": "f_1", "type": "file", "parent": "g_1", "file": "src/a.ts", "position": { "x": 16, "y": 36 }, "width": 664, "height": 520 },
{ "id": "t_1", "type": "text", "text": "Overview", "color": "#ffec99", "fontSize": 40, "position": { "x": 0, "y": -80 }, "width": 240, "height": 54 },
{ "id": "n_1", "type": "note", "parent": "g_1", "text": "Check this", "position": { "x": 400, "y": 300 }, "width": 220, "height": 220 },
{ "id": "s_1", "type": "shape", "parent": "g_1", "shape": "diamond", "text": "Valid?", "color": "#ffec99", "position": { "x": 40, "y": 300 }, "width": 140, "height": 100 },
{ "id": "m_1", "type": "media", "src": ".paperworkspace/media/main/pasted-20260923.png", "position": { "x": 800, "y": 0 }, "width": 480, "height": 270 }
```

* **Group**: a titled, colored area (double-click the title to rename). Ctrl/Cmd+G wraps the selection (or adds an empty
  group); dropping a node with its center over a group moves it in, dropping it outside moves it out, and the group
  grows to fit its content. It drags from anywhere, title bar or empty area (box selection starts on the canvas). Deleting a
  group deletes its content; *Ungroup* (toolbar, menu, Ctrl/Cmd+Shift+G) keeps it.
* **Text** (no background, `color` = text color, height follows the content) and **note** (sticky note, `color` =
  background, `textColor` = text color, automatic contrast when unset). Both have an optional `fontSize` (any px value,
  typed or picked from the toolbar dropdown) and `fontWeight`. Double-click to edit; an emptied text is removed.
* **Shape**: a diagram shape from the shapes panel (toolbar or S): general shapes, flowchart symbols and block arrows
  (`src/webview/shapes.ts`; an unknown `shape` renders as a rectangle, so new kinds stay readable). Paths are computed
  for the node's pixel size, so outlines and corner radii do not stretch when resized. `color` = fill (`"none"` = no
  fill), `strokeColor` = outline, `textColor` = label (automatic contrast when unset), plus `fontSize`/`fontWeight`.
  Click a shape in the panel to add it at the view center, or drag it onto the canvas; either way it joins the group
  under its center. Double-click to edit the label.
* **Links** (`edges`): a line between any two nodes (files, snippets, groups, text, notes, shapes, media), from a side of
  one to a side of the other. Every node has a handle on each side (shown on hover); drag from one onto another node's
  handle, or onto its body to use the side facing the pointer. Dragging a link's end reconnects it. Selecting a link
  shows its toolbar: line color, thickness, solid/dashed/dotted, path (`curve`, `straight`, `step` = elbow,
  `rounded` = rounded elbow), a marker at each end (`none`, `arrow`, `open-arrow`, `circle`, `diamond`), reverse, and
  the label's text, color, size and weight (double-click the link to write the label). Only non-default values are
  stored; a link without sides uses the sides facing each other. A link to an embedded editor (a file with one
  snippet) is drawn from its file node. Links between copied nodes are copied with them; removing a node removes its
  links.

  ```json
  { "id": "l_1", "source": "e_1", "sourceSide": "right", "target": "s_1", "targetSide": "left",
    "path": "rounded", "color": "#27405f", "width": 3, "dash": "dashed", "startMarker": "circle",
    "label": "calls", "fontSize": 16, "fontWeight": 600 }
  ```
* **Media**: images and videos. Picked files inside the paper root are referenced; files outside it, pasted and
  dropped bytes are written to the workspace's own folder `.paperworkspace/media/<workspace>/`, which is renamed and
  trashed with the workspace (older layouts may still point at files directly in `.paperworkspace/media/`; they keep
  working). The webview reads them through `mediaRoot` (the root is a `localResourceRoot`).
* **Export / import** (`src/shared/bundle.ts`): *Export…* on a workspace writes a `.paperbundle`, a JSON file with the
  layout (unsaved canvas changes included) and the base64 bytes of every local media file it shows, keyed by `src`.
  Source files are not included; papers keep their root-relative paths. *Import Workspace…* (panel title bar, or the
  Explorer menu on a `.paperbundle`) creates a new, uniquely named workspace; embedded media goes into its media
  folder with `src`s rewritten, except repository files (outside `.paperworkspace/`) that already exist with the same
  bytes, which stay referenced. A plain `.workspace` file can be imported too (layout only).

  ```json
  { "format": "paper-workspace-bundle", "version": 1, "name": "main", "exportedAt": "2026-09-26T10:00:00.000Z",
    "workspace": { "version": 2, "nodes": [], "edges": [] },
    "media": { ".paperworkspace/media/main/shot.png": { "name": "shot.png", "data": "iVBORw0…" } } }
  ```
* **Titles**: files and editors can carry a `title`, a name label above the box's top-left corner, like frame names in
  Figma. It is scaled by 1/zoom so it keeps its screen size at any zoom (readable when zoomed far out) and is cut to
  the box's width. Undefined = the file's base name, or for an editor the first highlighted (target) line, read live from
  the model (base name without a target or on a blank line); double-click or "Rename title" edits it (empty resets). `showTitle`
  is saved only when it differs from the default (shown); the embedded editor of a combined node never shows its title.
  Dragging the label moves the node. New papers get `showTitle` from the config panel ("Show file/editor title by default",
  settings `paperWorkspace.showFileTitleByDefault` = true and `showEditorTitleByDefault` = false). Right-clicking the empty
  canvas offers Show/Hide file titles and Show/Hide editor titles: they set every paper's own `showTitle` (not a view
  filter), so single papers can be changed afterwards. Right-drag pans, so that menu opens only for a right-click that
  did not move (React Flow swallows the pane's contextmenu when right-drag pans; the canvas wrapper handles it).
* **Title bar color**: files and editors can carry a `headerColor` (`#rrggbb`), the background of their header bar.
  "Set title bar color" in the node menu opens the shared color palette below the header; once set, the entry becomes
  "Remove title bar color". Header text and buttons switch to dark or light to stay readable on it. A combined node
  shows the file's color.
* **Annotations**: files, groups, shapes and media can carry an `annotation`, a small italic caption centered below the
  box (like an image caption; under a stick figure it follows the label). It is off by default (no key in the file);
  the comment button in the file header or the node toolbar adds it (`""` until typed) or removes it with its text.
  Double-click to edit. Text and notes have none, being text already. It hangs outside the box, so sizes, group
  fitting and links ignore it.
  Snippets (editors in a multi-snippet file) have one too, from their header. Their caption stays inside the file:
  an annotated snippet reserves `ANNOTATION_SPACE` below it (file size, next snippet slot), and turning a caption on
  pushes the snippets under it down. When a file collapses to one snippet, that snippet's caption joins the file's.
* Colors come from a fixed palette (dark and pastel rows) or a custom color, edited from the toolbar shown above the
  selected node.

Readers ignore unknown node types and link fields, so later kinds and `layers` can be added without breaking older files.
The viewport is per-user UI state (webview `setState`), not stored in the file.

## Modes (side panel)

| Mode | Behavior |
| --- | --- |
| Off | Nothing is intercepted; add-to-canvas menus/keybindings are hidden. `.workspace` files still open as canvases. |
| Manual (default) | Add code with *Add Selection to Paper Workspace* (Ctrl/Cmd+Alt+P), Explorer → *Add to Paper Workspace*, or Shift+drag files onto a canvas. |
| Take over | Opening a text file adds it to the **target** workspace. Selection → a snippet targeting those lines; cursor below line 1 (go to definition, search) → a 30-line target starting 2 lines above; otherwise a whole-file editor with no target. Dirty documents, non-file schemes and `.workspace` files are left alone; "Open in text editor" from a paper bypasses take-over once. |

## Roadmap

1. **Core canvas + file nodes** — done (this milestone).
2. Links between nodes — done (anchoring a link to lines of code is still open). Groups, text, notes and media — done.
3. Layers panel (show/hide/lock/reorder), image nodes, text notes.
4. Import-based link suggestions.
5. Language features inside papers by proxying `vscode.executeCompletionItemProvider` / hover / definition.

## Development

* `npm run build` / `npm run watch` — esbuild bundles `dist/extension.js`, `dist/webview.js(+css)`, `dist/editor.worker.js`.
* `npm run dev:webview` — canvas in a normal browser against a mock host (`scripts/harness/`), http://localhost:5199/harness/.
* `npm test` — unit tests (format, ranges, paths).
* `npm run test:integration -- --code "<path to Code.exe>"` — runs `test/integration/suite.cjs` in a real VS Code with
  an isolated profile.
* `npm run package` — production `.vsix`; publish with `vsce publish` and `npx ovsx publish` (Open VSX, used by Cursor
  and Windsurf/Devin).
