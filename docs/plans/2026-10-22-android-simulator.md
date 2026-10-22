# 온디바이스 브리지 — Android 시뮬레이터 라운드 (에뮬레이터에서 TurboModule 브리지 실측)

- 날짜: 2026-10-22
- 기준 리비전: main @ 226b02a + deno/workers 라운드 작업 트리(미커밋)
- 원 요청: "다 한거지? 온디바이스가 없더라도 일단 시뮬레이터로 진행해보자" — 직전 라운드의 잔여 한계(RN/Lynx 온디바이스 브리지 미검증)를 시뮬레이터로 좁힌다.

## G0 intake (validate-plan intake 모드 — self-review, PASS)

**목표**: (1) 네이티브 TurboModule 호스트가 codegen 산출물로 나오게 한다(오늘날 README가 "Implement call(exportName, argsJson) dispatching to the C ABI"를 사용자 몫으로 남김 — 제로컨피그 갭), (2) Android 에뮬레이터에서 브리지 호출이 실측되게 한다 — 로컬 소프트웨어 에뮬레이션을 시도하고, KVM이 있는 CI 러너 경로를 함께 닫는다.

**관찰 가능한 AC로 전환한 결과**: 아래 표. 막힌 결정 없음.

**범위 밖**: iOS 시뮬레이터(이 환경은 Linux — macOS/Xcode 필요, 문서 유지), Lynx 기기(동일 인프라의 후속), RN 신구 아키텍처 전 스위치 매트릭스(신규 아키텍처 기본 1경로만).

## 현재 구조와 근거 (조사 완료, 2026-10-22 실측)

| 항목 | 실측 |
|---|---|
| `/dev/kvm` | 존재(crw-rw---- root:kvm)하나 loopy 미소속·sudo 불가 → **하드웨어 가속 불가** |
| WSL2 커널 | `CONFIG_ANDROID_BINDER_IPC is not set` → **redroid/waydroid 불가** (docker는 있음) |
| 남은 로컬 경로 | 에뮬레이터 소프트웨어 에뮬레이션(QEMU TCG, `-accel off`) — 부팅 수십 분 리스크. GH Actions ubuntu-latest는 **KVM 내장**(중첩 가상화 표준 관행) — 에뮬레이터 실증의 확실한 경로 |
| Java/디스크/메모리 | ~/tools/jdk17 유저공간 존재, 디스크 920G, RAM 58G, 32코어 — 충분 |
| `packages/react-native/src/native-host.ts` | 타입 선언뿐 — 네이티브 호스트 구현부 없음. `packages/react-native/README.md`: "Implement call(exportName, argsJson) dispatching to the C ABI (`{prefix}{export}` symbols)" — **사용자 몫으로 문서화돼 있음(이번에 메울 갭)** |
| `packages/core/src/link-shared.ts` | 링크는 호스트 전용(zig cc는 Windows에서만 드라이버로 사용, 타깃 플래그 없음) — android 크로스 링크 플럼빙 없음 |
| `packages/core/src/toolchain.ts:353` | `SCRIPTC_TARGET`은 wasm 경로에서만 설정. README iOS 레시피가 `SCRIPTC_TARGET=aarch64-apple-ios`를 언급 — scriptc 자체는 타깃 env 지원이 기대되나 **android 타깃 실측 미확증(조사 unknown — T-2 최우선 프로브)** |
| `examples/react-native-app` | android/ 프로젝트 없음(metro 번들 스모크 + mock 브리지 테스트만). expo 58 의존 설치됨(expo prebuild 경로 가능), scriptcable.json 존재 |
| 브리지 계약 | JS: `createTurboModuleBridge(NativeCable)` → `TurboModuleRegistry.getEnforcing('calculator')`의 `call(exportName, argsJson): Promise<string>`. 네이티브: C ABI `{prefix}{export}` — 문자열 (ptr,len) in / (out_ptr,out_len) out, f64, bool(0/1) |

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | `scriptcable build --hosts react-native`의 Android 변형이 네이티브 산출물 전체를 생성한다 — SCRIPTC_TARGET 크로스컴파일 `.lib.a`, zig cc `-target x86_64-linux-android`로 링크한 `lib{name}.so`, **네이티브 호스트 스캐폴드**(C++ dispatch 코어 + JNI 래퍼 + CMakeLists)가 generated에 emit된다 | T-2, T-3 | V-1, V-2 |
| AC-2 | 생성된 C++ dispatch 코어가 마샬링 계약을 지킨다 — 호스트에서 컴파일해 `callJson('add','[20,22]') === '42'`, `callJson('greet','["android"]') === '"hello, android"'`(JSON 프로토콜 round-trip)를 실측한다 | T-4 | V-3 |
| AC-3 | Android 앱 조립이 로컬에서 완성된다 — expo prebuild android + 생성 스캐폴드 연결, `gradle assembleDebug` 성공(브리지 네이티브 모듈 포함 APK) | T-5 | V-4 |
| AC-4 | 실제 Android 바이너리 컨텍스트에서 네이티브 호스트가 코어를 로드하고 dispatch가 42를 반환하는 것이 실측된다 — **로컬: qemu-user + bionic sysroot에서 android-arm64 스모크 실행**(1차 실측), **에뮬레이터 앱 경로: CI arm64+KVM 워크플로 제공**(실행은 푸시 후 CI 담당 — 한계로 문서화) | T-1, T-6 | V-5 |
| AC-5 | 회귀 없음 + 문서 — 전 패키지 test/typecheck/build, 기존 예제 회귀, README(영/한) RN 절 갱신("사용자 구현 몫" → 생성 스캐폴드), CHANGELOG, troubleshooting, CI | T-7 | V-6 |

