import type { HostToWebview, WebviewToHost } from '../shared/protocol';

interface VsCodeApi {
  postMessage(message: WebviewToHost): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// `acquireVsCodeApi` exists inside VS Code webviews; the browser dev harness installs a mock.
const api = acquireVsCodeApi();

export const host: VsCodeApi = {
  postMessage: (m) => api.postMessage(m),
  getState: <T,>() => api.getState() as T | undefined,
  setState: (s) => api.setState(s),
};

export function onHostMessage(handler: (m: HostToWebview) => void) {
  const listener = (e: MessageEvent) => handler(e.data as HostToWebview);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
