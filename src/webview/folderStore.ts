// Which folders shown by folder nodes no longer exist (the host sends `folderState` when that changes).
import { useSyncExternalStore } from 'react';

const missing = new Set<string>();
const listeners = new Set<() => void>();

export const folderStore = {
  set(folder: string, isMissing: boolean) {
    if (missing.has(folder) === isMissing) return;
    if (isMissing) missing.add(folder);
    else missing.delete(folder);
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Re-render when the folder is deleted or comes back. */
export function useFolderMissing(folder: string) {
  return useSyncExternalStore(folderStore.subscribe, () => missing.has(folder));
}