## 설계

**T-1 SDK/에뮬레이터 환경**: 유저공간 ~/tools/android-sdk(cmdline-tools, platform-tools, emulator, system-images;android-30;google_apis;x86_64, platforms 34/35, build-tools 34). 부팅: `avdmanager create avd` 후 `emulator -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -accel off` — sys.boot_completed 폴링, 하드 타임아웃. JAVA_HOME=~/tools/jdk17.

**T-2 android .so 크로스 링크**: **구현 중 확정 — scriptc의 android 지원은 arm64 전용**(`SCRIPTC_TARGET=x86_64-linux-android` → "unsupported native compiler target" 실측; `aarch64-linux-android`는 타깃 인석 후 런타임 팩 요구 — SC3003). 실현된 설계: `ensureRuntimePack` 확장(`@scriptc/runtime-android-arm64` 자동 설치) → `SCRIPTC_TARGET=aarch64-linux-android`로 .lib.a → `zig cc -target aarch64-linux-android` 링크. 링크 성립에 두 가지 필수 플래그가 밝혀짐: **버전 스크립트**(`global: Java_*; local: *;` — 아카이브 오브젝트가 직접 PC-상대 참조를 쓰는데 공유 라이브러리에선 기본 가시성 심볼이 preemptible이라 lld가 거부 → JNI 엔트리만 export하고 나머지를 local로 묶어 해결)와 **`-nostdlib`**(zig에 bionic이 없어 "libc not available" 치명 오류 — dlopen 모듈은 libc 심볼을 런타임 바인딩에 맡김). 또한 lld는 `--version-script`의 값을 인수에 **붙여야** 함(분리 시 다음 플래그를 삼킴). 산출물은 `<outDir>/android-arm64/` 아래(호스트 .so와 충돌 방지). linkSharedLibrary에 target 옵션, buildCore에 platform 경로, CLI `--platform android` 플래그.

**T-3 네이티브 호스트 스캐폴드 codegen**: `--hosts react-native`가 추가 emit — `android/CableHost.cpp`(순수 dispatch 코어: dlopen 없는 정적 링크 전제, JSON 최소 파서/직렬화, `{prefix}{export}` 호출, wasm-loader의 마샬링 계약과 동일 — 문자열 (ptr,len) in/(out_ptr,out_len) out, f64, bool), `android/CableJni.cpp`(JNI 래퍼 — `call(name, argsJson): String`), `android/CMakeLists.txt`(lib{name}.a IMPORTED + 공유 라이브러리 빌드). 파일 분리 이유: dispatch 코어는 호스트 스모크(V-3)와 안드로이드 양쪽에서 동일 소스 컴파일.

**T-4 dispatch 호스트 스모크**: CableHost.cpp + 호스트 .so를 그대로 컴파일한 테스트 바이너리 — callJson 단언(AC-2). 스크립트는 examples/react-native-app/scripts/.

**T-5 Android 앱 조립**: `expo prebuild -p android`(예제의 expo 58 의존 활용) + 로컬 expo module 또는 app 내 네이티브 모듈로 스캐폴드 연결(구현 중 TurboModule 인터롭 실측으로 Expo Modules 경로 vs 순수 RN 모듈 경로 결정 — 근거 기록). `gradle assembleDebug` 성공까지.

