# Reading and explaining a workspace

For a single pasted reference, `SKILL.md` (section *Reference format*) is enough; you don't need this file.

## Steps

1. **Find it.** Workspaces are `.paperworkspace/*.workspace` at the project root. If there are several and the user
   didn't say which, list them by name and ask.
2. **Outline it**: `node <skill>/scripts/outline.mjs "<workspace>" --code`. This gives the tree (positions relative to
   parent), tags with usage counts, protected items, edges, and each editor's target lines with `>` marking the
   highlighted ones. `DRIFT→Lnn` means the anchor moved (the code shown is already shifted to it); `ANCHOR-LOST` /
   `FILE-MISSING` mean the snippet is stale. For a large canvas, run it without `--code` first and use
   `--node <id>` for the snippets you need.
3. **The code is the content.** Explain each snippet from its lines. Read more of a file (by range) only when the
   target alone doesn't explain the step.
4. **Recover the intent**, roughly in this order: big bold `text` near the top-left (title, the question answered);
   group and folder titles (areas: layers, phases, modules); notes (explanations, warnings, decisions, open
   questions; a note inside a container is about that area, one linked by an edge is about that item); annotations
   (role and step number); tags (categories the author wanted scannable); edge labels (relationships).
5. **Decode the encoding.**
   - Group papers by `headerColor` / `color` and find what they share. Prefer an explicit legend (a `Legend` group,
     notes, shapes or tags naming the colors) over inference, and say when you are inferring.
   - Arrows go source → target (a `startMarker` arrow means both ways).
   - Common dash convention: solid = call/control flow, dashed = async/event/return, dotted = related / implemented
     by / see also. Report what this canvas actually uses.
   - Shapes: `terminator` start/end, `diamond` decision (outgoing labels are branches), `cylinder` storage,
     `parallelogram` data in/out, `actor` user/external, `cloud` external service, `predefined-process` call into
     another module.
   - Layout order: left → right or top → bottom; nearby things are related.
6. **Walk the graph** from the entry points (an `Entry point` tag, nodes with no incoming edges, `terminator`s,
   `actor`s, annotation `1 ·`) along edges and step numbers. That order is the story.

If an element's meaning is still unclear, see [../reference/concepts.md](../reference/concepts.md).

## Explain it in this order

- **Purpose** (1–2 sentences): the question answered or the change documented.
- **Map**: the areas (groups, folders) and what each holds.
- **Walkthrough**: step by step, citing `path:line`, what each snippet does in that step, and what its tags/colors say.
- **Notation**: what tags, colors, dashes and shapes mean here, if not obvious.
- **Gaps**: stale targets, missing files, unused tags, colors without a legend, dangling ideas in notes, steps the
  diagram skips that you can see in the code.

For a follow-up about one node, run `outline.mjs <ws> --node <id>` and answer from the code at its target.
