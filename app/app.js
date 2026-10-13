
import { createCodebaseGraph, shouldIgnorePath } from './codebase-parser.js';
let activeParserJob = null;
let documentSequence = 0;

function isCurrentDocumentOperation(operation) {
  return operation === documentSequence;
}

function cancelParserJob() {
  if (!activeParserJob) return;
  const job = activeParserJob;
  activeParserJob = null;
  job.settled = true;
  if (job.timer) window.clearTimeout(job.timer);
  job.worker?.terminate();
  job.resolve({ cancelled: true });
}

async function parseCodebase(records, options) {
  const operation = documentSequence;
  cancelParserJob();
  if (document.visibilityState === 'visible') await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (!isCurrentDocumentOperation(operation)) return { cancelled: true };
  const fallback = () => createCodebaseGraph(records, options);
  if (typeof Worker !== 'function') return Promise.resolve({ document: fallback() });
  const job = { worker: null, resolve: null, timer: null, settled: false };
  const promise = new Promise((resolve) => {
    job.resolve = resolve;
  });
  activeParserJob = job;
  try {
    const worker = new Worker(new URL('./parser-worker.js', import.meta.url), { type: 'module' });
    job.worker = worker;
    const finish = (result) => {
      if (job.settled) return;
      job.settled = true;
      if (job.timer) window.clearTimeout(job.timer);
      if (activeParserJob === job) activeParserJob = null;
      worker.terminate();
      job.resolve(result);
    };
    worker.addEventListener('message', (event) => {
      if (event.data?.type === 'result') finish({ document: event.data.document });
      else finish({ error: new Error(event.data?.message ?? 'Codebase parser worker failed.') });
    });
    worker.addEventListener('error', () => {
      try {
        finish({ document: fallback() });
      } catch (error) {
        finish({ error });
      }
    });
    job.timer = window.setTimeout(() => finish({ error: new Error('Codebase parsing exceeded the browser time limit.') }), 30000);
    worker.postMessage({ records, options });
  } catch {
    activeParserJob = null;
    return Promise.resolve({ document: fallback() });
  }
  return promise;
}