**T-6 에뮬레이터 실측**: (계획 변경) qemu-user bionic 스모크는 **기각** — android 실행 바이너리는 bionic CRT(crtbegin_dynamic)의 TLS·`__libc_init` 세팅이 필요해 -nostdlib 크로스 링크만으로는 부팅 불가(손으로 CRT를 굴리는 비용 대비 CI 에뮬레이터가 정확하고 저렴). 확정 경로: **CI `ubuntu-24.04-arm`(KVM 내장, ARM 네이티브)에서 arm64 에뮬레이터** — `.github/workflows/android-emulator.yml`: test:android(크로스빌드+dispatch 스모크) → expo prebuild + wire-android → gradle assembleDebug(arm64-v8a) → 에뮬레이터 부팅 → adb reverse로 metro 공급 → 앱이 기기에서 브리지 호출 → **logcat의 `CABLE_RESULT:{"sum":42}` 단언**(앱의 App.tsx는 mock 폴백 없는 네이티브 전용 경로로 호출 — 실패가 CABLE_RESULT 에러로 드러남). 워크플로 실행은 푸시 후 CI가 담당 — 로컬에서 실행 불가는 한계로 문서화. Lynx는 이 인프라 위 후속.

**T-7 문서·CI·회귀**: README(영/한) RN/Expo 절 — 네이티브 스캐폴드가 생성된다고 갱신, CHANGELOG, troubleshooting(SCRIPTC_TARGET android, TCG 부팅, bionic 링크 차이), ci.yml 회귀 유지.

## 오류·경계

- **scriptc가 android 타깃을 거부하면** → AC-1/2/4는 BLOCKED(근거와 함께 기록) — wasm-on-RN은 브리지가 아니므로 대용 불가. 우도: README의 iOS 타깃 env 언급으로 지원 기대.
- **TCG 부팅 실패/타임아웃** → AC-4는 CI 경로로 승계, 로컬 시도 기록은 남김. 실패를 성공으로 갈아치우지 않음.
- **Expo 모듈 인터롭**(TurboModuleRegistry.getEnforcing이 Expo 모듈을 못 찾는 경우) → 순수 RN 네이티브 모듈 경로로 전환(prebuild 프로젝트에 직접 등록) — 근거 남기고 결정.
- **zig cc android 링크의 bionic 차이**(-lpthread 부재 등) → 플래그 분기, 실패 시 NDK clang 사용도 검토(유저공간 설치).
- **expo prebuild의 gradle 다운로드 볼륨** — 시간 예산에 포함, 실패해도 AC-3 이전 단계 산출은 유지.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 ID |
|---|---|---|---|---|
| T-1 | SDK/에뮬레이터 환경·부팅 시도 (AC-4) | 저장소 밖 ~/tools/android-sdk | 없음 | V-5 |
| T-2 | android .so 크로스 링크 (AC-1) | `packages/core/src/link-shared.ts`, `toolchain.ts`, `packages/cli`(플래그) | 없음 | V-1 |
| T-3 | 네이티브 호스트 스캐폴드 codegen (AC-1) | `packages/core/src/codegen.ts`(또는 react-native 패키지) | T-2 | V-1 |
| T-4 | dispatch 호스트 스모크 (AC-2) | `examples/react-native-app/scripts/` | T-3 | V-3 |
| T-5 | Android 앱 조립 (AC-3) | `examples/react-native-app/android`(생성) + 스캐폴드 연결 | T-3 | V-4 |
| T-6 | 에뮬레이터 실측/CI 경로 (AC-4) | `.github/workflows/android-emulator.yml`(필요 시) | T-1, T-5 | V-5 |
| T-7 | 문서·CI·회귀 (AC-5) | README(영/한), CHANGELOG, troubleshooting, ci.yml | T-2~T-6 | V-6 |

## 검증 계획과 결과

