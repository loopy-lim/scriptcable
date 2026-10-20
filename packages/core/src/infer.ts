/**
 * TS → ABI inference: derive scriptcable exports directly from the entry
 * module's TypeScript, so `scriptcable.json` never needs a duplicate
 * `exports` array.
 *
 * Rules:
 * - Every exported `function` with fully-annotated params is a candidate.
 * - TS types map to ABI classes: number→f64 (or branded alias like
 *   `u32`/`i64`/`f32` declared via `declare const` brand or type alias
 *   imported from the entry itself), string→string, Uint8Array→bytes,
 *   boolean→bool, void/undefined→void.
 * - Type aliases matching ABI class names (u8..u64, f32/f64, cstring, bytes)
 *   resolve to those classes — e.g. `type UserId = u32`.
 * - Functions whose params can't be mapped are skipped with a reason
 *   (reported by `scriptcable build --explain`).
 */
import ts from 'typescript';
import type { AbiClass } from '@scriptcable/types';

export type InferredExport = {
  name: string;
  params: AbiClass[];
  /** Source parameter names — used by codegen instead of arg0/arg1. */
  paramNames: string[];
  returns: AbiClass;
  /** JSDoc summary (first paragraph) if present. */
  doc?: string;
};

export type InferenceResult = {
  exports: InferredExport[];
  /** Non-fatal skips: export name → human-readable reason. */
  skipped: Array<{ name: string; reason: string }>;
};

const NUM_DEFAULT: AbiClass = 'f64';

/** Aliases that resolve directly to ABI classes. */
const ALIAS_CLASSES: Record<string, AbiClass> = {
  u8: 'u8', u16: 'u16', u32: 'u32', i8: 'i8', i16: 'i16', i32: 'i32',
  i64: 'i64', u64: 'u64', f32: 'f32', f64: 'f64',
  cstring: 'cstring', bytes: 'bytes',
  // Common convenience aliases
  int: 'i32', uint: 'u32', float: 'f32', double: 'f64',
  bool: 'bool', boolean: 'bool', string: 'string', number: 'f64',
};

function jsDocSummary(node: ts.Node): string | undefined {
  const sf = node.getSourceFile();
  // Leading trivia (comments + whitespace) lives between pos and getStart.
  const leading = sf.text.slice(node.pos, node.getStart(sf));
  const range = leading.match(/\/\*\*[\s\S]*?\*\//)?.[0];
  if (!range) return undefined;
  const raw = range;
  const lines = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l.length > 0 && !l.startsWith('@'));
  return lines.length ? lines.join(' ') : undefined;
}

export function inferExportsFromSource(source: string, fileName = 'core.ts'): InferenceResult {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const checker = makeLocalChecker(sf);

  const exports: InferredExport[] = [];
  const skipped: InferenceResult['skipped'] = [];

  // Collect top-level type aliases so `type UserId = u32` resolves.
  const aliases = new Map<string, AbiClass>();
  for (const st of sf.statements) {
    if (ts.isTypeAliasDeclaration(st) && ts.isTypeReferenceNode(st.type)) {
      const target = st.type.typeName.getText(sf);
      const cls = ALIAS_CLASSES[target];
      if (cls) aliases.set(st.name.getText(sf), cls);
    }
  }

  const toAbi = (typeNode: ts.TypeNode): AbiClass | null => {
    if (ts.isTypeReferenceNode(typeNode)) {
      const name = typeNode.typeName.getText(sf);
      const direct = ALIAS_CLASSES[name];
      if (direct) return direct;
      const viaAlias = aliases.get(name);
      if (viaAlias) return viaAlias;
      if (name === 'Uint8Array' || name === 'ArrayBuffer') return 'bytes';
      return null;
    }
    if (typeNode.kind === ts.SyntaxKind.NumberKeyword) return NUM_DEFAULT;
    if (typeNode.kind === ts.SyntaxKind.StringKeyword) return 'string';
    if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return 'bool';
    if (typeNode.kind === ts.SyntaxKind.VoidKeyword) return 'void';
    return null;
  };

  for (const st of sf.statements) {
    const fde =
      ts.isFunctionDeclaration(st) && st.name
        ? st
        : ts.isVariableStatement(st)
          ? st.declarationList.declarations.find(
              (d) => d.name.kind === ts.SyntaxKind.Identifier && d.initializer && ts.isArrowFunction(d.initializer) && d.initializer.name === undefined
                ? true
                : false,
            )
          : undefined;
    // Only plain `export function` for now (var/arrow adds noise; revisit).
    if (!ts.isFunctionDeclaration(st) || !st.name) continue;
    if (!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) continue;

    const name = st.name.getText(sf);
    const paramNames: string[] = [];
    const params: AbiClass[] = [];
    let bad: string | null = null;

    for (const p of st.parameters) {
      paramNames.push(p.name.getText(sf));
      if (!p.type) { bad = `parameter "${p.name.getText(sf)}" has no type annotation`; break; }
      const cls = toAbi(p.type);
      if (!cls) { bad = `parameter "${p.name.getText(sf)}" type "${p.type.getText(sf)}" is not ABI-mappable`; break; }
      params.push(cls);
    }
    if (bad) { skipped.push({ name, reason: bad }); continue; }

    let returns: AbiClass = 'void';
    if (st.type) {
      const cls = toAbi(st.type);
      if (!cls) { skipped.push({ name, reason: `return type "${st.type.getText(sf)}" is not ABI-mappable` }); continue; }
      returns = cls;
    }

    exports.push({ name, params, paramNames, returns, doc: jsDocSummary(st) ?? undefined });
  }

  void checker;
  return { exports, skipped };
}

/** Placeholder — local type checking without a full program (fast path). */
function makeLocalChecker(_sf: ts.SourceFile): null {
  return null;
}

/** Infer from a file on disk. */
export async function inferExportsFromFile(entryPath: string): Promise<InferenceResult> {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(entryPath, 'utf8');
  return inferExportsFromSource(source, entryPath);
}
