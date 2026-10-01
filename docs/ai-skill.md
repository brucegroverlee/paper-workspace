# Use the AI skill

[`.agents/skills/paper-workspace`](../.agents/skills/paper-workspace/SKILL.md) is an [Agent Skill](https://agentskills.io):
it teaches an AI coding agent the workspace format and how to read, explain, build and update canvases. It is split
so the agent loads only what a task needs (resolving a pasted reference reads just `SKILL.md`; building a canvas adds
the create task and the format), and it ships two Node scripts the agent runs instead of reading raw JSON or checking
rules by hand. Keep the folder whole:

```
paper-workspace/          ← the folder name must be exactly "paper-workspace" (the skill's name)
├── SKILL.md              ← router + rules that always apply (always loaded)
├── tasks/                ← read.md, create.md, update.md (one per job)
├── reference/            ← format.md, concepts.md, visual-style.md (loaded on demand)
├── workflows/            ← team-customizable recipes, e.g. code-change-canvas.md
├── examples/             ← sample .workspace files
└── scripts/              ← outline.mjs (compact view of a canvas), validate.mjs (format checks); Node 18+
```

## 1. Copy the skill into your project

Run these from the root of the project you want to use it in (replace `<paper-workspace>` with the path to this
repository). Commit the folder so your whole team gets it.

**Claude Code**: skills live in `.claude/skills/`.

```bash
mkdir -p .claude/skills/paper-workspace && cp -r <paper-workspace>/.agents/skills/paper-workspace/. .claude/skills/paper-workspace/
```

**Codex, Cursor and Devin**: all three read the shared `.agents/skills/` folder.

```bash
mkdir -p .agents/skills/paper-workspace && cp -r <paper-workspace>/.agents/skills/paper-workspace/. .agents/skills/paper-workspace/
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

## 2. Customize the workflow (optional)

Open `workflows/code-change-canvas.md` in the copy you just made and edit **section 1, Conventions**: tag names,
colors, sticky note colors, and when to take screenshots. The steps read their values from that table, so this is
the only part you need to change. Leave the other files as they are; they hold the format rules the extension relies on.

## 3. Use it

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

## Updating

When the skill changes in this repository, copy the folder again. If you customized a workflow, merge your
section 1 changes back in instead of overwriting them.