| ID | 방법 | 기대 | 실제 결과 | 판정 |
|---|---|---|---|---|
| V-1 | 생성물 검사 — `scriptcable build --target native --hosts react-native --platform android` 후 산출물 존재 | 전 산출물 존재 + 올바른 타깃 | `.scriptcable/android-arm64/calculator.lib.a` + `libcalculator.so` + `generated/android/` 6파일(cable_host.{h,cpp}, cable_jni.cpp, CableModule.kt, CablePackage.kt, CMakeLists.txt) — exit 0 | PASS |
| V-2 | `file`로 .so 아키텍처 확인 | android arm64 ELF | `ELF 64-bit LSB shared object, ARM aarch64` (x86_64 호스트에서 크로스 생산) | PASS |
| V-3 | dispatch 호스트 스모크 — 생성된 cable_host.cpp를 호스트 아카이브와 그대로 컴파일, callJson 단언 | add/mul=42, greet round-trip, 에러 케이스 | `add: {"ok":true,"value":42}` · mul 42 · greet + `\"` escape round-trip · unknown export · missing argument · `host dispatch smoke OK`, exit 0 (`test:android`로 최종 상태 재검증 포함) | PASS |
| V-4 | `gradle assembleDebug -PreactNativeArchitectures=arm64-v8a` (prebuild + wire-android 후) | APK 생성 | **BUILD SUCCESSFUL**, `app-debug.apk` 생성 — `unzip -l`로 `lib/arm64-v8a/libcalculator_cable.so`(1.06MB) 포함 확인(네이티브 브리지가 앱에 실림) | PASS |
| V-5 | 에뮬레이터 실측: (1) 로컬 qemu bionic — **기각**(CRT/TLS 필요) (2) **기기 실측 달성** — 이 환경의 Android 14 x86_64 에뮬레이터(KVM, 32초 부팅)에 JNI 프로브 앱(device-jni-probe) 설치·실행 → `add=42·mul=42·greet="hello, device"` → **"on-device bridge OK" logcat 실측** (3) RN JS 앱 경로는 RN 0.88/Expo 58 상위 런타임 문제(격리 실증)로 미기동 — CI 워크플로가 담당 | (2) 실기기 42 실측 (3) 워크플로 검수 완료 | (2) **PASS** (3) 실행은 푸시 후 | PASS(코어) / RN 계층 CI 대기 |
| V-6 | 루트 test/typecheck/build + 예제 회귀 + 문서 대조 | 전부 exit 0 | 패키지 test 0 fail·typecheck exit 0; 예제 **14종 전부 exit 0**(node/bun/vite/next/electron/astro/sveltekit/expo/**test:android**/deno/workers/nuxt/remix/solidstart); 최종 상태에서 test:android·core 71 pass·RN 단위 4 pass 재검증 | PASS |

## 구현 중 발견·해결한 사항 (계획 밖)

| 항목 | 내용 | 해결 |
|---|---|---|
| scriptc android 타깃은 arm64 전용 | `x86_64-linux-android` → "unsupported native compiler target"; `aarch64-linux-android` → SC3003 런타임 팩 요구(팩은 존재) | android-arm64 단일 경로로 확정, 팩 자동 설치(ensureRuntimePack 확장) |
| android .so 링크 3중 함정 | ① 아카이브 오브젝트의 직접 PC-상대 참조가 preemptible 심볼 대상으로는 `.so`에서 거부(R_AARCH64_ADR_PREL_PG_HI21) ② zig에 bionic 부재("libc not available" 치명) ③ lld는 `--version-script` 값을 인수에 붙여야 함 | ① 버전 스크립트(`global: Java_*; local: *;`) ② `-nostdlib`(libc 심볼은 런타임 바인딩) ③ `-Wl,--version-script=<path>` 단일 인수 — 전부 link-shared android 분기에 반영 |
| CMake 헤더 | 생성 CMakeLists가 C 스타일 `/* */` 주석으로 시작 → CMake 파스 에러 | `#` 주석 헤더로 생성 |
| gradle externalNativeBuild 위치 | android{} **바깥**(dependencies 앞)에 넣으면 "Could not find method externalNativeBuild()" | android{} 내부(buildTypes 앞)로 삽입 |
| reactNativeArchitectures 값 | `-PreactNativeArchitectures=arm64` → "[arm64] not supported"(정식 값은 arm64-v8a) | `arm64-v8a` 사용 |
| CMake 설정 캐시 | 경로 수정 후에도 .cxx의 stale configure가 옛 아카이브 경로 사용 | 재와이어 시 `rm -rf app/.cxx` |
| jni 디렉터리의 아카이브 상대경로 | generated(android/, 2단계)와 app jni(5단계)의 깊이 차이 | wire-android.mjs가 경로 치환해 복사 |
| CMake 링크에도 버전 스크립트 필요 | NDK lld가 같은 relocation 에러 — link-shared와 CMake 양쪽 모두 필요 | `cable-version.map`을 스캐폴드 7번째 산출로 emit, CMake target_link_options로 적용 |
| 스모크 stubs의 name mangling | g++가 stubs.c를 C++로 컴파일해 C 심볼 미매칭 | cc로 별도 컴파일 후 링크 |
| bunx의 cwd 상속 | bunx가 셸 cwd를 그대로 상속 — 잘못된 디렉터에서 실행 시 설정 탐색 실패(도구 버그 아님) | CI/문서는 항상 프로젝트 루트에서 실행 |

