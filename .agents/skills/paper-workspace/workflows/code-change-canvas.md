# Workflow: code change canvas

> **Customize section 1** (tag names, colors, screenshots, edit policy) for your team; the steps read their values
> from there. Where this file and the skill's `reference/visual-style.md` disagree about conventions, this file wins.

Use it for a canvas of **code that changed**: the current branch, this session's work, a feature / fix / PR, a code
review (section 4), or "implement the analysis on this canvas and update it" (step 0: edit in place).

Goal: someone who wasn't in the session understands in a couple of minutes **what was introduced, modified, removed
and why, how the pieces connect, and what it looks like**.

**Also read**: [../tasks/create.md](../tasks/create.md) (story lanes, layout math) and
[../reference/format.md](../reference/format.md) (JSON). If a canvas for this work already exists, read
[../tasks/update.md](../tasks/update.md) instead of `create.md`. You don't need `reference/visual-style.md`: the
conventions below cover it.

---

## 1. Conventions (customize here)

### Change status

Every changed paper gets **both** a status tag and the matching title bar color.

| Status | Tag id | Tag label | Tag `color` | Paper `headerColor` | Shown as |
|---|---|---|---|---|---|
| New | `t_new` | `New` | `#b6d7a8` | `#b2f2bb` | A `file` paper |
| Modified | `t_modified` | `Modified` | `#f9cb9c` | `#ffd6a5` | A `file` paper, one editor per changed hunk |
| Deleted | — | — | — | — | A red sticky note (`#ea9999`), since the file is gone |
| Renamed / moved | `t_modified` | `Modified` | as Modified | as Modified | The new path; annotation `Moved from <old path>` |
| Unchanged context | — | — | — | leave it out | Default title bar, only when needed to follow the flow |

### Role tags (only the ones the canvas needs)

| Tag id | Label | Color | Use for |
|---|---|---|---|
| `t_entry` | `Entry point` | `#a4c2f4` | Where the reader starts (route, UI event, command) |
| `t_test` | `Test` | `#b4a7d6` | Test files, only when tests are on the canvas; title bar by status as usual |
| `t_config` | `Config` | `#a2c4c9` | Config, migrations, build or CI files |

### Review tags (code review mode only)

| Tag id | Label | Color |
|---|---|---|
| `t_review` | `Needs review` | `#ffe599` |
| `t_risk` | `Risk` | `#ea9999` |

### Tests

| Setting | Value | Meaning |
|---|---|---|
| Include test files | `ask` | Ask once. `no` = always leave out (listed in the verify note); `yes` = always add |
| Placement | `beside subject` | Right next to / under the paper it tests, same folder when its path fits, dotted `tests` edge. Never a tests area |

### Sticky notes

| Purpose | `color` |
|---|---|
| Summary of the change (under the title) | `#ffec99` |
| Deleted file | `#ea9999` |
| Risk, breaking change, follow-up | `#ffc9c9` |
| How to verify | `#b2f2bb` |
| Background / good to know | `#c5e3ff` |

### Screenshots

- One per **new or modified view** (page, screen, form step, dialog, component with visible output).
- File name `<kebab-case-view-name>.png`, e.g. `signup-step-address.png`.
- Linked to the paper that renders it with a dotted, arrowless `renders` edge.

### Editing an existing canvas

| Setting | Value | Meaning |
|---|---|---|
| Edit policy | `edit` | Edit in place, then report. `ask-first` = show a plan and wait for a yes. Deleting the user's items always needs a yes |
| Protection tags | `Do not touch`, `Don't change`, `Keep`, `Reference` | Never moved, retagged, retargeted or deleted. Add your labels here (and pass extra ones to `validate.mjs --protect`) |
| Instruction tags | `change`, `TODO`, `fix`, `implement` | "Change this code"; replaced by `Modified` / `New` once done |

### Other defaults

- Name: `Change - <short summary>` (e.g. `.paperworkspace/Change - address step.workspace`).
- Layout: **story lanes**; a **`folder` per child project or directory** touched (the lanes); a `group` only for a
  cross-folder domain, external systems, the legend. Never a group named after a project or directory.
- `tagPlacement: "top"`.
- At most 3 editors per file; merge hunks closer than ~10 lines into one target.
- One paper per file: a file already on the canvas gets another editor, never a second paper.

---

## 2. Steps

### Step 0: Start from the existing canvas, if there is one

If the user pointed at a workspace (path, reference, "this canvas", "my analysis"), or one already covers this work,
**update it** following `tasks/update.md`: list protected items and instruction markers (they say what the change is
meant to be), reuse its papers in steps 3–5 (a changed file with a paper gets an editor per hunk and its status tag,
moved into its lane and column), and turn the plan area into one left → right story. Apply the edit policy above.

### Step 1: Collect the change set (cheaply)

- **Branch**: base = `git merge-base HEAD origin/main` (or the branch named), then
  `git diff --name-status -M <base>...HEAD`, plus `git status --porcelain` for uncommitted work.
- **This session**: the files you touched, confirmed with `git status`.
- **A PR**: `gh pr diff <n> --name-only` and `gh pr view <n>`.

Classify: `A` New, `M` Modified, `D` Deleted, `R` Renamed. Drop noise (lockfiles, generated files, formatting-only
changes, snapshots) unless it matters. Set test files apart and apply the *Include test files* setting (with `ask`:
"The change has N test files. Add them next to the code they test, or list them in the verify note?").

### Step 2: Understand what the change does

- Read the commit messages / PR description for intent, then `git diff -U0 <base> -- <file>` per file (hunks only);
  read surrounding code by range only where a hunk isn't self-explanatory.
