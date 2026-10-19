import { createHash } from 'node:crypto';
import { configToProfile } from './profile.js';
function normalizeExports(exports) {
    return [...exports]
        .map((e) => ({
        export: e.export,
        symbol: e.symbol,
        params: [...e.params],
        returns: e.returns,
    }))
        .sort((a, b) => a.export.localeCompare(b.export));
}
function normalizeCallbacks(callbacks = []) {
    return [...callbacks]
        .map((c) => ({ name: c.name, params: [...c.params], returns: c.returns }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
function sigExport(e) {
    return `${e.export}(${e.params.join(',')})->${e.returns}`;
}
function sigCallback(c) {
    return `${c.name}(${c.params.join(',')})->${c.returns}`;
}
export function snapshotFromProfile(profile) {
    const exports = normalizeExports(profile.exports);
    const callbacks = normalizeCallbacks(profile.callbacks);
    const surface = JSON.stringify({
        name: profile.name,
        entry: profile.entry,
        prefix: profile.abi.prefix,
        exports: exports.map(sigExport),
        callbacks: callbacks.map(sigCallback),
    });
    const hash = createHash('sha256').update(surface).digest('hex').slice(0, 16);
    return {
        schemaVersion: 1,
        name: profile.name,
        entry: profile.entry,
        prefix: profile.abi.prefix,
        exports,
        callbacks,
        hash,
    };
}
export function snapshotFromConfig(config) {
    return snapshotFromProfile(configToProfile(config));
}
/** Diff two snapshots. Breaking = removed or changed signatures. */
export function diffContracts(before, after) {
    const breaking = [];
    const nonBreaking = [];
    const beforeE = new Map(before.exports.map((e) => [e.export, e]));
    const afterE = new Map(after.exports.map((e) => [e.export, e]));
    for (const [name, e] of afterE) {
        const prev = beforeE.get(name);
        if (!prev)
            nonBreaking.push({ kind: 'added', export: name });
        else if (sigExport(prev) !== sigExport(e)) {
            breaking.push({
                kind: 'changed',
                export: name,
                before: sigExport(prev),
                after: sigExport(e),
            });
        }
    }
    for (const [name] of beforeE) {
        if (!afterE.has(name))
            breaking.push({ kind: 'removed', export: name });
    }
    const beforeC = new Map(before.callbacks.map((c) => [c.name, c]));
    const afterC = new Map(after.callbacks.map((c) => [c.name, c]));
    for (const [name, c] of afterC) {
        const prev = beforeC.get(name);
        if (!prev)
            nonBreaking.push({ kind: 'callback-added', name });
        else if (sigCallback(prev) !== sigCallback(c)) {
            breaking.push({
                kind: 'callback-changed',
                name,
                before: sigCallback(prev),
                after: sigCallback(c),
            });
        }
    }
    for (const [name] of beforeC) {
        if (!afterC.has(name))
            breaking.push({ kind: 'callback-removed', name });
    }
    return { breaking, nonBreaking };
}
export function formatDiff(diff) {
    const lines = [];
    if (diff.breaking.length === 0 && diff.nonBreaking.length === 0) {
        return 'No contract changes.';
    }
    if (diff.breaking.length) {
        lines.push('BREAKING:');
        for (const d of diff.breaking) {
            if (d.kind === 'removed')
                lines.push(`  - removed export ${d.export}`);
            else if (d.kind === 'changed')
                lines.push(`  - changed ${d.export}: ${d.before} → ${d.after}`);
            else if (d.kind === 'callback-removed')
                lines.push(`  - removed callback ${d.name}`);
            else if (d.kind === 'callback-changed')
                lines.push(`  - changed callback ${d.name}: ${d.before} → ${d.after}`);
        }
    }
    if (diff.nonBreaking.length) {
        lines.push('Non-breaking:');
        for (const d of diff.nonBreaking) {
            if (d.kind === 'added')
                lines.push(`  + added export ${d.export}`);
            else if (d.kind === 'callback-added')
                lines.push(`  + added callback ${d.name}`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=contract.js.map