## 평가자

- 구현 직접 수행(단일 세션) — 기존 관례. G3는 독립 하위 에이전트.

## G3 리뷰 결함과 수정 (독립 평가자 초기 판정 FAIL → 8건 전부 수정·재검증)

독립 평가자가 core 테스트·test:android·신규 크로스빌드·APK 심볼 테이블(export된 global이 `Java_com_scriptcable_cable_CableModule_nativeCall` 하나임을 실측)·ABI 계약 대조(traced greet vs napi-addon cSignature)까지 재실행했고, 코어 플럼빙은 clean으로 확인 — 결함은 CI 워크플로·앱 기동 경로에 집중. 전부 수정 후 영향 검증 재실행.

| ID | 심각도 | 결함 | 수정 | 재검증 |
|---|---|---|---|---|
| F-1 | P1 | 워크플로가 ARM64 러너에 x86_64 zig를 다운로드 → 실행 불가 | `uname -m`으로 aarch64/x86_64 타볼 선택(죽은 이중 다운로드 명령도 제거) | 워크플로 검수 + YAML OK |
| F-2 | P1 | ubuntu-24.04-arm 러너에 Android SDK/ANDROID_HOME 부재 | cmdline-tools 부트스트랩 단계 신설(arch 무관 zip) → sdkmanager 설치, GITHUB_ENV로 전파 | 워크플로 검수 |
| F-3 | P1 | 워크플로의 `-PreactNativeArchitectures=arm64`(무효 값 — 계획 발견 표와 모순) | `arm64-v8a`로 수정 | 워크플로 내 grep 확인 |
| F-4 | P1 | 앱이 기동 불가 — 루트 진입점 없음, src/App.tsx 미해석, `require('./NativeCable')` 미해석(metro 정적 해석 실패) | 루트 `index.js`(registerRootComponent)+`"main"`, wire-android가 생성 NativeCable.ts를 src/로 복사, **신규 `test:app-bundle`** — 실제 `expo export`(metro 그래프)로 진입→App→NativeCable 해석을 로컬 증명 | `app-bundle smoke OK`(Hermes/.hbc 문자열 테이블 스캔 포함) |
| F-5 | P2 | bytes 인자가 호출 불가 — Parser::value에 `[` 처리 없어 Raw가 never 생산(bytesOf 가드는 죽은 코드) | 중첩 배열 Raw 슬라이스 파싱 구현(문자열 리터럴 인식 괄호 카운터) | 재생성 C++이 test:android에서 컴파일+계약 통과 |
| F-6 | P3 | androidCDecl에 'void' 누락 → void* 프로토타입 | case 'void' 추가 | core 테스트 0 fail |
| F-7 | P3 | jsonNumber가 범위 가드 전에 (long long) 캐스트(\|n\|≥2^63에서 UB) | 범위 검사를 캐스트 앞으로 | 생성물 검수 |
| F-8 | P3 | packages/react-native/README.md가 여전히 "Implement call…" 지침 + 산출물 표에 android 스캐폴드 누락 | 표에 7종 추가, Android 링크 절을 "생성됨"+wire 참조로 교체(iOS는 기존 지침 유지, cable_host.cpp를 dispatch 참조 구현으로 명시) | 문서 검수 |

평가자가 검증 못 한 것(기록 유지): 워크플로의 실제 실행(푸시 필요), arm64 에뮬레이터 바이너리의 sdkmanager 가용성(Google 이슈 이력상 불확실 — F-1~3 수정 후에도 CI 첫 실행에서 관찰 필요), gradle 재실행(본 세션에서 수정 후 재실행으로 보완 — BUILD SUCCESSFUL, APK의 .so 갱신 확인).

## G4 사용성·디자인: N/A

