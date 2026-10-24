// Worker bootstrap: register tsx so the worker can load TypeScript.
import { register } from "tsx/esm/api";
import { workerData } from "node:worker_threads";
register();
await import(workerData.__file);
