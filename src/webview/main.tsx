import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
);

if (__HARNESS__) {
  // Test hooks for the browser harness only (stripped from extension builds).
  void Promise.all([import('./monaco'), import('./docStore')]).then(([{ monaco }, { docStore }]) => {
    (window as any).__pw = { monaco, docStore };
  });
}