- Find the **run-time order** (entry → logic → storage/output); that order is the layout.
- Find relationships between changed files (calls, imports, renders, navigates, emits, tests) → edges.
- For each **deleted** file, find why and what replaced it (renames via `-M`, moved code, commit messages, switched
  imports). If unknown, write "Reason: unknown".

### Step 3: Pick the snippets

- **Modified**: target the changed hunks; the `+start,count` of each `@@` header in `git diff -U0` gives current
  line numbers. One editor per meaningful hunk, each captioned with what it changes.
- **New**: target the key function / component / export, not the whole file.
- `anchor` = trimmed first target line (from the `-U0` output or a 1-line read).
- A hunk adding a whole new function may carry `New` on its editor while the file carries `Modified`.
- Tags and `headerColor` on the `file` when it has one editor, on each `editor` when hunks differ in status.

### Step 4: Tag and color

Status tag + matching `headerColor` on every changed paper; `Entry point` always; other role tags where they help.
Context papers stay untagged with the default title bar. Define only the tags used.

### Step 5: Diagram and relationships

- Story lanes (`tasks/create.md`): one `folder` lane per project/directory crossed, one column per step in run-time
  order, from the user action on the left to storage / external API on the right. `group` lanes only for things with
  no single location. When updating, the user's folders are the lanes.
- Edges from step 2, labeled with verb + data (`calls`, `GET /orders/:id/items`, `returns OrderItem[]`,
  `renders step 2`, `emits <event>`, `tests`): solid for calls, dashed for async/events/returns, dotted for `tests`
  and `renders`.
- Number annotations in run-time order: `1 · Modified: adds the Address step`.
- Steps with no code in the change (a user action, an external API) get a shape (`actor`, `cloud`, `terminator`).

### Step 6: Deleted files

A red note (`#ea9999`) next to its replacement (or in its old folder):

```
Deleted: src/signup/AddressModal.tsx
Why: the address is now a wizard step, not a modal.
Replaced by: src/signup/StepAddress.tsx
```

Dashed `replaced by` edge to the replacement; with none, `Replaced by: nothing` and no edge.

### Step 7: Screenshots

For each new or modified view:

1. Run the app (the project's dev server) and navigate there, filling earlier steps with test data. Use the session's
   browser (built-in or Claude in Chrome). This can be delegated to a separate agent while you build the canvas.
2. Save it to `.paperworkspace/media/<Workspace Name>/<name>.png`. If the browser tool can't write files, use
   `npx playwright screenshot --viewport-size=1280,800 <url> <path>`, or ask the user to paste the image on the
   canvas (Ctrl+V) and link the media node it creates.
3. `media` node: width 480, height by aspect ratio (480×300 for 1280×800), annotation `Screenshot · <view>`, right of
   or below its paper, dotted arrowless `renders` edge.
4. Never capture real personal data, secrets or tokens.

If the app can't run, skip screenshots and say so in the summary note. Never invent an image.

### Step 8: Summary, legend, verification

- **Title** `Change: <what it does>`; **subtitle**: one sentence + where to start (the `Entry point`).
- **Summary note** (yellow) under the title: 3–5 lines, one per notable change.
- **Legend** group (grey, near the title): one row per title bar color used, plus "Red note: deleted file".
- **How to verify** note (green): test command, test files (if their papers were left out), manual steps.
- **Risk / follow-up** notes (pink) attached to their snippet.

### Step 9: Validate and report

Run `node <skill>/scripts/validate.mjs "<workspace>"` (add `--original <copy>` when you updated a canvas). Then check
what it can't:

- [ ] Every changed file appears **once**: a paper (new/modified/renamed) or a red note (deleted).
- [ ] Every changed paper has exactly one status tag and the matching `headerColor`; no instruction tag is left on
      finished work.
- [ ] Every changed paper sits in its project/directory `folder`.
- [ ] Tests only if wanted, each beside its subject.
- [ ] Modified files' editors target real changed lines.

Report the path, a two-line summary, and the count of new / modified / deleted files.

---

## 3. Layout

```
Title + subtitle
Summary note · Legend · (the user's analysis note, if updating)

                     1              2                 3                 4              5
                  ┌────────────────────────────────────────────────────────────────────────┐
 folder project-a │ [actor] → [OrderButton] → [OrderDialog] → [queries.ts][queries.test]    │
                  │                          screenshot above                               │
                  ├────────────────────────────────────────────────────────────────────────┤
 folder project-b │                                            └→ [ordersRouter.ts] → [service.ts]
                  ├────────────────────────────────────────────────────────────────────────┤
 group External   │                                                         (cloud: Payment API)
                  └────────────────────────────────────────────────────────────────────────┘
       deleted-file notes next to their replacement · risk notes next to their snippet · Verify note at the end
```

Read left → right along the flow; lanes only say where a step runs. No separate panels for "implementation",
"tests" or "files".

---

## 4. Code review mode

For reviewing someone else's change, everything above applies, plus:

- `Needs review` on papers a reviewer must read carefully, `Risk` where you found a problem.
- Each review comment is a pink note (`#ffc9c9`) attached with a dotted edge, starting with the location:
  `src/signup/StepAddress.tsx:42 — zip code is not validated`. Questions for the author: yellow notes starting `Q:`.
- End with a verdict note (e.g. "2 blocking, 3 nits").

---

## 5. Example

[../examples/code-change.workspace](../examples/code-change.workspace) (open only if unsure of the JSON shape): an
Address step added to a sign-up wizard, with one modified file, one new view with a screenshot, a new test (the user
said yes to tests), and a deleted modal. Notice: green/orange title bars match the `New`/`Modified` tags; the red
deleted note points at its replacement with `replaced by`; the test paper sits directly under its subject, just
outside the `src/signup` folder because its path isn't under it; folder width = 696 + 640 + 16 = 1352.
