declare const __HARNESS__: boolean;

// Monaco internals that editor.api doesn't expose (no typings ship for the deep ESM paths).
declare module 'monaco-editor/editor/standalone/browser/standaloneServices.js' {
  export const StandaloneServices: { initialize(overrides: object): unknown; get(id: unknown): any };
}
declare module 'monaco-editor/editor/standalone/common/standaloneTheme.js' {
  export const IStandaloneThemeService: unknown;
}
