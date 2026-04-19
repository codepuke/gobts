import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const TESTDATA_DIR = join(import.meta.dir, 'testdata');
const GO_VERIFY_DIR = join(import.meta.dir, 'go_verify');

/** Load .gob bytes and parsed .json sidecar for a named fixture. */
export function loadTestdata(name: string): { gobBytes: Uint8Array; expected: unknown } {
  const gobPath = join(TESTDATA_DIR, `${name}.gob`);
  const jsonPath = join(TESTDATA_DIR, `${name}.json`);
  const gobBytes = readFileSync(gobPath) as unknown as Uint8Array;
  const expected = JSON.parse(readFileSync(jsonPath, 'utf8') as string) as unknown;
  return { gobBytes, expected };
}

/** All testdata fixture names (without extension). */
export const TESTDATA_NAMES: string[] = (() => {
  const { readdirSync } = require('fs') as typeof import('fs');
  return readdirSync(TESTDATA_DIR)
    .filter((f: string) => f.endsWith('.gob') && !f.endsWith('.gob:Zone.Identifier'))
    .map((f: string) => f.slice(0, -4))
    .sort();
})();

/** Returns true if `go` is on the PATH. */
export function goVerifyAvailable(): boolean {
  const result = spawnSync('go', ['version'], { encoding: 'utf8' });
  return result.status === 0;
}

/** Run the go_verify helper with gob bytes, return the decoded JSON result. */
export async function runGoVerify(testName: string, gobBytes: Uint8Array): Promise<unknown> {
  const result = spawnSync('go', ['run', '.', testName], {
    cwd: GO_VERIFY_DIR,
    input: Buffer.from(gobBytes),
    env: { ...process.env, GOPATH: process.env.GOPATH ?? '' },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`go_verify failed: ${result.error.message}`);
  }
  if (!result.stdout) {
    throw new Error(`go_verify produced no output for ${testName}: stderr=${result.stderr}`);
  }

  const parsed = JSON.parse(result.stdout) as { ok: boolean; value?: unknown; error?: string };
  if (!parsed.ok) {
    throw new Error(`go_verify returned error for ${testName}: ${parsed.error}`);
  }
  return parsed.value;
}

// ---------------------------------------------------------------------------
// Normalization for JSON comparison
// ---------------------------------------------------------------------------

import { GobObject, GobEncoded, Complex } from '../src/types.ts';

/** Convert a decoded gob value to a form comparable to the fixture JSON. */
export function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;

  if (value instanceof Uint8Array) {
    // Encode as base64 to match JSON sidecar format.
    return btoa(String.fromCharCode(...value));
  }

  if (value instanceof Complex) {
    return { real: value.re, imag: value.im };
  }

  if (value instanceof GobEncoded) {
    // Return enough info for comparison; tests check typeName separately.
    return { __gobEncoded: value.typeName, data: btoa(String.fromCharCode(...value.data)) };
  }

  if (value instanceof GobObject) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      obj[k] = normalize(v);
    }
    return obj;
  }

  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      obj[String(k)] = normalize(v);
    }
    return obj;
  }

  if (Array.isArray(value)) {
    return (value as unknown[]).map(normalize);
  }

  if (typeof value === 'object') {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      obj[k] = normalize(v);
    }
    return obj;
  }

  return value;
}
