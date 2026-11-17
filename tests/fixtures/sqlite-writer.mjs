import { parentPort, workerData } from 'node:worker_threads';
import { SqliteStore } from '../../src/storage/sqlite-store.ts';
import { nodeEnvironment } from '../../src/runtime.ts';

const { filename, workspace, principal, command, gate } = workerData;
const pause = new Int32Array(new SharedArrayBuffer(4));
const store = new SqliteStore(filename, workspace, {
  environment: { ...nodeEnvironment, now() { Atomics.wait(pause, 0, 0, 40); return nodeEnvironment.now(); } },
});
parentPort.postMessage({ ready: true });
Atomics.wait(new Int32Array(gate), 0, 0);
try { parentPort.postMessage({ result: store.execute(principal, command) }); }
catch (error) { parentPort.postMessage({ error: { name: error.name, code: error.code } }); }
finally { store.close(); }
