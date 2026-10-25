/**
 * Batch wire — packs N export calls into one (meta, args) pair so a single
 * boundary crossing (the generated N-API batch executive in napi-addon.ts)
 * runs them all. This is the JS side: encode before the crossing, decode the
 * returned result block after.
 *
 * Layout contract (must stay in sync with the C codegen):
 *   meta: Int32Array — [count, (exportIdx, argBase) × count]; argBase is the
 *         byte offset of the entry's 8-byte-aligned slot run in `args`.
 *   args: per entry — payloads first (utf8 text / raw bytes), then one 8-byte
 *         slot per param, in signature order:
 *           f64/f32, bool, u8..i32 → f64 bits (setFloat64)
 *           i64/u64                → raw 8 bytes
 *           string                 → (u32 payloadOff, u32 byteLen)
 *           cstring                → (u32 payloadOff, u32 byteLen incl NUL)
 *           bytes                  → (u32 payloadOff, u32 byteLen)
 *   result block: entries in order, each prefixed with a u32 result kind
 *   (self-describing — decode needs no per-batch layout):
 *           F64       8-byte double bits
 *           BOOL      u32 0|1
 *           U32/I32   u32 / i32 bits
 *           I64/U64   raw 8 bytes
 *           STRING / BYTES / CSTRING   u32 byteLen + payload
 *           VOID      nothing
 *
 * Pools are per-wire and grow-only: a batch writes into the same buffers
 * while they fit (steady-state allocations: one result Buffer from the
 * executive + the decoded results array). All supported hosts are
 * little-endian; the C side reads/writes native order.
 */
import type { AbiClass, BatchEntry, ScriptcableProfile, ExportDef } from '@scriptcable/types';
import { ScriptcableError } from '@scriptcable/types';

/** Result kinds — wire-stable constants shared with the C codegen. */
const KIND_F64 = 1;
const KIND_BOOL = 2;
const KIND_U32 = 3;
const KIND_I32 = 4;
const KIND_I64 = 5;
const KIND_U64 = 6;
const KIND_STRING = 7;
const KIND_BYTES = 8;
const KIND_CSTRING = 9;
const KIND_VOID = 10;

const RESULT_KIND: Record<string, number> = {
  f64: KIND_F64,
  f32: KIND_F64,
  bool: KIND_BOOL,
  u8: KIND_U32,
  u16: KIND_U32,
  u32: KIND_U32,
  i8: KIND_I32,
  i16: KIND_I32,
  i32: KIND_I32,
  i64: KIND_I64,
  u64: KIND_U64,
  string: KIND_STRING,
  bytes: KIND_BYTES,
  cstring: KIND_CSTRING,
  void: KIND_VOID,
};

const META_INIT = 257; // 1 + 2 × 128 entries before first growth
const ARGS_INIT = 8192;

export type BatchEncoded = {
  meta: Int32Array;
  args: Uint8Array;
};

export type BatchWire = {
  /** Pack entries into the wire buffers (pooled — grows when needed). */
  encode(entries: ReadonlyArray<BatchEntry>): BatchEncoded;
  /** Validate names/arg counts only — the sequential fallback calls this so
   *  both batch tiers reject bad entries with the same error, same class. */
  check(entries: ReadonlyArray<BatchEntry>): void;
  /** Read the executive's result block back into per-entry values. */
  decode(result: ArrayBufferView): unknown[];
};

/**
 * Per-wire marshaling state — like the loaders' shared scratch, one wire
 * serves every batch; growth reallocates and keeps serving.
 */
type WireState = {
  meta: Int32Array;
  args: Uint8Array;
  /** Views over args — rebuilt on growth. */
  dv: DataView;
  u8: Uint8Array;
  encoder: TextEncoder;
  decoder: TextDecoder;
  // Per-arg payload (offset, len) scratch — written into slots after the
  // entry's payloads, so one entry needs its params' worth of slots held.
  payload: Int32Array;
};

