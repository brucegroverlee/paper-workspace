// Minimal stand-in for the extension host so the canvas can be developed in a normal browser.
(() => {
  const files = {
    'src/pages/business/services/modal/ServicesModalContext.tsx': [
      "import { createContext, useContext, useState } from 'react';",
      "import { useSearchParams } from 'react-router-dom';",
      '',
      "import { useFullScreenToggle } from '@components/full-screen-modal';",
      "import { LoadingScreenContext } from '@components/loading-screen/LoadingScreenContext';",
      '',
      'type ServicesModalView =',
      "  | 'discover-touchtunes-pay'",
      "  | 'sign-agreement'",
      "  | 'link-league-leader-account'",
      "  | 'review-locations'",
      "  | 'all-set';",
      '',
      'interface HandleOpenPayload {',
      '  view: ServicesModalView;',
      '  linkAccount?: boolean;',
      '}',
      '',
      'export interface ServicesModalContextValue {',
      '  open: boolean;',
      '  handleOpen: (payload: HandleOpenPayload) => void;',
      '  handleClose: VoidFunction;',
      '  view: ServicesModalView;',
      '  setView: (view: ServicesModalView) => void;',
      '  isLinkAccountModalOpen: boolean;',
      '  setIsLinkAccountModalOpen: (open: boolean) => void;',
      '}',
      '',
      'export const ServicesModalContext = createContext<ServicesModalContextValue | null>(null);',
      '',
      'export function useServicesModal() {',
      '  const ctx = useContext(ServicesModalContext);',
      "  if (!ctx) throw new Error('useServicesModal must be used inside ServicesModalProvider');",
      '  return ctx;',
      '}',
    ].join('\n'),
    'src/pages/business/services/ServicesController.tsx': [
      "import { ServicesModalProvider } from './modal/ServicesModalContext';",
      "import { ServicesPage } from './ServicesPage';",
      "import { ServicesModal } from './modal/ServicesModal';",
      '',
      'const ServicesController = () => {',
      '  return (',
      '    <ServicesModalProvider>',
      '      <ServicesPage />',
      '      <ServicesModal />',
      '    </ServicesModalProvider>',
      '  );',
      '};',
      '',
      'export default ServicesController;',
    ].join('\n'),
  };
  const dirty = {};
  const ctxFile = 'src/pages/business/services/modal/ServicesModalContext.tsx';
  let workspace = {
    version: 2,
    nodes: [
      { id: 'f1', type: 'file', file: ctxFile, position: { x: 0, y: 0 }, width: 664, height: 560 },
      { id: 'f2', type: 'file', file: 'src/pages/business/services/ServicesController.tsx', position: { x: 760, y: 80 }, width: 584, height: 330 },
      { id: 'e1', type: 'editor', parent: 'f1', target: { start: 7, end: 12 }, position: { x: 12, y: 40 }, width: 640, height: 220 },
      { id: 'e2', type: 'editor', parent: 'f1', target: { start: 19, end: 27 }, position: { x: 12, y: 276 }, width: 640, height: 272 },
      { id: 'e3', type: 'editor', parent: 'f2', position: { x: 12, y: 40 }, width: 560, height: 278 },
    ],
    edges: [],
  };
  const settings = { fontFamily: "Consolas, 'Courier New', monospace", fontSize: 14, lineHeight: 19, tabSize: 2 };
  let config = { minNodeWidth: 50, minNodeHeight: 50, focusPercent: 80, canvasBackground: '#e4e5e8' };
  const log = [];
  const send = (m) => setTimeout(() => window.postMessage(m, '*'), 5);

  function offsetAt(text, line, col) {
    let off = 0;
    for (let l = 1; l < line; l++) off = text.indexOf('\n', off) + 1;
    return off + col - 1;
  }
  function apply(text, changes) {
    const withOff = changes.map((c) => ({ ...c, s: offsetAt(text, c.startLine, c.startColumn), e: offsetAt(text, c.endLine, c.endColumn) }));
    withOff.sort((a, b) => b.s - a.s);
    for (const c of withOff) text = text.slice(0, c.s) + c.text + text.slice(c.e);
    return text;
  }

  // Canned IntelliSense answers (the real host asks VS Code's language providers).
  function mockLanguage(r) {
    const md = (value) => ({ value });
    switch (r.kind) {
      case 'completion':
        return {
          session: 1,
          incomplete: false,
          items: [
            { label: 'useState', kind: 'Function', detail: 'function useState<S>(initial: S): [S, Dispatch<S>]', insertText: 'useState', snippet: false },
            { label: 'useEffect', kind: 'Function', insertText: 'useEffect(() => {\n\t$0\n}, [])', snippet: true },
            { label: { label: 'ServicesModalView', description: './ServicesModal' }, kind: 'Interface', insertText: 'ServicesModalView', snippet: false },
            { label: 'mockValue', kind: 'Variable', insertText: 'mockValue', snippet: false },
          ],
        };
      case 'resolveCompletion':
        return { documentation: md(`Resolved docs for item **${r.index}**`) };
      case 'hover':
        return { contents: [md('```typescript\n(mock) symbol at ' + r.line + ':' + r.column + '\n```'), md('Hover from the **mock host**.\n\n' + Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long description.`).join('\n\n'))] };
      case 'signatureHelp':
        return {
          activeSignature: 0,
          activeParameter: 0,
          signatures: [{ label: 'fn(first: string, second: number): void', parameters: [{ label: [3, 16] }, { label: [18, 32] }] }],
        };
    }
    return null;
  }

  function mockDiagnostics(text) {
    const line = text.split('\n').findIndex((l) => l.includes('type '));
    if (line < 0) return [];
    const message = 'Mock problem from the host';
    return [{ range: { startLine: line + 1, startColumn: 1, endLine: line + 1, endColumn: 5 }, message, severity: 'warning', source: 'mock' }];
  }

  const deleted = {};
  let state;
  window.acquireVsCodeApi = () => ({
    getState: () => state,
    setState: (s) => (state = s),
    postMessage(m) {
      log.push(m);
      switch (m.type) {
        case 'ready':
          return send({ type: 'init', workspace, settings, config, mediaRoot: '' });
        // Media is kept inline as data URLs (the real host writes files under .paperworkspace/media).
        case 'saveMedia':
          return send({ type: 'mediaAdded', srcs: [`data:${m.mime};base64,${m.data}`], position: m.position });
        case 'pickMedia': {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#27405f"/><circle cx="480" cy="120" r="60" fill="#ffec99"/><path d="M0 400 L220 180 L400 400 Z" fill="#2d5236"/><path d="M200 400 L420 220 L640 400 Z" fill="#b2f2bb"/></svg>`;
          return send({ type: 'mediaAdded', srcs: [`data:image/svg+xml;base64,${btoa(svg)}`], position: m.position });
        }
        case 'openDoc':
          if (m.file in deleted) return send({ type: 'doc', file: m.file, missing: true });
          if (!(m.file in files)) return send({ type: 'doc', file: m.file, error: `Cannot open ${m.file}: not found` });
          send({ type: 'doc', file: m.file, text: files[m.file], languageId: 'typescriptreact', eol: '\n', dirty: !!dirty[m.file] });
          return send({ type: 'diagnostics', file: m.file, diagnostics: mockDiagnostics(files[m.file]) });
        case 'language':
          return send({ type: 'languageResult', id: m.id, result: mockLanguage(m.request) });
        case 'edit':
          files[m.file] = apply(files[m.file], m.changes);
          dirty[m.file] = true;
          return send({ type: 'docState', file: m.file, dirty: true, length: files[m.file].length, ack: true });
        case 'update':
          workspace = m.workspace;
          return;
        case 'setConfig':
          config = { ...config, ...m.config };
          return send({ type: 'config', config });
        // The real host shows a quick pick; here the file reappears under a new name.
        case 'relinkFile': {
          const newFile = m.file.replace(/(\.[^./]+)?$/, '.moved$1');
          files[newFile] = deleted[m.file] ?? files[m.file] ?? '';
          return send({ type: 'fileRelinked', file: m.file, newFile });
        }
        case 'save':
          for (const f of Object.keys(dirty)) {
            if (!dirty[f]) continue;
            dirty[f] = false;
            send({ type: 'docState', file: f, dirty: false });
          }
          return;
      }
    },
  });

  // Test hooks: inspect state and simulate edits made outside the canvas.
  window.__mock = {
    files,
    log,
    get workspace() {
      return workspace;
    },
    externalEdit(file, change) {
      files[file] = apply(files[file], [change]);
      send({ type: 'docChanged', file, changes: [change], length: files[file].length, dirty: true });
    },
    deleteFile(file) {
      deleted[file] = files[file];
      delete files[file];
      send({ type: 'doc', file, missing: true });
    },
    restoreFile(file) {
      files[file] = deleted[file];
      delete deleted[file];
      send({ type: 'doc', file, text: files[file], languageId: 'typescriptreact', eol: '\n' });
    },
    setWorkspace(p) {
      workspace = p;
      send({ type: 'workspace', workspace: p });
    },
  };
})();
