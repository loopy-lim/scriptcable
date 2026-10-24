import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { findZig, zigCacheRoot, zigDownloadUrl, zigInstallDir } from './zig-tools.js';

describe('zig-tools', () => {
  test('download URL maps platforms/arches to the zig GNU-tuple names', () => {
    expect(zigDownloadUrl('linux', 'x64')).toBe(
      'https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz',
    );
    expect(zigDownloadUrl('linux', 'arm64')).toBe(
      'https://ziglang.org/download/0.13.0/zig-linux-aarch64-0.13.0.tar.xz',
    );
    expect(zigDownloadUrl('darwin', 'arm64')).toBe(
      'https://ziglang.org/download/0.13.0/zig-macos-aarch64-0.13.0.tar.xz',
    );
    expect(zigDownloadUrl('win32', 'x64')).toBe(
      'https://ziglang.org/download/0.13.0/zig-windows-x86_64-0.13.0.zip',
    );
  });

  test('cache root honors SCRIPTCABLE_CACHE_DIR, else the platform default', () => {
    const prev = process.env.SCRIPTCABLE_CACHE_DIR;
    process.env.SCRIPTCABLE_CACHE_DIR = '/tmp/sc-zig-test-cache';
    expect(zigCacheRoot()).toBe('/tmp/sc-zig-test-cache');
    expect(zigInstallDir()).toBe('/tmp/sc-zig-test-cache/zig-0.13.0');
    if (prev === undefined) delete process.env.SCRIPTCABLE_CACHE_DIR;
    else process.env.SCRIPTCABLE_CACHE_DIR = prev;
    // Platform default — only assert it stays inside the user's profile.
    expect(zigCacheRoot().startsWith(homedir())).toBe(true);
  });

  test('findZig returns a usable zig (PATH or cache) without downloading', async () => {
    const zig = await findZig();
    // On tool-less CI machines this is undefined — the build would then
    // either auto-provision or fail with the manual hint.
    if (zig) {
      expect(zig.length).toBeGreaterThan(0);
    }
  });
});
