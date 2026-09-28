# Workflow: code change canvas

> **This file is meant to be customized.** It is a starting point for a team's "show me the change" canvas. Edit the
> conventions in section 1 (tag names, colors, what gets a screenshot) to match your team; the steps below read them
> from there. The foundational rules (file format, layout math, references, validation) live in
> [`../SKILL.md`](../SKILL.md) and apply unchanged. Where this file and `SKILL.md` disagree about *conventions*, this
> file wins.

Use this workflow when the user asks for a canvas of **code that changed**, for example:

- "Create a workspace with the changes in the current branch."
- "Make a canvas of what you did in this session."
- "Document this feature / fix / PR as a workspace."
- "Build a review canvas for this PR" (see section 4, *Code review mode*).

The goal: someone who wasn't in the work session opens the canvas and understands in a couple of minutes **what was
introduced, what was modified, what was removed and why, how the pieces connect, and what it looks like**.

---

## 1. Conventions (customize here)

### Change status

Every changed paper gets **both** a status tag (the words) and the matching title bar color (the at-a-glance version).

| Status | Tag id | Tag label | Tag `color` | Paper `headerColor` | Shown as |
|---|---|---|---|---|---|
| New | `t_new` | `New` | `#b6d7a8` (green) | `#b2f2bb` (green) | A `file` paper |
| Modified | `t_modified` | `Modified` | `#f9cb9c` (orange) | `#ffd6a5` (orange) | A `file` paper, one editor per changed hunk |
| Deleted | — | — | — | — | A red sticky note (`color` `#ea9999`), since the file is gone |
| Renamed / moved | `t_modified` | `Modified` | as Modified | as Modified | The new path as a paper; the annotation says `Moved from <old path>` |
| Unchanged context | — | — | — | leave it out | A paper with the default title bar, only when needed to follow the flow |

### Role tags (optional, add only the ones the canvas needs)

| Tag id | Label | Color | Use for |
|---|---|---|---|
| `t_entry` | `Entry point` | `#a4c2f4` | Where the reader should start (route, UI event, command) |
| `t_test` | `Test` | `#b4a7d6` | Test files; give their papers `headerColor` `#b2f2bb`/`#ffd6a5` by status as usual |
| `t_config` | `Config` | `#a2c4c9` | Config, migrations, build or CI files |

### Review tags (code review mode only)

| Tag id | Label | Color |
|---|---|---|
| `t_review` | `Needs review` | `#ffe599` |
| `t_risk` | `Risk` | `#ea9999` |

### Sticky notes

| Purpose | `color` |
|---|---|
| Summary of the change (top-left, under the title) | `#ffec99` (yellow) |
| Deleted file | `#ea9999` (red) |
| Risk, breaking change, follow-up | `#ffc9c9` (pink) |
| How to verify | `#b2f2bb` (green) |
| Background / good to know | `#c5e3ff` (blue) |

### Screenshots

- Take one for every **new or modified view** (page, screen, form step, dialog, component with visible output).
- Name files `<kebab-case-view-name>.png`, e.g. `signup-step-address.png`.
- Link each screenshot to the paper that renders it with a dotted, arrowless edge labeled `renders`.

### Other defaults

- Workspace name: `Change - <short summary>` (e.g. `.paperworkspace/Change - address step.workspace`).
- `tagPlacement: "top"`, so tag chips stay on the title row when papers sit side by side.
- At most 3 editors per file; merge hunks closer than ~10 lines into one target.

---

## 2. Steps

### Step 1: Collect the change set

Work out exactly what changed before drawing anything.

- **Current branch**: find the base (`git merge-base HEAD origin/main`, or the branch the user names), then
  `git diff --name-status -M <base>...HEAD`. Add uncommitted work with `git status --porcelain`.
- **This session**: the files you created, edited and deleted, confirmed with `git status` / `git diff`.
- **A PR**: `gh pr diff <number> --name-only` and `gh pr view <number>` for the description.

Classify each path with the table in section 1: `A` = New, `M` = Modified, `D` = Deleted, `R` = Renamed. Drop
noise (lockfiles, generated files, formatting-only changes, snapshots) unless the user wants it or it matters.

