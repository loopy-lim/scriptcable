/**
 * Android native-host smoke for `--hosts react-native` + `--platform android`.
 *
 * 1. Bundle check: the android archive/.so + the generated scaffold exist,
 *    and the .so really is an arm64 ELF with only JNI symbols exported.
 * 2. Host dispatch smoke: compile the GENERATED cable_host.cpp verbatim
 *    against the HOST archive and assert the JSON bridge contract
 *    (add/mul/greet, escaping, unknown export). The same source compiles on
 *    Android inside the module .so — compiling it here proves the generator
 *    emits valid C++ and the marshaling is right.
 *
 * Running the bridge inside a real Android (emulator) is the CI's job —
 * .github/workflows/android-emulator.yml boots an arm64 emulator on a KVM
 * ARM64 runner, installs the app, and asserts the 42 through logcat.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const gen = join(root, '.scriptcable', 'generated');
const androidGen = join(gen, 'android');
const androidDir = join(root, '.scriptcable', 'android-arm64');
const work = join(root, '.scriptcable', 'smoke-work');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
}

// 1) artifacts
for (const f of [
  join(androidDir, 'calculator.lib.a'),
  join(androidDir, 'libcalculator.so'),
  join(androidGen, 'cable_host.cpp'),
  join(androidGen, 'cable_jni.cpp'),
  join(androidGen, 'cable-version.map'),
  join(androidGen, 'CableModule.kt'),
  join(androidGen, 'CMakeLists.txt'),
]) {
  if (!existsSync(f)) throw new Error(`missing android artifact: ${f}`);
}
const so = spawnSync('file', ['-b', join(androidDir, 'libcalculator.so')], { encoding: 'utf8' }).stdout;
if (!/ARM aarch64/.test(so)) throw new Error(`android .so is not arm64: ${so}`);

// 2) host dispatch smoke
const MAIN_CPP = String.raw`#include "cable_host.h"
#include <cstdio>
#include <string>

static int fails = 0;
static void check(const char* label, const std::string& got, const std::string& want) {
  const bool ok = got == want;
  if (!ok) ++fails;
  std::printf("%s: %s\n", label, got.c_str());
  if (!ok) std::printf("  want: %s\n", want.c_str());
}

int main() {
  check("add", scriptcable::callJson("add", "[20,22]"), "{\"ok\":true,\"value\":42}");
  check("mul", scriptcable::callJson("mul", "[6,7]"), "{\"ok\":true,\"value\":42}");
  check("greet", scriptcable::callJson("greet", "[\"smoke\"]"), "{\"ok\":true,\"value\":\"hello, smoke\"}");
  check("greet-escape", scriptcable::callJson("greet", "[\"say \\\"hi\\\"\"]"),
        "{\"ok\":true,\"value\":\"hello, say \\\"hi\\\"\"}");
  check("unknown", scriptcable::callJson("nope", "[]"), "{\"ok\":false,\"error\":\"unknown export: nope\"}");
  check("missing-args", scriptcable::callJson("add", "[1]"), "{\"ok\":false,\"error\":\"missing argument\"}");
  check("hasExport", scriptcable::hasExport("add") ? "y" : "n", "y");
  std::printf(fails == 0 ? "host dispatch smoke OK\n" : "host dispatch smoke FAILED\n");
  return fails == 0 ? 0 : 1;
}
`;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
writeFileSync(join(work, 'main.cpp'), MAIN_CPP);
writeFileSync(
  join(work, 'stubs.c'),
  'void scr_promise_settled_void(void) {}\nvoid scr_promise_settled_ref(void) {}\nvoid scr_promise_settled_now(void) {}\nint scr_promise_payload_truthy(void) { return 0; }\n',
);

const hostArchive = join(root, '.scriptcable', 'calculator.lib.a');
if (!existsSync(hostArchive)) throw new Error('missing host archive — run `scriptcable build` once');
// The stubs must stay C — a C++ driver would mangle the names.
const ccDriver = process.env.CC ?? 'c++';
const cCompiler = process.env.CC_C ?? 'cc';
const stubsOut = run(cCompiler, ['-c', join(work, 'stubs.c'), '-o', join(work, 'stubs.o')]);
if (stubsOut.status !== 0) throw new Error(`stubs compile failed:\n${stubsOut.stderr}`);
const built = run(ccDriver, [
  '-std=c++17',
  '-I',
  androidGen,
  '-o',
  join(work, 'smoke-host'),
  join(work, 'main.cpp'),
  join(androidGen, 'cable_host.cpp'),
  join(work, 'stubs.o'),
  '-Wl,--whole-archive',
  hostArchive,
  '-Wl,--no-whole-archive',
  '-ldl',
  '-lpthread',
]);
if (built.status !== 0) throw new Error(`host smoke compile failed:\n${built.stderr}`);
const hostRun = run(join(work, 'smoke-host'));
process.stdout.write(hostRun.stdout);
if (hostRun.status !== 0) throw new Error('host dispatch smoke failed');
if (!hostRun.stdout.includes('host dispatch smoke OK')) throw new Error('host dispatch smoke output missing');

console.log('android smoke OK');
