# Mental model: a workspace describes a workflow

A workspace is **not a pile of files**. It is an argument or a tour: "this is how X works" or "this is what changed
and why". Every element has a job in that story. When you read a canvas, recover those jobs; when you build one,
pick each element for its job.

## What each element means

| Element | Its job | Read it as | Use it for |
|---|---|---|---|
| **`text`** (large, bold) | Title, headings | "The question this canvas / area answers" | One title top-left; optional section headings |
| **`file` + `editor`** | Evidence: the real code | "This is where it happens" | A step of the flow; `target` = the exact lines that matter |
| **`folder`** | **Where** code lives | "These papers live in this directory" | Every grouping by location: a child project (`project-b`), a package, a module (`src/auth`) |
| **`group`** | **What** belongs together, regardless of location | "A domain, a phase, a concept, a legend" | Domains spanning places ("Billing"), phases (Before / After), shapes-only areas |
| **`note`** | The author's voice | Why, gotchas, decisions, open questions, TODOs | Anything a caption can't say in one phrase |
| **`annotation`** | Label for one box | Its role, often a step number | Every snippet: `1 · Validates the token` |
| **`tags`** | Categories across the layout | "This paper is *New* / *Entry point* / *Risk*" | Status and role, scannable anywhere |
| **`headerColor`** | Pre-attentive category | "Same color = same kind" | One dimension (usually change status), explained in a legend |
| **`color`** (body) | Area tint | "This region is layer X" | One tint per layer or subsystem |
| **`shape`** | Step or thing without code | Flowchart meaning (decision, storage, actor…) | High-level flow, external systems |
| **edge** | Relationship | "calls", "emits", "on error", "see also" | Every meaningful connection; the label is the verb |
| **`media`** | What the user sees | The visible result | UI screenshots, before/after |
| **`locked`** | Reference material | "Baseline, don't edit" | Only when the user asks |

## Relationships

1. **Containment** (`parent`): a box belongs to its container's scope. A note inside a group/folder is about that
   whole area; a file inside a folder is a file of that directory; several editors in one file are several parts of
   it that matter; nested containers refine scope.
2. **Edges**: direction is flow or dependency. Dash style and color carry meaning. A dotted arrowless edge from a
   note *attaches* the comment to that code.
3. **Shared tags / colors**: same category wherever the papers sit ("these 4 files are new") without moving them.
4. **Proximity and order**: nearby = related; flows read left → right or top → bottom; numbered annotations make the
   order explicit.

Layout encodes *structure*; tags and colors encode *categories*; notes and annotations carry *reasoning*; edges carry
*relationships*. Use each channel for one purpose.

## Folder or group?

- **Papers that share a location go in a `folder`** (the default for code). In a workspace of child projects
  (top-level dirs with their own `package.json`, `pom.xml`, `.git`…), **each project the story touches gets its own
  folder**. Nest a sub-folder only when it helps.
- **A `group` is for meaning**: papers that belong together but live in different places, or areas with no code
  (flowchart, legend, external systems).
- A group titled with a project/directory name, or holding only files of one directory, should be that folder.
- They combine: a domain group can hold project folders, or a project folder can hold a domain group.

## One paper per thing

Each source file appears **once**: one `file` node per path, with as many editors as the story needs. Likewise one
shape per external system, one note per idea. A second relevant part of a file → another editor on the same paper; a
paper relevant to a second step → an edge. Never a parallel panel ("Implementation", "Tests", "Before/after" copies)
that repeats papers.
