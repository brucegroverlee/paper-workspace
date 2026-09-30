// Messages exchanged between the extension host and the canvas webview.
import { DEFAULT_CANVAS_BACKGROUND, DEFAULT_FOCUS_PERCENT, DEFAULT_MIN_NODE_SIZE, type LineRange, type WorkspaceFile, type XY } from './workspace';
import type { DiagnosticJson, LanguageRequest, LanguageResult } from './language';
import type { TextmateInit, TextmateRequest, TextmateResult, TextmateTheme } from './textmate';

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
}

/** Canvas options edited in the config panel; stored as `paperWorkspace.*` VS Code settings. */
export interface CanvasConfig {
  minNodeWidth: number;
  minNodeHeight: number;
  /** Percentage of the window a focused node fills. */
  focusPercent: number;
  /** Title visibility given to new file / editor papers (existing papers keep their own). */
  showFileTitleByDefault: boolean;
  showEditorTitleByDefault: boolean;
  /** Canvas background color (`#rrggbb`). */
  canvasBackground: string;
}

/** Config panel defaults ("Reset to defaults"), also filling fields a host did not send. */
export const DEFAULT_CANVAS_CONFIG: CanvasConfig = {
  minNodeWidth: DEFAULT_MIN_NODE_SIZE,
  minNodeHeight: DEFAULT_MIN_NODE_SIZE,
  focusPercent: DEFAULT_FOCUS_PERCENT,
  canvasBackground: DEFAULT_CANVAS_BACKGROUND,
  showFileTitleByDefault: true,
  showEditorTitleByDefault: false,
};

/** A text edit in Monaco coordinates (1-based lines/columns), all relative to the pre-edit text. */
export interface TextChange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

export type HostToWebview =
  | {
      type: 'init';
      workspace: WorkspaceFile;
      error?: string;
      settings: EditorSettings;
      config: CanvasConfig;
      /** Webview URI of the folder workspace paths are relative to; media `src` paths resolve against it. */
      mediaRoot: string;
      /** Grammars and theme colors for VS Code-identical highlighting; absent when unavailable (Monaco's own is used). */
      textmate?: TextmateInit;
    }
  | { type: 'workspace'; workspace: WorkspaceFile; error?: string }
  | {
      type: 'doc';
      file: string;
      text?: string;
      languageId?: string;
      eol?: '\n' | '\r\n';
      dirty?: boolean;
      error?: string;
      /** The file was deleted or moved: nodes showing it offer to find it again or to be removed. */
      missing?: boolean;
    }
  /** A change made outside this canvas (native editor, another canvas, git, formatter...). */
  | { type: 'docChanged'; file: string; changes: TextChange[]; length: number; dirty: boolean }
  /** `ack` + `length` are sent after an edit from this webview was applied, to detect drift. */
  | { type: 'docState'; file: string; dirty: boolean; length?: number; ack?: boolean }
  | { type: 'revealNode'; id: string }
  | { type: 'settings'; settings: EditorSettings }
  | { type: 'config'; config: CanvasConfig }
  /** Focus returned to the canvas after a host action (e.g. Explorer reveal); re-focus the live editor. */
  | { type: 'restoreFocus' }
  /** Media files were saved or picked (workspace paths); the webview adds media nodes around `position`. */
  | { type: 'mediaAdded'; srcs: string[]; position: XY }
  /** Answer to a `language` request (`result` is null when no provider had anything). */
  | { type: 'languageResult'; id: number; result: LanguageResult }
  /** Answer to `relinkFile`: nodes showing `file` now show `newFile`. */
  | { type: 'fileRelinked'; file: string; newFile: string }
  /** Whether a folder shown by folder nodes exists (sent for new folders, then whenever it is deleted or comes back). */
  | { type: 'folderState'; folder: string; missing: boolean }
  /** Answer to `relinkFolder`: nodes showing `folder` now show `newFolder`. */
  | { type: 'folderRelinked'; folder: string; newFolder: string }
  /** VS Code's current problems for a file shown on the canvas. */
  | { type: 'diagnostics'; file: string; diagnostics: DiagnosticJson[] }
  /**
   * Git versions of a file, which papers diff against for gutter marks: `index` (staged text) for unstaged changes,
   * `ref` (`paperWorkspace.gitDiffBase`, HEAD by default) for the faded staged ones. '' when git has no version
   * of the file there (all lines added); null when there is nothing to compare with (or no `ref` configured).
   */
  | { type: 'gitBase'; file: string; index: string | null; ref: string | null }
  /** The color theme (or token color customizations) changed. */
  | { type: 'textmateTheme'; theme: TextmateTheme }
  /** Answer to a `textmate` request. */
  | { type: 'textmateResult'; id: number; result: TextmateResult };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'update'; workspace: WorkspaceFile }
  | { type: 'openDoc'; file: string }
  | { type: 'edit'; file: string; changes: TextChange[] }
  | { type: 'viewport'; center: XY; zoom: number }
  | { type: 'openInEditor'; file: string; line: number }
  /** Ctrl/Cmd+click in a paper (1-based position): open the definition or imported file as a paper. */
  | { type: 'goToDefinition'; file: string; line: number; column: number }
  | { type: 'dropUris'; uris: string[]; position: XY }
  | { type: 'save' }
  /** Open the `.workspace` file itself in a text editor beside the canvas. */
  | { type: 'viewSource' }
  | { type: 'setConfig'; config: Partial<CanvasConfig> }
  /** A single paper was selected or clicked into; the host reveals its file in the Explorer. */
  | { type: 'nodeFocused'; file: string }
  /** A folder paper's "Reveal in Explorer" button (workspace path; shown even with `revealInExplorer` off). */
  | { type: 'revealInExplorer'; path: string }
  /** Pick image/video files from the computer; answered with `mediaAdded`. */
  | { type: 'pickMedia'; position: XY }
  /** Store pasted or dropped media (base64) under `.paperworkspace/media/<workspace>`; answered with `mediaAdded`. */
  | { type: 'saveMedia'; name: string; mime: string; data: string; position: XY }
  /** Let the user pick a replacement for a missing file; answered with `fileRelinked` (nothing if cancelled). */
  | { type: 'relinkFile'; file: string }
  /** Let the user pick a folder to show instead of a missing one; answered with `folderRelinked` (nothing if cancelled). */
  | { type: 'relinkFolder'; folder: string }
  /** A PNG snapshot (base64) of the current view or the whole workspace; the host asks where to save it. */
  | { type: 'saveSnapshot'; scope: 'view' | 'workspace'; data: string }
  /**
   * "Copy reference": the host puts a reference to this workspace, or to one of its nodes, on the clipboard (see
   * shared/reference), so it can be pasted into an AI chat.
   */
  | { type: 'copyReference'; node?: { type: string; id: string } }
  /** IntelliSense for a paper, answered by VS Code's language providers with `languageResult`. */
  | { type: 'language'; id: number; file: string; request: LanguageRequest }
  /** A grammar or language configuration for syntax highlighting, answered with `textmateResult`. */
  | { type: 'textmate'; id: number; request: TextmateRequest };
