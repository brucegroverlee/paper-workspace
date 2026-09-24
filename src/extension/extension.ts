import * as vscode from 'vscode';
import { WORKSPACE_EXT, type LineRange } from '../shared/workspace';
import type { WebviewToHost } from '../shared/protocol';
import { CANVAS_VIEW_TYPE, CanvasProvider } from './canvasProvider';
import { MODE_LABELS, Mode, WorkspaceStore, exists, labelFor } from './workspaceStore';
import { TakeoverController, rangeFromSelection } from './takeover';
import { WorkspacesView } from './workspacesView';

type WorkspaceArg = { uri?: vscode.Uri } | vscode.Uri | undefined;

export function activate(context: vscode.ExtensionContext) {
  const store = new WorkspaceStore(context);
  const takeover = new TakeoverController(store);
  const canvas = CanvasProvider.register(context, store, takeover);

  const addAndReveal = async (workspace: vscode.Uri, file: vscode.Uri, range: LineRange | undefined) => {
    try {
      const id = await store.addSnippet(workspace, file, range);
      await canvas.reveal(workspace, id);
    } catch (e) {
      void vscode.window.showErrorMessage(`Paper Workspace: ${(e as Error).message}`);
    }
  };
  takeover.addAndReveal = addAndReveal;

  const workspaceFrom = (arg: WorkspaceArg) => (arg instanceof vscode.Uri ? arg : arg?.uri);

  context.subscriptions.push(
    store,
    takeover,
    vscode.window.registerTreeDataProvider('paperWorkspace.workspaces', new WorkspacesView(store)),

    vscode.commands.registerCommand('paperWorkspace.refresh', () => store.refresh()),
    // Internal (not contributed to the palette): lets integration tests observe open canvases.
    vscode.commands.registerCommand('paperWorkspace._inspect', () => ({
      mode: store.mode,
      target: store.target?.toString(),
      canvases: canvas.inspect(),
    })),
    vscode.commands.registerCommand('paperWorkspace._simulate', (workspaceUri: string, message: WebviewToHost) =>
      canvas.simulate(workspaceUri, message),
    ),

    vscode.commands.registerCommand('paperWorkspace.setMode', async (arg?: Mode) => {
      // Accept a mode argument so keybindings/tests can switch without the picker.
      if (arg && arg in MODE_LABELS) return store.setMode(arg);
      const descriptions: Record<Mode, string> = {
        off: 'Disable the extension; files open normally',
        manual: 'Add code explicitly (selection command, Explorer menu, Shift+drag)',
        takeover: 'Opening a file adds it to the target workspace',
      };
      const pick = await vscode.window.showQuickPick(
        (Object.keys(MODE_LABELS) as Mode[]).map((mode) => ({
          label: MODE_LABELS[mode],
          description: mode === store.mode ? '(current)' : '',
          detail: descriptions[mode],
          mode,
        })),
        { placeHolder: 'Paper Workspace mode' },
      );
      if (!pick) return;
      await store.setMode(pick.mode);
      if (pick.mode === 'takeover') await store.resolveTarget();
    }),

    vscode.commands.registerCommand('paperWorkspace.newWorkspace', async () => {
      const workspaces = await store.list();
      const name = await vscode.window.showInputBox({
        prompt: 'Name of the new workspace workspace',
        value: workspaces.length ? `workspace-${workspaces.length + 1}` : 'main',
        validateInput: (v) => (v.trim() ? undefined : 'Enter a name'),
      });
      if (!name) return;
      let folder: vscode.WorkspaceFolder | undefined;
      if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
        folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Folder to store the workspace in' });
        if (!folder) return;
      }
      try {
        const uri = await store.create(name, folder);
        await vscode.commands.executeCommand('vscode.openWith', uri, CANVAS_VIEW_TYPE);
      } catch (e) {
        void vscode.window.showErrorMessage((e as Error).message);
      }
    }),

    vscode.commands.registerCommand('paperWorkspace.openWorkspace', (arg: WorkspaceArg) => {
      const uri = workspaceFrom(arg);
      if (uri) return vscode.commands.executeCommand('vscode.openWith', uri, CANVAS_VIEW_TYPE);
    }),

    vscode.commands.registerCommand('paperWorkspace.setTarget', (arg: WorkspaceArg) => {
      const uri = workspaceFrom(arg);
      if (uri) return store.setTarget(uri);
    }),

    vscode.commands.registerCommand('paperWorkspace.renameWorkspace', async (arg: WorkspaceArg) => {
      const uri = workspaceFrom(arg);
      if (!uri) return;
      const name = await vscode.window.showInputBox({ prompt: 'New name', value: labelFor(uri) });
      if (!name || name === labelFor(uri)) return;
      const next = vscode.Uri.joinPath(uri, '..', `${name.replace(/[<>:"/\\|?*]/g, '-')}${WORKSPACE_EXT}`);
      if (await exists(next)) return void vscode.window.showErrorMessage(`"${name}" already exists.`);
      const wasTarget = store.isTarget(uri);
      await vscode.workspace.fs.rename(uri, next);
      if (wasTarget) await store.setTarget(next);
      store.refresh();
    }),

    vscode.commands.registerCommand('paperWorkspace.deleteWorkspace', async (arg: WorkspaceArg) => {
      const uri = workspaceFrom(arg);
      if (!uri) return;
      const ok = await vscode.window.showWarningMessage(
        `Delete workspace workspace "${labelFor(uri)}"? The layout file is moved to the trash; your source files are not touched.`,
        { modal: true },
        'Delete',
      );
      if (ok !== 'Delete') return;
      await vscode.workspace.fs.delete(uri, { useTrash: true });
      if (store.isTarget(uri)) await store.setTarget(undefined);
      store.refresh();
    }),

    vscode.commands.registerCommand('paperWorkspace.addSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const target = await store.resolveTarget();
      if (target) await addAndReveal(target, editor.document.uri, rangeFromSelection(editor.selection));
    }),

    vscode.commands.registerCommand('paperWorkspace.addFile', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const files = uris?.length ? uris : uri ? [uri] : [];
      if (!files.length) return;
      const target = await store.resolveTarget();
      if (!target) return;
      for (const f of files) await addAndReveal(target, f, undefined);
    }),
  );
}

export function deactivate() {}