export function createBatchWire(profile: ScriptcableProfile): BatchWire {
  const byName = new Map<string, { def: ExportDef; idx: number }>();
  profile.exports.forEach((def, idx) => byName.set(def.export, { def, idx }));

  let maxParams = 0;
  for (const def of profile.exports) maxParams = Math.max(maxParams, def.params.length);

  const st: WireState = {
    meta: new Int32Array(META_INIT),
    args: new Uint8Array(ARGS_INIT),
    dv: null as unknown as DataView,
    u8: null as unknown as Uint8Array,
    encoder: new TextEncoder(),
    decoder: new TextDecoder(),
    payload: new Int32Array(maxParams * 2),
  };
  st.u8 = new Uint8Array(st.args.buffer);
  st.dv = new DataView(st.args.buffer);

  function growArgs(need: number): void {
    let cap = st.args.byteLength;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(st.args);
    st.args = next;
    st.u8 = next;
    st.dv = new DataView(next.buffer);
  }

  function check(entries: ReadonlyArray<BatchEntry>): void {
    for (const entry of entries) {
      const found = byName.get(entry[0]);
      if (!found) {
        throw new ScriptcableError(
          'UNKNOWN_EXPORT',
          `Unknown export "${entry[0]}"`,
          `Known: ${[...byName.keys()].join(', ')}`,
        );
      }
      if (entry.length - 1 !== found.def.params.length) {
        throw new ScriptcableError(
          'ABI',
          `Export "${entry[0]}" expects ${found.def.params.length} argument${found.def.params.length === 1 ? '' : 's'}, got ${entry.length - 1}`,
        );
      }
    }
  }

  function encode(entries: ReadonlyArray<BatchEntry>): BatchEncoded {
    const n = entries.length;
    if (1 + 2 * n > st.meta.length) {
      let cap = st.meta.length;
      while (cap < 1 + 2 * n) cap *= 2;
      st.meta = new Int32Array(cap);
    }
    st.meta[0] = n;

    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const entry = entries[i]!;
      const name = entry[0];
      const found = byName.get(name);
      if (!found) {
        throw new ScriptcableError(
          'UNKNOWN_EXPORT',
          `Unknown export "${name}"`,
          `Known: ${[...byName.keys()].join(', ')}`,
        );
      }
      const { def, idx } = found;
      const params = def.params;
      if (entry.length - 1 !== params.length) {
        throw new ScriptcableError(
          'ABI',
          `Export "${name}" expects ${params.length} argument${params.length === 1 ? '' : 's'}, got ${entry.length - 1}`,
        );
      }
      st.meta[1 + 2 * i] = idx;

      // Payloads first — each string/bytes arg appends raw bytes and records
      // (offset, len) for the slot phase.
      for (let p = 0; p < params.length; p++) {
        const cls = params[p]!;
        const v = entry[p + 1];
        if (cls === 'string' || cls === 'cstring') {
          const text = cls === 'cstring' ? String(v ?? '') + '\0' : String(v ?? '');
          const max = text.length * 4 + 4;
          if (cursor + max > st.args.byteLength) growArgs(cursor + max);
          const { written } = st.encoder.encodeInto(text, st.u8.subarray(cursor, cursor + max));
          st.payload[2 * p] = cursor;
          st.payload[2 * p + 1] = written;
          cursor += written;
        } else if (cls === 'bytes') {
          // Any ArrayBufferView (like the single-call addon path, which takes
          // them all via Buffer.from) — not just Uint8Array.
          const data =
            v instanceof Uint8Array
              ? v
              : ArrayBuffer.isView(v)
                ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
                : new Uint8Array(v as ArrayBuffer);
          if (cursor + data.byteLength > st.args.byteLength) growArgs(cursor + data.byteLength);
          st.u8.set(data, cursor);
          st.payload[2 * p] = cursor;
          st.payload[2 * p + 1] = data.byteLength;
          cursor += data.byteLength;
        }
      }
      // Slots after payloads, 8-byte aligned; padding bytes are never read.
      cursor = (cursor + 7) & ~7;
      if (cursor + params.length * 8 > st.args.byteLength) growArgs(cursor + params.length * 8);
      st.meta[2 + 2 * i] = cursor;
      for (let p = 0; p < params.length; p++) {
        const cls = params[p]!;
        const slot = cursor;
        cursor += 8;
        switch (cls) {
          case 'f64':
          case 'f32':
            st.dv.setFloat64(slot, Number(entry[p + 1]), true);
            break;
          case 'bool':
            st.dv.setFloat64(slot, entry[p + 1] ? 1 : 0, true);
            break;
          case 'u8':
          case 'u16':
          case 'u32':
          case 'i8':
          case 'i16':
          case 'i32':
            st.dv.setFloat64(slot, Number(entry[p + 1]), true);
            break;
          case 'i64':
          case 'u64': {
            const v = entry[p + 1];
            const big = typeof v === 'bigint' ? v : BigInt(v as number);
            if (cls === 'i64') st.dv.setBigInt64(slot, big, true);
            else st.dv.setBigUint64(slot, big, true);
            break;
          }
          case 'string':
          case 'bytes':
          case 'cstring': {
            st.dv.setUint32(slot, st.payload[2 * p]!, true);
            st.dv.setUint32(slot + 4, st.payload[2 * p + 1]!, true);
            break;
          }
          default:
            throw new ScriptcableError('ABI', `Unsupported param class: ${cls}`);
        }
      }
    }
    return { meta: st.meta, args: st.args };
  }

  function decode(result: ArrayBufferView): unknown[] {
    const dv = new DataView(result.buffer, result.byteOffset, result.byteLength);
    const out: unknown[] = [];
    let i = 0;
    const end = result.byteLength;
    while (i < end) {
      const kind = dv.getUint32(i, true);
      i += 4;
      switch (kind) {
        case KIND_F64:
          out.push(dv.getFloat64(i, true));
          i += 8;
          break;
        case KIND_BOOL:
          out.push(dv.getUint32(i, true) !== 0);
          i += 4;
          break;
        case KIND_U32:
          out.push(dv.getUint32(i, true));
          i += 4;
          break;
        case KIND_I32:
          out.push(dv.getInt32(i, true));
          i += 4;
          break;
        case KIND_I64:
          out.push(Number(dv.getBigInt64(i, true)));
          i += 8;
          break;
        case KIND_U64:
          out.push(Number(dv.getBigUint64(i, true)));
          i += 8;
          break;
        case KIND_STRING:
        case KIND_CSTRING: {
          const len = dv.getUint32(i, true);
          i += 4;
          out.push(st.decoder.decode(new Uint8Array(result.buffer, result.byteOffset + i, len)));
          i += len;
          break;
        }
        case KIND_BYTES: {
          const len = dv.getUint32(i, true);
          i += 4;
          out.push(new Uint8Array(result.buffer, result.byteOffset + i, len).slice());
          i += len;
          break;
        }
        case KIND_VOID:
          out.push(undefined);
          break;
        default:
          throw new ScriptcableError('ABI', `Corrupt batch result block: kind ${kind} at byte ${i - 4}`);
      }
    }
    return out;
  }

  return { encode, check, decode };
}
