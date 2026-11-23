import { createRig, runBenchmark, reportLines } from './rig.mjs';

const ctx = createRig();
const runs = runBenchmark(ctx);
for (const line of reportLines(runs)) console.log(line);
