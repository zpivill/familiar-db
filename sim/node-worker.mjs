// Runs sim/worker.js in a Node worker thread, so the terminal can split batches across cores like the page does.
import { parentPort } from 'worker_threads';
globalThis.self = { postMessage: m => parentPort.postMessage(m) };
await import('./worker.js');
parentPort.on('message', data => self.onmessage({ data }));
