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
- **Snapshots**: the camera button in the toolbar saves the current view, or the whole workspace, as a PNG image; a
  save dialog lets you pick its name and folder, so the work is easy to share.
- **Duplicate**: right-click a workspace → *Duplicate…* to make an independent copy with its own images and videos,
  so you can keep the original untouched and continue working in the copy.
- **Export / import**: right-click a workspace → *Export…* to save it as a single `.paperbundle` file with all its
  images and videos inside; *Import Workspace…* in the panel title bar adds it to another repository or machine. Code
  papers keep their relative paths, so import into a checkout of the same project.
- **Copy reference**: right-click any item (file, snippet, folder, group, note, text, shape, image) → *Copy
  reference* to copy an id such as `paperworkspace:.paperworkspace/Auth.workspace#editor/e_route`. Paste it into an AI
  chat and an agent using [`SKILL.md`](SKILL.md) opens that workspace and finds the exact item you mean. Right-click the
  empty canvas → *Copy workspace reference* for the whole canvas.
- **AI skill**: [`SKILL.md`](SKILL.md) teaches an AI agent to read, explain and build workspaces. Recipes for specific
  canvases live in [`workflows/`](workflows/) and are meant to be customized per team, e.g.
  [`code-change-canvas.md`](workflows/code-change-canvas.md) for a canvas of the changes in a branch, session or PR.
  See [Use the AI skill](#use-the-ai-skill) to add it to your agent.
- **Ctrl+S** in a canvas saves the layout and every changed file on it.
- **Explorer sync**: selecting or clicking into a paper selects its file in the Explorer (setting `paperWorkspace.revealInExplorer`).

## Install

```bash
npm install
npm run package
```

Then in VS Code / Cursor / Windsurf: *Extensions* → `…` → *Install from VSIX…* → `paper-workspace-0.1.0.vsix`.

## Use the AI skill

[`SKILL.md`](SKILL.md) is an [Agent Skill](https://agentskills.io): it teaches an AI coding agent the workspace format
and how to read, explain and build canvases. The [`workflows/`](workflows/) folder next to it holds recipes the skill
reads when they apply (for now, [`code-change-canvas.md`](workflows/code-change-canvas.md) for a canvas of changed
code). The skill is two parts that must stay together:

```
paper-workspace/          ← the folder name must be exactly "paper-workspace" (the skill's name)
├── SKILL.md
└── workflows/
    └── code-change-canvas.md
```

### 1. Copy the skill into your project

Run these from the root of the project you want to use it in (replace `<paper-workspace>` with the path to this
repository). Commit the folder so your whole team gets it.

**Claude Code**: skills live in `.claude/skills/`.

```bash
mkdir -p .claude/skills/paper-workspace && cp -r <paper-workspace>/SKILL.md <paper-workspace>/workflows .claude/skills/paper-workspace/
```

**Codex, Cursor and Devin**: all three read the shared `.agents/skills/` folder.

```bash
mkdir -p .agents/skills/paper-workspace && cp -r <paper-workspace>/SKILL.md <paper-workspace>/workflows .agents/skills/paper-workspace/
```

Using several of these tools in one project? Copy it into `.agents/skills/` and also into `.claude/skills/` for Claude
Code. Devin reads `.claude/skills/` too, so a Claude Code copy alone is enough for Claude Code plus Devin.

**Just for you, in every project**: copy the same folder into your user skills folder instead:

| Tool | User skills folder |
|---|---|
| Claude Code | `~/.claude/skills/paper-workspace/` |
| Codex | `~/.agents/skills/paper-workspace/` |
| Cursor | `~/.cursor/skills/paper-workspace/` (or `~/.agents/skills/paper-workspace/`) |
| Devin | `~/.config/devin/skills/paper-workspace/` |

On Windows, `~` is your user folder (`C:\Users\<you>`), and you can copy the folder with the Explorer.

### 2. Customize the workflow (optional)

Open `workflows/code-change-canvas.md` in the copy you just made and edit **section 1, Conventions**: tag names,
colors, sticky note colors, and when to take screenshots. The steps read their values from that table, so this is
the only part you need to change. Leave `SKILL.md` as it is; it holds the format rules the extension relies on.

### 3. Use it

Start a new chat or session so the agent picks the skill up. It is used automatically when you ask about workspaces,
or you can call it by name:

| Tool | Call it explicitly |
|---|---|
| Claude Code | `/paper-workspace` |
| Codex | `$paper-workspace`, or pick it from `/skills` |
| Cursor | `/paper-workspace` in Agent chat |
| Devin | `@skills:paper-workspace` |

Things to try:

- "Create a workspace that explains how login works."
- "Create a canvas with the changes in the current branch." (uses the code change workflow)
- "Explain `.paperworkspace/Auth.workspace`."
- Right-click an item on a canvas → **Copy reference**, paste it into the chat, and ask "what does this do?" or "fix
  this".

### Updating

When `SKILL.md` or the workflows change in this repository, copy them again. If you customized a workflow, merge your
section 1 changes back in instead of overwriting them.

## Limitations (v0.1)

- Papers get completions, hovers, parameter hints and problems from VS Code's language services, plus Ctrl/Cmd+click
  go to definition. Other extension features (quick fixes, rename, CodeLens...) are not available inside papers yet
  (use *Open in text editor* on the paper header).
- Links, groups, layers, images and text notes are planned — see `DESIGN.md` in the source repository.
