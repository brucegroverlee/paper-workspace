# Features

Everything Paper Workspace can do today. For a quick overview, see the [README](../README.md).

- **File nodes with snippets**: each file is a group holding one or more editors. Click ＋ on a file to add another
  snippet of it. Editors scroll vertically and horizontally like VS Code, and edits are written to the file.
- **Folder nodes**: Shift+drag a folder from the Explorer (or Explorer → *Add to Paper Workspace*) to add a container
  for it, with a file-like title bar and a body color picked from its menu. New files from that folder are added
  inside it; files you drag in land where you drop them.
- **Targets**: a snippet can have a target (the lines it is about). It opens scrolled there, highlights it, and a
  *Back to Lx–y* pill / ◎ button returns to it after you scroll away. Pin sets the target to your selection. Targets
  follow the code as it is edited.
- **Same colors as the text editor**: papers highlight code with the grammars of your installed extensions and your
  color theme's token colors (including `editor.tokenColorCustomizations`), using the same engine as VS Code, and
  follow theme changes. Semantic highlighting (colors from the language server) is not applied.
- **Git gutter**: papers show added / modified / deleted lines like VS Code's own gutter, next to the yellow target
  bar, and update as you type. Unstaged changes are drawn in full color and staged ones faded, as in Windsurf. Set
  `paperWorkspace.gitDiffBase` to a branch or commit to also see (faded) what was committed since then, or to
  `index` for unstaged changes only.
- **Canvas**: pan, zoom, box-select, minimap, fit-all, dotted background (color set in the ⚙ panel, grey by default); follows your editor theme and font.
- **Align**: select several items and right-click one of them (or the box around a drag-selection) → *Align* to line
  them up by their left, center or right edges, or their top, middle or bottom edges. Locked items stay where they are.
- **Shapes for diagrams**: the shapes panel (toolbar, or **S**) has general shapes, flowchart symbols and block arrows,
  like draw.io. Click one to add it, or drag it onto the canvas or into a group; double-click to label it, and set its
  fill, line and text colors from the toolbar above it.
- **Link routes**: select a link and drag the handle in the middle of the line to bend it, like draw.io's waypoints,
  so links that would overlap take separate paths. Each bend adds new handles between the points; drag a bend point
  to move it (it snaps in line with its neighbors), double-click it to remove it, or use *Reset path* in the link
  toolbar. Elbow links keep right angles through their bends, and bends move along when both ends are moved together.
  Drag a link's label to slide it along the line or move it off to the side (it snaps back onto the line and to its
  middle); it stays in that spot on the line as the link moves. *Reset label position* in the toolbar re-centers it.
- **Workspaces panel**: create several `.workspace` workspaces (stored in `.paperworkspace/`, safe to commit), pick the
  **target**, and choose a mode:
  - **Off** — disabled.
  - **Manual** — add code with **Ctrl+Alt+P** (Cmd+Alt+P) on a selection, Explorer → *Add to Paper Workspace*, or
    Shift+drag files onto the canvas.
  - **Take over** — opening a file adds it to the target workspace instead of a normal tab.
- **Snapshots**: the camera button in the toolbar saves the current view, or the whole workspace, as a PNG image; a
  save dialog lets you pick its name and folder, so the work is easy to share.
- **Duplicate**: right-click a workspace → *Duplicate…* to make an independent copy with its own images and videos,
  so you can keep the original untouched and continue working in the copy.
- **Copy & paste between workspaces**: select items (files, snippets, folders, groups, notes, text, shapes, images)
  and press **Ctrl+C** / **Ctrl+X** (Cmd on macOS), or right-click one → *Copy* / *Cut*. Open another workspace and press
  **Ctrl+V** (Cmd+V), or right-click the empty canvas → *Paste*. Links between the copied items and their tags come
  along, and images are copied into the target workspace's own media folder. A file or folder that is already on the
  target canvas takes in the pasted snippets or content instead of showing up twice.
- **Export / import**: right-click a workspace → *Export…* to save it as a single `.paperbundle` file with all its
  images and videos inside; *Import Workspace…* in the panel title bar adds it to another repository or machine. Code
  papers keep their relative paths, so import into a checkout of the same project.
- **Copy reference**: right-click any item (file, snippet, folder, group, note, text, shape, image) → *Copy
  reference* to copy an id such as `paperworkspace:.paperworkspace/Auth.workspace#editor/e_route`. Paste it into an AI
  chat and an agent using the [AI skill](ai-skill.md) opens that workspace and finds the exact item you mean. Right-click the
  empty canvas → *Copy workspace reference* for the whole canvas.
- **AI skill**: [`.agents/skills/paper-workspace`](../.agents/skills/paper-workspace/SKILL.md) teaches an AI agent to read, explain, build and update workspaces (in place,
  leaving locked and "Do not touch" items alone). Recipes for specific canvases live in its `workflows/` folder
  and are meant to be customized per team, e.g.
  [`code-change-canvas.md`](../.agents/skills/paper-workspace/workflows/code-change-canvas.md) for a canvas of the changes in a branch, session or PR.
  See [Use the AI skill](ai-skill.md) to add it to your agent.
- **Ctrl+S** in a canvas saves the layout and every changed file on it.
- **Explorer sync**: selecting or clicking into a paper selects its file in the Explorer (setting `paperWorkspace.revealInExplorer`).

## Settings

All settings live under `paperWorkspace.*` in VS Code settings, and most are also editable from the ⚙ panel on the
canvas: auto-save of the layout, Explorer sync, minimum and default paper sizes, focus zoom, canvas background, title
labels and the Git diff base.

## Limitations

- Papers get completions, hovers, parameter hints and problems from VS Code's language services, plus Ctrl/Cmd+click
  go to definition. Other extension features (quick fixes, rename, CodeLens...) are not available inside papers yet
  (use *Open in text editor* on the paper header).
- Semantic highlighting (colors from the language server) is not applied.
- A layers panel and import-based link suggestions are planned; see the roadmap in [DESIGN.md](../DESIGN.md#roadmap).
