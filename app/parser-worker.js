import { createCodebaseGraph } from './codebase-parser.js';

self.addEventListener('message', (event) => {
  const { id, records, options } = event.data ?? {};
  try {
    const document = createCodebaseGraph(records ?? [], options ?? {});
    self.postMessage({ id, type: 'result', document });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