UI 변경 없음(툴체인·codegen·예제·CI·문서).

## G5 완료 (validate-plan completion — self-review, G3는 독립)

### G5 후 사용자 요청 — 이 환경에서 기기 생성·실행 (2026-10-22 심야)

사용자 요청 "지금 이 환경에 다른 안드로이드 기기를 만들어서 진행해봐"에 따라 로컬 기기 실측을 수행:

- **scriptc x86_64 android 트리플 최종 부재 확인**(3종 별칭 프로브 전부 unsupported) → x86_64 네이티브 모듈 불가 확정.
- 이 환경의 에뮬레이터 현황: 사용자의 Android 16 x86_64 에뮬레이터(~/android-sdk, KVM 가속 동작 확인) + 내가 만든 **Android 14 x86_64 에뮬레이터**(cable-x86, api-34 이미지 다운로드 → AVD → 32.5초 부팅).
- arm64 이미지는 에뮬레이터가 크로스 아키텍처 자체를 거부("System image must match the host architecture") — TCG 크로스 불가 실측.
- **하이브리드 APK**(RN x86_64 + arm64 브리지) 설치: 네이티브 모듈 로딩은 성공/실패 케이스 모두 관찰 — arm64 전용 APK는 SoLoader가 기기 선호 ABI(x86_64)로 APK 내부를 탐색해 실패(useLegacyPackaging=true로 추출 해결), 하이브리드에서는 스텁이 뜸 → **CableModule에 assets 추출·절대경로 로딩 폴백을 생성 템플릿에 추가**.
- **RN 0.88 + Expo 58 런타임 자체가 이 에뮬레이터들(Android 14/16, x86_64·arm64 번역 포함, debug/release 전부)에서 코어 TM 등록 실패**('PlatformConstants' could not be found → Global was not installed) — CablePackage 제거 격리 실험으로 동일 확인 = **scriptcable 무관의 상위 템플릿 호환 문제**로 판정.
- 판정에 따라 **RN 없는 순수 JNI 프로브 앱**(device-jni-probe — 생성 JNI 심볼과 동일 패키지/클래스 경로)을 만들어 기기에서 실행:
  **`add={"ok":true,"value":42} mul=42 greet="hello, device" / CABLE_RESULT:{"sum":42} / on-device bridge OK`** — 실제 Android 에뮬레이터 위에서 생성 네이티브 호스트(JNI→C++ dispatch→scriptc arm64 archive)의 전체 체인 실측.

| AC | 판정 | 증거 |
|---|---|---|
| AC-1 Android 네이티브 산출물 생성 | PASS | V-1/V-2 — android-arm64 .lib.a + arm64 ELF .so + 스캐폴드(8종: dummy_abi.cpp 추가); G3가 신규 빌드 강제 재실행 + APK 심볼 테이블 추적 |
| AC-2 dispatch 계약 | PASS | V-3 — 생성 C++ 호스트 컴파일 + JSON 계약 전 케이스; G3 독립 재실행 + ABI 추적 일치. **기기 실측으로 재확인**(아래) |
| AC-3 앱 조립 | PASS | V-4 — gradle assembleDebug/Release BUILD SUCCESSFUL, APK에 브리지 .so 포함 확인; launchability는 test:app-bundle |
| AC-4 기기 실측 | **PASS(코어) / RN JS 계층만 CI 대기** | **온디바이스: 이 환경의 Android 14 에뮬레이터에서 JNI 프로브가 add=42·greet round-trip 실측("on-device bridge OK")** — 생성 네이티브 호스트가 기기에서 동작함을 실증. RN JS 앱 경로는 RN 0.88/Expo 58 상위 런타임 문제(격리 실증)로 미기동 — CI android-emulator.yml이 RN 경로 검증 담당 |
| AC-5 회귀·문서 | PASS | V-6 — 패키지 test 0 fail·typecheck exit 0, 예제 14종 exit 0, README(영/한)·CHANGELOG·troubleshooting·CI 갱신 |

**잔여 한계**: RN JS 앱의 기기 기동은 RN 0.88/Expo 58 × Android 14/16 에뮬레이터 상위 호환 문제로 미해결(격리 실증 — scriptcable 무관, 상위 업데이트 대기 또는 RN/Expo 버전 교체 실험), x86_64 안드로이드용 scriptc 타깃 부재(arm64 전용), iOS 네이티브 호스트는 사용자 구현, Lynx는 동일 인프라 후속.
