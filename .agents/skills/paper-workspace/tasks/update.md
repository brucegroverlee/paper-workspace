# Updating an existing workspace

Users often lay out a **plan** on a canvas (files involved, tags like `change` / `TODO` / `fix`, notes like "add the
new endpoint here", arrows) and ask you to implement it and "update the canvas". Then the canvas **is** the
deliverable: rework it in place so it tells the story of what now exists. Never leave it and draw a second canvas or
a second panel beside it.

You may move, retarget, retag, recolor and re-caption papers and add new ones, except protected items.

## When to edit in place

- The user asks to update, fix, reorganize or extend a workspace, or to implement what one describes → edit it.
- The user asks for a canvas of a change and one for the same work exists → ask once: "update `<name>` in place, or
  create a new workspace?"
- Otherwise → create a new one ([create.md](create.md)).

**Edit policy**: by default edit, then report. If the user or the workflow file says **ask first**, show a short plan
(moves, retargets, retags, additions, removals) and wait for a yes. Always ask before deleting something the user
made, and offer to keep it.

## 1. Read it

1. Copy the file to your scratchpad (the original, for `validate.mjs --original`).
2. `node <skill>/scripts/outline.mjs "<workspace>"`: the tree, tags, edges, and the `PROTECTED` / `LOCKED` items.
   Use `--node <id>` to see a marker's code and attachments. Read the raw JSON only for nodes you will edit.

## 2. Protected items: never change them

Protected = `locked: true`, a tag whose label (ignoring case/punctuation) is `Do not touch`, `Don't touch`,
`Do not change`, `Don't change`, `Do not modify`, `Keep`, `Keep as is`, `Read only`, `Frozen`, `Reference` or
`Baseline` (workflow files may add labels; pass them as `--protect "A,B"`), or inside such a container. Also anything
whose attached note or annotation says so ("don't move this") — the script can't see those, so check notes yourself.

Leave **every field** unchanged (position, size, parent, title, annotation, tags, colors, editors, targets, array
place). You may draw edges to/from them and lay the story out around them. Never put new children inside a protected
container. If the task needs a protected change, don't make it; say so and ask.

## 3. Read the user's markers as instructions

| Marker | Means | After the work |
|---|---|---|
| Tag `change`, `TODO`, `fix`, `update`, `implement` | This code must change | Replace with `Modified` / `New` + matching `headerColor`; drop the tag definition once unused |
| Caption / note "add X here", "move this to Y" | Where and what | Rewrite the caption to the result (`Modified · adds GET /orders/:id/items`); keep the user's note and mark it done (`Done: added in ordersRouter.ts:42`), or attach a small green note |
| User-drawn edge ("reuse this helper") | A relationship to keep | Keep it; repoint to the new editor if the code moved |
| `Do not touch` etc. | Protected | Unchanged |

## 4. Reuse papers; never duplicate

1. Index existing `file` nodes by path, `folder`s by directory, shapes/notes by text (outline gives you this).
2. A file already on the canvas keeps its paper: add an editor for new code (it becomes multi-snippet: recompute the
   stack and file size, see `reference/format.md`), or retarget its editor. Keep existing editor ids.
3. Move papers into the story (new `position` / `parent`, relative to the new container) instead of copying.
4. The user's folders are the lanes; new and moved papers from that location go inside. If that folder is protected,
   put the paper next to it, link it, and report it. If the user used groups for locations, keep them, make your own
   containers folders, and offer to convert theirs.
5. Update captions, tags and header colors on the existing paper; no "modified version" second paper.
6. Tests only if wanted, beside what they test. If a tests-only area you made exists, dissolve it.
7. Leftover scaffolding you created (empty "Analysis" group, stale arrows) can go; the user's items need a yes. Keep
   the user's analysis text as a note at the start of the story if it still matters.

## 5. Keep ids and references stable

Keep every existing node, edge and tag id (users paste references to them). New nodes get new readable ids. Reuse a
tag with the same meaning rather than defining another (the status tag replacing an instruction tag is the
exception). Keep top-level fields (`tagPlacement`, `showTags`, `customColors`).

## 6. Write, validate, report

1. Plan the new layout first: lane and column for each step, which existing paper fills it, what's new; protected
   items keep their spots, so plan around them.
2. Write the file (parents before children).
3. `node <skill>/scripts/validate.mjs "<workspace>" --original "<scratch copy>"`. It reports changed protected nodes,
   removed ids, children added inside protected containers, plus all format errors.
4. Report: path; what you moved, retargeted, retagged, added and removed; protected items left alone; anything you
   didn't change (protected, or waiting for a yes). If the canvas is open, it reloads from disk; the user should save
   first if they were editing it.
