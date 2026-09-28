# Paper Workspace

Lay your code out like papers on a desk. Paper Workspace opens pieces of files as movable, **editable** papers on an
infinite canvas so you can see how the parts of your software connect — and change them right there.

Works in **VS Code**, **Cursor** and **Windsurf / Devin**.

## Features

- **File nodes with snippets**: each file is a group holding one or more editors. Click ＋ on a file to add another
  snippet of it. Editors scroll vertically and horizontally like VS Code, and edits are written to the file.
- **Folder nodes**: Shift+drag a folder from the Explorer (or Explorer → *Add to Paper Workspace*) to add a container
  for it, with a file-like title bar and a body color picked from its menu. New files from that folder are added
  inside it; files you drag in land where you drop them.
- **Targets**: a snippet can have a target (the lines it is about). It opens scrolled there, highlights it, and a
  *Back to Lx–y* pill / ◎ button returns to it after you scroll away. Pin sets the target to your selection. Targets
  follow the code as it is edited.
- **Canvas**: pan, zoom, box-select, minimap, fit-all, dotted background (color set in the ⚙ panel, grey by default); follows your editor theme and font.
- **Shapes for diagrams**: the shapes panel (toolbar, or **S**) has general shapes, flowchart symbols and block arrows,
  like draw.io. Click one to add it, or drag it onto the canvas or into a group; double-click to label it, and set its
  fill, line and text colors from the toolbar above it.
- **Workspaces panel**: create several `.workspace` workspaces (stored in `.paperworkspace/`, safe to commit), pick the
  **target**, and choose a mode:
  - **Off** — disabled.
  - **Manual** — add code with **Ctrl+Alt+P** (Cmd+Alt+P) on a selection, Explorer → *Add to Paper Workspace*, or
    Shift+drag files onto the canvas.
  - **Take over** — opening a file adds it to the target workspace instead of a normal tab.
- **Export / import**: right-click a workspace → *Export…* to save it as a single `.paperbundle` file with all its
  images and videos inside; *Import Workspace…* in the panel title bar adds it to another repository or machine. Code
  papers keep their relative paths, so import into a checkout of the same project.
- **Ctrl+S** in a canvas saves the layout and every changed file on it.
- **Explorer sync**: selecting or clicking into a paper selects its file in the Explorer (setting `paperWorkspace.revealInExplorer`).

## Install

```bash
npm install
npm run package
```

Then in VS Code / Cursor / Windsurf: *Extensions* → `…` → *Install from VSIX…* → `paper-workspace-0.1.0.vsix`.

## Limitations (v0.1)

- Papers get completions, hovers, parameter hints and problems from VS Code's language services, plus Ctrl/Cmd+click
  go to definition. Other extension features (quick fixes, rename, CodeLens...) are not available inside papers yet
  (use *Open in text editor* on the paper header).
- Links, groups, layers, images and text notes are planned — see `DESIGN.md` in the source repository.
