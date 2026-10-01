---
name: paper-workspace
description: Read, explain, create and update Paper Workspace canvases (`.paperworkspace/*.workspace` JSON files) and resolve pasted `paperworkspace:...#type/id` references. Use when the user asks what a workspace shows, pastes such a reference, wants a flow or piece of code explained visually, wants a canvas of changed code (branch, session, feature, PR, review), or asks to implement or update from a plan laid out on a canvas.
---

# Paper Workspace

A VS Code / Cursor / Windsurf extension that lays code out "like papers on a desk": an infinite canvas of **live
snippets of real files** plus folders, groups, shapes, sticky notes, text, media and arrows. Each canvas is a JSON
file at `.paperworkspace/<Name>.workspace` (project root), committed as documentation that points at real code.

## Load only what the task needs

This file is a router. Read the files for your task from the table, **and nothing else**. Paths are relative to this
skill's folder (`<skill>` below).

| Task | Read | Run |
|---|---|---|
| **Resolve a pasted reference** (`paperworkspace:…#type/id`) | nothing more | `outline.mjs "<reference>"` |
| **Explain / read a workspace** | [tasks/read.md](tasks/read.md) | `outline.mjs <ws> --code` |
| **Create a workspace** (a flow, a feature) | [tasks/create.md](tasks/create.md), [reference/format.md](reference/format.md) | `validate.mjs <ws>` |
| **Canvas of changed code** (branch, session, PR, review) | [workflows/code-change-canvas.md](workflows/code-change-canvas.md), then what it points to | `validate.mjs <ws>` |
| **Update / implement from a canvas** | [tasks/update.md](tasks/update.md), [reference/format.md](reference/format.md) | `outline.mjs`, `validate.mjs --original` |

On demand only:

- [reference/concepts.md](reference/concepts.md): what each element *means* in the story (read it when the meaning
  of an element is unclear, or before designing a canvas from scratch).
- [reference/visual-style.md](reference/visual-style.md): shape ids, palette, colors / tags / notes / edge-style
  conventions, legend. Needed when you choose shapes or colors.
- [examples/](examples/): complete sample files (`login-flow.workspace`, `code-change.workspace`). Open one only if
  you are unsure how a structure looks in JSON.
- Other files in [workflows/](workflows/): team recipes for specific canvases. Check their titles; a matching
  workflow's conventions override the defaults.

## Helper scripts (use them instead of reading raw JSON)

Node 18+, no install. Run from the project root:

```bash
node <skill>/scripts/outline.mjs ".paperworkspace/My canvas.workspace"            # tree, tags, edges, drift
node <skill>/scripts/outline.mjs ".paperworkspace/My canvas.workspace" --code     # + every snippet's target lines
node <skill>/scripts/outline.mjs "paperworkspace:.paperworkspace/My canvas.workspace#editor/e_verify"
node <skill>/scripts/validate.mjs ".paperworkspace/My canvas.workspace" [--original <copy>]
```

- `outline` prints one line per node (type, id, path or text, target range, caption, tags, colors, position,
  `PROTECTED`/`LOCKED`, `DRIFT→Lnn` when an anchor moved), then the edges. With a reference or `--node <id>`, it
  prints just that item, its containers, children, edges and the code at its target.
- `validate` checks the format rules mechanically (ids, parents, paths, targets/anchors, editor geometry, container
  fit, overlaps, tags, edges, colors, and with `--original` protected items and lost ids). Fix every `ERROR`; judge
  each `WARN`.
- If Node isn't available, fall back to reading the JSON and checking by hand (rules in `reference/format.md`).

## Token discipline

- Prefer `outline.mjs` over reading a `.workspace` file; read the raw JSON only around the nodes you will edit.
- Read source code by **range** (the target ± a few lines, e.g. `Read` with offset/limit, `sed -n`), not whole files.
- For a change set, use `git diff --name-status` and `git diff -U0` hunks, not full diffs of every file.
- Don't open examples, concepts or visual-style unless the task needs them. Don't re-read files you just wrote:
  run `validate.mjs` instead.
- Write the workspace once, from a planned outline, rather than many incremental edits.

## Rules that always apply

1. **The code is the content.** Explain a snippet from its target lines, never from its file name alone. Every
   `target` / `anchor` you write comes from reading the real file.
2. **One paper per file.** A path appears in one `file` node, with as many `editor`s as needed; a directory in one
   `folder`. Never build a parallel panel that repeats papers.
3. **Folder = where code lives; group = what belongs together** (domain, phase, legend, shapes). A group titled with a
   project or directory name should be a folder.
4. **Protected items are untouchable**: `locked: true`, a tag like `Do not touch` / `Keep` / `Reference` /
   `Baseline` (outline marks them `PROTECTED`), and everything inside them. You may draw edges to them, nothing else.
5. **Edit canvases in place**; keep every existing id (users paste references to them); ask before deleting anything
   the user made.
6. **Tests stay off the canvas unless the user wants them**, and then sit beside the paper they test, never in a
   "Tests" area.
7. After writing, run `validate.mjs`, then tell the user the path, a two-line summary of the tour, and what the
   tags/colors mean. The canvas reloads from disk if open (unsaved canvas edits may conflict).

## Reference format

`paperworkspace:<workspace path>` (whole workspace) or `paperworkspace:<workspace path>#<type>/<node id>` (one item).
The path is relative to the project root and may contain spaces; it ends at the **last** `#`.

To resolve one: run `outline.mjs "<reference>"`. If the id is gone, it lists the closest candidates; say so. If the
type differs, trust the id and mention it. Then do what the user asked about **that item** (fix, explain, why is it
here), citing `path:line`, using its caption, tags, containers and edges as context. Don't re-explain the whole
workspace unless asked. When you mention items of a workspace yourself, give their references in this format.
