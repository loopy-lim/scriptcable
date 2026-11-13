# Bun AoT(`--compile --bytecode`) 조사 — 2026-11-13

요청: "Bun이 이번에 AoT로 성능 업그레이드한다던데 그것도 봐주면 좋겠다."

## 결론

"AoT"의 정체는 **Bun 1.4.1의 `bun build --compile --bytecode` (JavaScriptCore 바이트코드 ahead-of-time 직렬화) 대규모 개선**이다. 단일 JIT/AoT 네이티브 컴파일 같은 근본적 전환은 아니고, 컴파일 실행파일의 **시작 성능·크기** 최적화 계열이다. 이 레포(scriptcable)는 이미 bun 1.4.3(1.4.1 개선 포함)을 쓰고 있으나 **`bun build --compile` 산출물이 없어 당장 적용할 지점이 없다.** 핵심 성능(AoT 네이티브 코드)은 어차피 scriptc(LLVM 백엔드)가 담당한다.

## 1.4.1에서 바뀐 것 (bun.sh/blog/bun-v1.4.1)

- **바이트코드 9x → 3x 축소**: 구조체 패킹·데이터 중복 제거로 직렬화 바이트코드가 소스 대비 9배에서 3배로. Claude Code 설치 용량 376 MB → 207 MB (-45%).
- **`--bytecode-depth`**: 중첩 함수의 AoT 바이트코드 깊이 제한. 깊이 넘는 함수는 첫 호출 시 컴파일 — 시작 비용과 바이너리 크기 트레이드오프 조절.
  `bun build --compile --bytecode --bytecode-depth=1 ./app.ts --outfile app`
- **크로스컴파일 + `--bytecode`**: 이제 지원됨. 바이트코드 캐시 포맷이 전 플랫폼 동일 → 같은 입력은 바이트 동일 실행파일.
- **컴파일 실행파일 로더 fast path**: 입력 대기까지 397 ms → 318 ms (-20%, Claude Code 실측).
- **`require()` 청크 분리**(`--split-require` 기본): 400개 지연 require 중 8개만 시작에 쓰는 벤치마크에서 시작 23.2 ms → 11.2 ms, 메모리 34.6 MB → 6.9 MB.
- 텍스트 임포트 사전 인코딩: 3 MB 텍스트 임포트가 바이너리 6 MB→3 MB, 메모리 12.6 MB→1 MB.

배경: Bun 1.4 자체(2026-08-20)가 Zig→Rust 재작성 + 유휴 CPU 5x↓·메모리 최대 35%↓·Linux 시작 2x↑이고, 1.4.1의 bytecode 라운드가 그 위에 얹힘.

## 이 레포에 적용하려면 (미래 후보)

scriptcable CLI 예컨대 `scriptcable` 실행파일을 `bun build --compile --bytecode`로 배포하기 시작하면 그 시점에 1.4.1+ 개선이 그대로 적용된다(별도 플래그 외 설정 불필요). 생성되는 클라이언트·코어 산출물(.so/.node/.wasm)은 Bun 실행파일이 아니므로 무관. CLI 실행파일 배포를 시작할 때 `--bytecode --bytecode-depth` 튜닝만 검토하면 된다.
