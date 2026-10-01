# Local development

## Requirements

- Node.js 20 or newer and npm
- VS Code 1.90 or newer (Cursor or Windsurf also work for trying the extension)
- Git (the Git gutter and its integration tests use it)

## Setup

```bash
npm install
npm run build
```

`npm run build` bundles everything into `dist/` with esbuild:

| Output | What it is |
|---|---|
| `dist/extension.js` | Extension host code (`src/extension/`) |
| `dist/webview.js` + `webview.css` | The canvas: React Flow + Monaco (`src/webview/`) |
| `dist/editor.worker.js` | Monaco editor worker |
| `dist/onig.wasm` | Oniguruma, used to highlight papers with VS Code's TextMate grammars |

## Run the extension

1. Open this folder in VS Code.
2. Press **F5** (*Run Extension*). It starts `npm run watch` and opens an Extension Development Host window with the
   extension loaded.
3. In that window, open a folder, then open the **Paper Workspace** panel in the activity bar and create a workspace.
4. After changing code, reload the host window (**Ctrl+R** / **Cmd+R**) to pick up the new build.

## Work on the canvas in a browser

```bash
npm run dev:webview
```

Opens the canvas at http://localhost:5199/harness/ against a mock VS Code host (`scripts/harness/`). This is the
fastest loop for UI work; features that need the real host (files, Git, language services) are mocked.

Query parameters change the sample canvas: `?demo` shows a generic sample project (`scripts/harness/demo.js`),
`?empty` an empty canvas, and `?many=50` adds 50 linked papers for performance checks.

To use VS Code's own syntax highlighting instead of Monaco's, copy the grammars and a theme from an install:

```bash
node scripts/harness-textmate.mjs "<VS Code install>/resources/app/extensions"
```

## Record the README GIF

`docs/images/demo.gif` is recorded from the `?demo` canvas with an installed Chrome or Edge (set `CHROME` to its path
if it is not found). With the harness running (and the TextMate step above done, for VS Code colors):

```bash
npm run record:demo
```

The script (`scripts/record-demo.mjs`) moves a note, zooms into a paper and types a line of code, then writes the GIF.

## Tests

| Command | What it runs |
|---|---|
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests with Vitest (`test/`) |
| `npm run test:integration` | `test/integration/suite.cjs` inside a real VS Code with an isolated profile and a throwaway Git workspace |

The integration tests download VS Code into `.vscode-test/` the first time. To use an installed one instead:

```bash
npm run test:integration -- --code "<path to Code executable>"
```

## Project layout

```
src/extension/     extension host: custom editor, Workspaces panel, commands, Git, language-service proxy
src/webview/       the canvas UI (React, React Flow, Monaco)
src/shared/        the .workspace format and code shared by both sides
scripts/           build, dev server, browser harness, integration runner
test/              unit and integration tests
.agents/skills/    the AI skill shipped with the repository (see ai-skill.md)
```

The architecture and the `.workspace` file format are described in [DESIGN.md](../DESIGN.md).

## Package a .vsix

```bash
npm run package
```

Builds in production mode and writes `paper-workspace-<version>.vsix` to the repository root. Only the files listed
in `.vscodeignore` go into it (the `dist/` bundles, `media/`, `README.md`, `CHANGELOG.md`, `LICENSE`). Install it with
*Extensions* → `…` → *Install from VSIX…*. To publish it, see [publishing.md](publishing.md).