### Step 2: Understand what the change does

- Read the diff and the new code; read the commit messages and PR description for the intent.
- Find the **run-time order**: entry point → logic → storage/output. That order, not the alphabet, is the layout.
- Find the **relationships between changed files**: who calls, imports, renders, navigates to, emits to, or tests
  whom. These become edges.
- For every **deleted** file, find *why* it was removed and *what replaced it*: look for renames (`-M`), code that
  moved into another file, commit messages, and imports that were switched to a new module. If you can't tell, say
  "Reason: unknown" rather than guessing.

### Step 3: Pick the snippets (highlight the change)

- **Modified files**: target the changed hunks. Get the line numbers in the **current** file from
  `git diff -U0 <base> -- <file>` (the `+start,count` part of each `@@` header). One editor per meaningful hunk,
  each with an annotation saying what that hunk changes.
- **New files**: target the key function, component or export, not the whole file.
- Read the target lines to set `anchor` (trimmed text of the first target line).
- In a modified file, a hunk that adds a whole new function may carry the `New` tag on its editor while the file
  carries `Modified`.
- Tags and `headerColor` go on the `file` when it has one editor (single-editor files show the file's), and on each
  `editor` when a file's hunks have different statuses.

### Step 4: Tag and color every changed paper

Apply section 1: status tag + matching `headerColor` on every changed paper, role tags where they help the reader
(always mark the `Entry point`). Leave context papers untagged with the default title bar. Define only the tags the
canvas uses.

### Step 5: Build the diagram and the relationships

- Group papers with a `folder` per directory the change touched (or a `group` per layer when the change is small
  and concepts matter more than paths).
- Draw the edges found in step 2, labeled with a verb: `calls`, `imports`, `renders step 2`, `navigates to`,
  `emits <event>`, `tests`. Solid for calls and control flow, dashed for async/events, dotted for `tests` and
  `renders`.
- Number the annotations in run-time order: `1 · Modified: adds the Address step`.
- When the flow has steps with no code in the change (a user action, an external API), add a shape for them
  (`actor`, `cloud`, `terminator`) so the story has no gaps.

### Step 6: Represent deleted files

For each deleted file, add a red sticky note (`#ea9999`) in this form, placed next to its replacement (or in the
folder it used to live in):

```
Deleted: src/signup/AddressModal.tsx
Why: the address is now a wizard step, not a modal.
Replaced by: src/signup/StepAddress.tsx
```

Link it to the replacement paper with a dashed edge labeled `replaced by`. With no replacement, write
`Replaced by: nothing` and leave the edge out.

### Step 7: Screenshots of what changed

For each new or modified view (section 1, *Screenshots*):

1. Make sure the app runs (start its dev server the way the project does) and navigate to the view, filling earlier
   form steps with test data if needed. Use the browser the session has: the built-in browser or Claude in Chrome.
   This can be delegated to a separate agent while you build the rest of the canvas.
2. Capture the view and save it as a file in the workspace's media folder:
   `.paperworkspace/media/<Workspace Name>/<name>.png` (the workspace file's name without `.workspace`). If the
   browser tool only shows you the screenshot and can't write it to disk, save it with a command-line capture instead
   (for example `npx playwright screenshot --viewport-size=1280,800 <url> <path>`), or ask the user to paste the image
   onto the canvas (Ctrl+V) and then link the media node it creates.
3. Add a `media` node: `src` = that path, width 480 and height by the image's aspect ratio (e.g. 480×300 for
   1280×800), and an annotation such as `Screenshot · new Address step`. Place it right of or below the paper that
   renders it and link them with a dotted, arrowless `renders` edge.
4. Don't capture screens that show real personal data, secrets or tokens; use test data.

If the app can't be run, skip screenshots and say so in the summary note instead of inventing an image.

### Step 8: Summary, legend and verification

- **Title**: `Change: <what it does>`; **subtitle**: one sentence plus where to start (the `Entry point`).
- **Summary note** (yellow) under the title: 3–5 lines, one per notable change.
- **Legend** group (see `SKILL.md` 5.4) with one row per title bar color used, plus "Red note: deleted file".
- **How to verify** note (green): the test command and the manual steps.
- **Risk / follow-up** notes (pink) attached to the snippet they are about.

### Step 9: Validate and report

Run the checklist in `SKILL.md` 5.8, and also check:

- [ ] Every changed file of the change set appears: as a paper (new/modified/renamed) or a red note (deleted).
- [ ] Every changed paper has exactly one status tag and the matching `headerColor`.
- [ ] Every modified file's editors target its real changed lines in the current file.
- [ ] Every `media` `src` exists on disk.

Then report the workspace path, a two-line summary, and the count of new / modified / deleted files.

---

## 3. Layout

```
┌ Title + subtitle ───────────────────────────────────────────────┐
│ Summary note   │ folder / layer 1 → folder / layer 2 → …   │ Screenshots │
│ Legend         │   papers in run-time order, edges between │ (linked to  │
│                │                                            │  their view)│
│                │ Deleted notes (near their replacement) · Tests · Verify note │
└─────────────────────────────────────────────────────────────────┘
```

Reading order is left → right, top → bottom. Tests go in a row below the code they test, linked with `tests` edges.

---

## 4. Code review mode

When the canvas is for reviewing someone's change rather than documenting your own:

- Everything above still applies.
- Add `Needs review` to the papers a reviewer must read carefully, and `Risk` where you found a problem.
- Write each review comment as a pink note (`#ffc9c9`) attached to the snippet with a dotted edge, starting with the
  location: `src/signup/StepAddress.tsx:42 — zip code is not validated`. Questions for the author go in yellow notes
  starting with `Q:`.
- End with a note summarizing the verdict (e.g. "2 blocking, 3 nits").

---

## 5. Example

A branch that added an Address step to a sign-up wizard: one modified file, one new view with a screenshot, a new
test, and a deleted modal it replaced.

```json
{
  "version": 2,
  "tags": [
    { "id": "t_new", "label": "New", "color": "#b6d7a8" },
    { "id": "t_modified", "label": "Modified", "color": "#f9cb9c" },
    { "id": "t_entry", "label": "Entry point", "color": "#a4c2f4" },
    { "id": "t_test", "label": "Test", "color": "#b4a7d6" }
  ],
  "tagPlacement": "top",
  "nodes": [
    { "id": "title", "type": "text", "text": "Change: address step in the sign-up wizard", "fontSize": 36, "fontWeight": 700,
      "position": { "x": 0, "y": 0 }, "width": 900, "height": 50 },
    { "id": "subtitle", "type": "text", "text": "The wizard gets a second step for the address; the old address modal is gone. Start at Wizard.tsx (Entry point).",
      "color": "#3d4450", "fontSize": 16, "position": { "x": 0, "y": 56 }, "width": 1100, "height": 28 },

    { "id": "n_summary", "type": "note",
      "text": "What changed\n• New Address step (2 of 3)\n• Wizard lists 3 steps\n• Address modal removed",
      "position": { "x": 0, "y": 110 }, "width": 292, "height": 140 },

    { "id": "g_legend", "type": "group", "title": "Legend", "color": "#e5e5e5",
      "position": { "x": 0, "y": 290 }, "width": 292, "height": 248 },
    { "id": "s_leg_new", "type": "shape", "parent": "g_legend", "shape": "rectangle", "text": "Title bar: new",
      "color": "#b2f2bb", "position": { "x": 16, "y": 52 }, "width": 260, "height": 36 },
    { "id": "s_leg_modified", "type": "shape", "parent": "g_legend", "shape": "rectangle", "text": "Title bar: modified",
      "color": "#ffd6a5", "position": { "x": 16, "y": 100 }, "width": 260, "height": 36 },
    { "id": "s_leg_deleted", "type": "shape", "parent": "g_legend", "shape": "rectangle", "text": "Red note: deleted file",
      "color": "#ea9999", "position": { "x": 16, "y": 148 }, "width": 260, "height": 36 },
    { "id": "s_leg_context", "type": "shape", "parent": "g_legend", "shape": "rectangle", "text": "Default: unchanged context",
      "position": { "x": 16, "y": 196 }, "width": 260, "height": 36 },

    { "id": "d_signup", "type": "folder", "folder": "src/signup",
      "position": { "x": 340, "y": 110 }, "width": 1352, "height": 402 },
    { "id": "f_wizard", "type": "file", "parent": "d_signup", "file": "src/signup/Wizard.tsx",
      "headerColor": "#ffd6a5", "tags": ["t_modified", "t_entry"], "annotation": "1 · Modified: adds the Address step",
      "position": { "x": 16, "y": 56 }, "width": 640, "height": 260 },
    { "id": "e_wizard", "type": "editor", "parent": "f_wizard", "target": { "start": 12, "end": 24 },
      "anchor": "const steps = [",
      "position": { "x": 0, "y": 40 }, "width": 640, "height": 220 },
    { "id": "f_address", "type": "file", "parent": "d_signup", "file": "src/signup/StepAddress.tsx",
      "headerColor": "#b2f2bb", "tags": ["t_new"], "annotation": "2 · New: validates and saves the address",
      "position": { "x": 696, "y": 56 }, "width": 640, "height": 300 },
    { "id": "e_address", "type": "editor", "parent": "f_address", "target": { "start": 8, "end": 26 },
      "anchor": "export function StepAddress({ onNext }: StepProps) {",
      "position": { "x": 0, "y": 40 }, "width": 640, "height": 260 },

    { "id": "m_address", "type": "media", "src": ".paperworkspace/media/Change - address step/signup-step-address.png",
      "annotation": "Screenshot · new Address step",
      "position": { "x": 1792, "y": 166 }, "width": 480, "height": 300 },

    { "id": "n_deleted_modal", "type": "note", "color": "#ea9999",
      "text": "Deleted: src/signup/AddressModal.tsx\nWhy: the address is now a wizard\nstep, not a modal.\nReplaced by: StepAddress.tsx",
      "position": { "x": 340, "y": 612 }, "width": 320, "height": 130 },

    { "id": "f_test", "type": "file", "file": "test/signup/StepAddress.test.tsx",
      "headerColor": "#b2f2bb", "tags": ["t_new", "t_test"], "annotation": "3 · Required fields block Next",
      "position": { "x": 1036, "y": 612 }, "width": 640, "height": 240 },
    { "id": "e_test", "type": "editor", "parent": "f_test", "target": { "start": 6, "end": 18 },
      "anchor": "it('keeps Next disabled until the address is complete', async () => {",
      "position": { "x": 0, "y": 40 }, "width": 640, "height": 200 },

    { "id": "n_verify", "type": "note", "color": "#b2f2bb",
      "text": "How to verify\nnpm test -- StepAddress\nthen open /signup → step 2",
      "position": { "x": 1792, "y": 612 }, "width": 280, "height": 110 }
  ],
  "edges": [
    { "id": "l_wizard_address", "source": "e_wizard", "sourceSide": "right", "target": "e_address", "targetSide": "left", "label": "renders step 2" },
    { "id": "l_screenshot", "source": "m_address", "sourceSide": "left", "target": "e_address", "targetSide": "right", "dash": "dotted", "endMarker": "none", "label": "renders" },
    { "id": "l_replaced", "source": "n_deleted_modal", "sourceSide": "right", "target": "f_address", "targetSide": "bottom", "dash": "dashed", "label": "replaced by" },
    { "id": "l_test", "source": "e_test", "sourceSide": "top", "target": "e_address", "targetSide": "bottom", "dash": "dotted", "label": "tests" }
  ]
}
```

Things to notice:

- Green title bar + `New` tag, orange title bar + `Modified` tag, red note for the deleted file: status reads
  from across the room and up close.
- The deleted modal points at its replacement with `replaced by`; the screenshot hangs off the view that renders it.
- Folder math: papers at `{16, 56}` and 40px apart (16 + 640 + 40 = 696), folder width 696 + 640 + 16 = 1352,
  height 56 + 300 + 30 (caption) + 16 = 402.

In a real canvas, every `target` and `anchor` comes from the actual diff and file, and every screenshot is a real
capture saved under `.paperworkspace/media/<Workspace Name>/`.
