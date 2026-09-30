import * as vscode from 'vscode';
import { WORKSPACE_EXT, type LineRange } from '../shared/workspace';
import type { WebviewToHost } from '../shared/protocol';
import { BUNDLE_EXT } from '../shared/bundle';
import { CANVAS_VIEW_TYPE, CanvasProvider } from './canvasProvider';
import { MODE_LABELS, Mode, WorkspaceStore, labelFor } from './workspaceStore';
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

    // From a workspace in the side panel, or the canvas in the active tab (command palette).
    vscode.commands.registerCommand('paperWorkspace.refreshCanvas', (arg: WorkspaceArg) => {
      const uri = workspaceFrom(arg) ?? canvas.activeWorkspace();
      if (uri) return canvas.refresh(uri);
    }),

    vscode.commands.registerCommand('paperWorkspace.setTarget', (arg: WorkspaceArg) => {
      const uri = workspaceFrom(arg);
      if (uri) return store.setTarget(uri);
    }),

    // `newName` / `dest` below skip the dialogs (integration tests, other extensions).
    vscode.commands.registerCommand('paperWorkspace.renameWorkspace', async (arg: WorkspaceArg, newName?: string) => {
      const uri = workspaceFrom(arg);
      if (!uri) return;
      const name = typeof newName === 'string' ? newName : await vscode.window.showInputBox({ prompt: 'New name', value: labelFor(uri) });
      if (!name || name === labelFor(uri)) return;
      try {
        await store.rename(uri, name);
      } catch (e) {
        void vscode.window.showErrorMessage(`Paper Workspace: ${(e as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('paperWorkspace.duplicateWorkspace', async (arg: WorkspaceArg, newName?: string) => {
      const uri = workspaceFrom(arg);
      if (!uri) return;
      const name = typeof newName === 'string' ? newName : await vscode.window.showInputBox({
        prompt: `Name of the copy of "${labelFor(uri)}"`,
        value: `${labelFor(uri)} copy`,
      });
      if (!name) return;
      try {
        await store.duplicate(uri, name);
      } catch (e) {
        void vscode.window.showErrorMessage(`Paper Workspace: ${(e as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('paperWorkspace.deleteWorkspace', async (arg: WorkspaceArg, confirmed?: boolean) => {
      const uri = workspaceFrom(arg);
      if (!uri) return;
      const ok = confirmed === true ? 'Delete' : await vscode.window.showWarningMessage(
        `Delete workspace "${labelFor(uri)}"? The layout file and the media only it uses are moved to the trash; your source files are not touched.`,
        { modal: true },
        'Delete',
      );
      if (ok !== 'Delete') return;
      await store.remove(uri);
    }),

    vscode.commands.registerCommand('paperWorkspace.exportWorkspace', async (arg: WorkspaceArg, to?: vscode.Uri) => {
      let uri = workspaceFrom(arg);
      if (!uri) {
        const workspaces = await store.list();
        if (!workspaces.length) return void vscode.window.showInformationMessage('Paper Workspace: there is no workspace to export.');
        const pick = await vscode.window.showQuickPick(
          workspaces.map((w) => ({ label: labelFor(w), description: vscode.workspace.asRelativePath(w), uri: w })),
          { placeHolder: 'Workspace to export' },
        );
        uri = pick?.uri;
      }
      if (!uri) return;
      const dest = to instanceof vscode.Uri ? to : await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(store.rootFor(uri), labelFor(uri) + BUNDLE_EXT),
        filters: { 'Paper Workspace bundle': [BUNDLE_EXT.slice(1)] },
        saveLabel: 'Export',
        title: `Export "${labelFor(uri)}"`,
      });
      if (!dest) return;
      try {
        const { text, missing } = await store.exportBundle(uri);
        await vscode.workspace.fs.writeFile(dest, Buffer.from(text, 'utf8'));
        const done = `Paper Workspace: exported "${labelFor(uri)}" to ${dest.fsPath}.`;
        if (missing.length) void vscode.window.showWarningMessage(`${done} Missing media not included: ${missing.join(', ')}`);
        else void vscode.window.showInformationMessage(done);
      } catch (e) {
        void vscode.window.showErrorMessage(`Paper Workspace: ${(e as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('paperWorkspace.importWorkspace', async (file?: vscode.Uri) => {
      if (!(file instanceof vscode.Uri)) {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Import',
          title: 'Import a Paper Workspace',
          filters: { 'Paper Workspace bundle': [BUNDLE_EXT.slice(1)], 'Workspace layout': [WORKSPACE_EXT.slice(1)] },
        });
        file = picked?.[0];
      }
      if (!file) return;
      let folder: vscode.WorkspaceFolder | undefined;
      if ((vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
        folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Folder to import the workspace into' });
        if (!folder) return;
      }
      try {
        const uri = await store.importBundle(file, folder);
        await vscode.commands.executeCommand('vscode.openWith', uri, CANVAS_VIEW_TYPE);
      } catch (e) {
        void vscode.window.showErrorMessage(`Paper Workspace: could not import: ${(e as Error).message}`);
      }
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
      for (const f of files) {
        try {
          if (!((await vscode.workspace.fs.stat(f)).type & vscode.FileType.Directory)) {
            await addAndReveal(target, f, undefined);
            continue;
          }
          const { id } = await store.addFolder(target, f);
          await canvas.reveal(target, id);
        } catch (e) {
          void vscode.window.showErrorMessage(`Paper Workspace: ${(e as Error).message}`);
        }
      }
    }),
  );
}

export function deactivate() {}
