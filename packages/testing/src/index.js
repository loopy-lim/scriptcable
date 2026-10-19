import { snapshotFromConfig, diffContracts, formatDiff, loadConfig, } from '@scriptca/core';
import { readFile } from 'node:fs/promises';
export async function loadProjectConfig(path) {
    return loadConfig(JSON.parse(await readFile(path, 'utf8')));
}
export function assertContractCompatible(before, after) {
    const d = diffContracts(before, after);
    if (d.breaking.length) {
        throw new Error(`Breaking contract changes:\n${formatDiff(d)}`);
    }
}
export { snapshotFromConfig, diffContracts, formatDiff };
//# sourceMappingURL=index.js.map