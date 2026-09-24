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
{ "id": "m_1", "type": "media", "src": ".paperworkspace/media/pasted-20260923.png", "position": { "x": 800, "y": 0 }, "width": 480, "height": 270 }
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
  under its center. Double-click to edit the label. Connecting shapes with lines is the next step (links).
* **Media**: images and videos. Picked files inside the paper root are referenced; files outside it, pasted and
  dropped bytes are written to `.paperworkspace/media/`. The webview reads them through `mediaRoot` (the root is a
  `localResourceRoot`).
* Colors come from a fixed palette (dark and pastel rows) or a custom color, edited from the toolbar shown above the
  selected node.

Readers ignore unknown node types, so later kinds and `edges`/`layers` can be added without breaking older files.
The viewport is per-user UI state (webview `setState`), not stored in the file.

## Modes (side panel)

| Mode | Behavior |
| --- | --- |
| Off | Nothing is intercepted; add-to-canvas menus/keybindings are hidden. `.workspace` files still open as canvases. |
| Manual (default) | Add code with *Add Selection to Paper Workspace* (Ctrl/Cmd+Alt+P), Explorer → *Add to Paper Workspace*, or Shift+drag files onto a canvas. |
| Take over | Opening a text file adds it to the **target** workspace. Selection → a snippet targeting those lines; cursor below line 1 (go to definition, search) → a 30-line target starting 2 lines above; otherwise a whole-file editor with no target. Dirty documents, non-file schemes and `.workspace` files are left alone; "Open in text editor" from a paper bypasses take-over once. |

## Roadmap

1. **Core canvas + file nodes** — done (this milestone).
2. Links between papers (optionally anchored to lines). Groups, text, notes and media — done.
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
