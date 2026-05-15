import { describe, expect, it } from 'vitest';
import { parseFilterbankHeader } from './filterbankParser';

/**
 * Build a minimal SIGPROC filterbank header for testing. Layout:
 *   uint32 keyword-length, ASCII keyword bytes, [optional value]
 * String values themselves carry a uint32 length prefix.
 */
function buildHeader(
  entries: Array<
    | { kind: 'flag'; key: string }
    | { kind: 'int'; key: string; value: number }
    | { kind: 'double'; key: string; value: number }
    | { kind: 'string'; key: string; value: string }
  >,
  trailingBytes = 0
): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const enc = new TextEncoder();
  const keywordBytes = (key: string) => {
    const ascii = enc.encode(key);
    const out = new Uint8Array(4 + ascii.length);
    new DataView(out.buffer).setUint32(0, ascii.length, true);
    out.set(ascii, 4);
    return out;
  };
  for (const entry of entries) {
    chunks.push(keywordBytes(entry.key));
    if (entry.kind === 'flag') continue;
    if (entry.kind === 'int') {
      const v = new Uint8Array(4);
      new DataView(v.buffer).setInt32(0, entry.value, true);
      chunks.push(v);
    } else if (entry.kind === 'double') {
      const v = new Uint8Array(8);
      new DataView(v.buffer).setFloat64(0, entry.value, true);
      chunks.push(v);
    } else {
      const ascii = enc.encode(entry.value);
      const v = new Uint8Array(4 + ascii.length);
      new DataView(v.buffer).setUint32(0, ascii.length, true);
      v.set(ascii, 4);
      chunks.push(v);
    }
  }
  const totalLen = chunks.reduce((a, c) => a + c.length, 0) + trailingBytes;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out.buffer;
}

describe('parseFilterbankHeader', () => {
  it('parses a minimal valid header', () => {
    const buf = buildHeader([
      { kind: 'flag', key: 'HEADER_START' },
      { kind: 'int', key: 'nchans', value: 1024 },
      { kind: 'int', key: 'nbits', value: 32 },
      { kind: 'int', key: 'nifs', value: 1 },
      { kind: 'double', key: 'fch1', value: 1500.0 },
      { kind: 'double', key: 'foff', value: -0.0029296875 },
      { kind: 'double', key: 'tsamp', value: 18.25361 },
      { kind: 'string', key: 'source_name', value: 'Voyager1' },
      { kind: 'flag', key: 'HEADER_END' }
    ]);
    const header = parseFilterbankHeader(buf);
    expect(header.nchans).toBe(1024);
    expect(header.nbits).toBe(32);
    expect(header.nifs).toBe(1);
    expect(header.fch1).toBeCloseTo(1500.0);
    expect(header.foff).toBeCloseTo(-0.0029296875);
    expect(header.tsamp).toBeCloseTo(18.25361);
    expect(header.sourceName).toBe('Voyager1');
    expect(header.dataOffset).toBeGreaterThan(0);
  });

  it('defaults nifs to 1 when omitted', () => {
    const buf = buildHeader([
      { kind: 'flag', key: 'HEADER_START' },
      { kind: 'int', key: 'nchans', value: 16 },
      { kind: 'int', key: 'nbits', value: 8 },
      { kind: 'double', key: 'fch1', value: 1420.0 },
      { kind: 'double', key: 'foff', value: -0.001 },
      { kind: 'double', key: 'tsamp', value: 1.0 },
      { kind: 'flag', key: 'HEADER_END' }
    ]);
    const header = parseFilterbankHeader(buf);
    expect(header.nifs).toBe(1);
  });

  it('rejects a buffer that does not start with HEADER_START', () => {
    const buf = buildHeader([
      { kind: 'flag', key: 'HEADER_OOPS' },
      { kind: 'flag', key: 'HEADER_END' }
    ]);
    expect(() => parseFilterbankHeader(buf)).toThrow(/HEADER_START/);
  });

  it('rejects a header missing HEADER_END terminator', () => {
    const buf = buildHeader([
      { kind: 'flag', key: 'HEADER_START' },
      { kind: 'int', key: 'nchans', value: 16 },
      { kind: 'int', key: 'nbits', value: 8 },
      { kind: 'double', key: 'fch1', value: 1.0 },
      { kind: 'double', key: 'foff', value: -0.001 },
      { kind: 'double', key: 'tsamp', value: 1.0 }
      // no HEADER_END
    ]);
    expect(() => parseFilterbankHeader(buf)).toThrow();
  });

  it('rejects a header missing required keys', () => {
    const buf = buildHeader([
      { kind: 'flag', key: 'HEADER_START' },
      { kind: 'int', key: 'nbits', value: 8 },
      { kind: 'flag', key: 'HEADER_END' }
    ]);
    expect(() => parseFilterbankHeader(buf)).toThrow(/missing required keys/);
  });

  it('rejects an unknown keyword without guessing its type', () => {
    const buf = buildHeader([
      { kind: 'flag', key: 'HEADER_START' },
      { kind: 'int', key: 'nchans', value: 16 },
      { kind: 'int', key: 'nbits', value: 8 },
      { kind: 'double', key: 'fch1', value: 1.0 },
      { kind: 'double', key: 'foff', value: -0.001 },
      { kind: 'double', key: 'tsamp', value: 1.0 },
      { kind: 'flag', key: 'mystery_key' },
      { kind: 'flag', key: 'HEADER_END' }
    ]);
    expect(() => parseFilterbankHeader(buf)).toThrow(/Unknown SIGPROC keyword/);
  });

  it('rejects a truncated double value', () => {
    // Build a header that declares fch1 then runs out of bytes before the float64 fits.
    const enc = new TextEncoder();
    const keyBytes = (key: string) => {
      const ascii = enc.encode(key);
      const out = new Uint8Array(4 + ascii.length);
      new DataView(out.buffer).setUint32(0, ascii.length, true);
      out.set(ascii, 4);
      return out;
    };
    const start = keyBytes('HEADER_START');
    const fch1Key = keyBytes('fch1');
    // Allocate exactly enough for HEADER_START + fch1 keyword + 4 bytes of value (instead of 8)
    const total = new Uint8Array(start.length + fch1Key.length + 4);
    total.set(start, 0);
    total.set(fch1Key, start.length);
    expect(() => parseFilterbankHeader(total.buffer)).toThrow(/Truncated double|stalled/);
  });
});
