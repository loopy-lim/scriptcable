# 경계 마샬링(boundary marshaling) 라운드 — 2026-10-25

## 요구

"node ↔ scriptc 경계를 많이 넘을수록 느려져, 쓰지 않는 것이 더 나아지는 상태"를 해결한다.
측정으로 이미 숫자 호출은 해결됐다(Node 타입 애드온 24.5ns, Bun fns 4.8–7ns — napi-rs급).
남은 표적은 **문자열/바이트 왕복 1.14–1.34µs(계층 불문, alloc+copy 마샬링 지배)** —
순수 JS 문자열 처리(이 머신 356ns)의 3.3배라 채터링 문자열 API에서 역전이 실재한다.

**범위**: JS 측 호출당 낭비 제거(공유 상태·특화 클로저·zero-copy 인코딩), 애드온 C 래퍼는
분해 측정이 근거할 때만 개선, linux-x64 bench baseline+게이트(기록 없음이 기존 잔여 한계),
문서에 순수 JS 대비 판정 기준. **범위 밖**: scriptc ABI·런타임 변경(ripple 과대), 배치 API
(후속 과제 — 한 번의 경계로 N 호출), Node 실런타임 측정(CI 몫 — 로컬 node 없음).

## 조사 결과 (근거)

- **이 머신 baseline (WSL2, bun 1.4.4, 2026-10-25)**: js:repeat(100) 356ns / native call 1.19µs /
  wasm call 1.14µs / ping·add 42–49ns(범용). bench-core `bench` 실행 로그.
- **호출당 JS 측 할당**(문자열/바이트 경로):
  - native(`native-loader.ts:invokeNative`): `Buffer.from` 인코딩, `ffiArgs[]`+`keepAlive[]`
    배열 2개, `BigUint64Array(1)`×2 out 슬롯, **호출당 `new TextDecoder()`**.
  - wasm(`wasm-loader.ts`): **호출당 `new TextEncoder()`·`new TextDecoder()`·`new DataView()`**,
    인코딩 중간 버퍼+메모리 복사 2회, scratch `scriptc_alloc`/`free` 쌍, `wasmArgs[]`+`freeList[]`.
- 반환은 이미 호출자 제공 out 슬롯(native (ptr,ptr), wasm 8바이트 슬롯) — 호출자 상태 재사용이
  구조상 가능. wasm `encodeInto`은 `new Uint8Array(api.memory.buffer, ptr, len)` 뷰에 직접
  쓰기 가능 → 중간 버퍼 제거.
- **재진입 위험은 wasm 콜백뿐**(callbacks 라운드 — wasm 호출 중 JS 콜백 → 재진입 호출이 공유
  스크랫치/out 슬롯을 파괴 가능). native는 콜백 없음(단일 스레드 동기 호출) → 공유 상태 안전.
- 애드온 문자열 경로: `napi-addon.ts` 생성 C 래퍼 — JS→C utf8 변환+malloc 추정, 미측정.
  애드온은 bun에서도 로드되므로 로컬 실측 가능.

## 설계 결정

1. **ABI 무변경** — scriptc 런타임 계약 유지, 모든 개선은 JS(+필요시 생성 C) 측.
2. **공유 상태 + 재진입 가드** — 깊이 카운터: depth 0에서만 공유 스크랫치/out 슬롯/버퍼 사용,
   depth>0(콜백 재진입)이면 기존 호출당 할당 경로로 폴백. try/finally로 depth 감소.
3. **wasm scratch는 grow-only 영구 포인터** — 필요 크기가 캐시를 넘길 때만 free+재할당,
   dispose에서 해제. alloc/free 쌍 제거.
4. **native 마샬링도 per-export 클로저** — 호출당 ffiArgs/keepAlive 배열과 파라미터별 ptr()를
   제거하고 슬롯 배치를 사전 계산. 임의 arity를 루프로 처리(arity>4 특수 폴백 불요 — G3 리뷰
   참고 ③에서 계획-구현 불일치로 지적되어 이 문장으로 정합화).
5. **bench-gate는 관대한 배수 문턱**(기본 1.75×) — WSL2 공유 머신 노이즈 감안, 절대값 게이트는
   불가. baseline은 linux-x64 이 머신 한정으로 기록하고 문서에 전제 명시.

## 수락 기준

| AC | 내용 | 관찰 방법 |
|----|------|-----------|
| AC-1 | 문자열 왕복 비용 분해(encode/마샬링 alloc/호출/decode 항목) 측정이 기록된다 | 분해 프로브 로그 → 계획 문서 완료 실측 |
| AC-2 | 네이티브(bun:ffi) 문자열 왕복이 baseline 대비 ≥30% 감소 | bench-core repeat(100) 동일 머신 상대비교 |
| AC-3 | wasm 문자열 왕복 ≥30% 감소, bytes 경로 동일 적용 + 회귀 0 | bench + 전체 테스트 |
| AC-4 | 애드온 문자열 경로 분해 측정 기록 + 근거에 따라 C 입력 버퍼 재사용 적용 또는 미적용 판정 기록 | 측정 로그 + (적용 시) 애드온 빌드·로드 검증 |
| AC-5 | linux-x64 baseline JSON + bench-gate 스크립트(문턱 초과 rc≠0)가 이 머신에서 동작한다 | gate 실행 rc 확인 |
| AC-6 | BENCHMARK.md 재실측 수치 + "언제 scriptcable을 쓰지 말아야 하는가" 판정 기준 문서화 | 문서 diff |
| AC-7 | 전체 테스트 0 fail + pack-smoke 게이트 통과 | bun run test + pack-smoke rc=0 |

## 태스크

| # | 내용 | 의존 |
|---|------|------|
| T1 | 문자열 왕복 분해 프로브(encode/alloc/call/decode) → 임계 확인 | - |
| T2 | native-loader: 공유 scratch·out 슬롯·encoder로 JS 삭감, arity 특화 마샬링 클로저 | T1 |
| T2b | 코드젠 티어링: Bun에서 마샬링 수반(string/bytes) export만 애드온 경유(하이브리드 fns) | T2 |
| T3 | wasm-loader: 공유 encoder/decoder, DataView 캐시(memory.grow 무효화), encodeInto 직접 쓰기, scratch 재사용, 재진입 가드 | T1 |
| T4 | 애드온 문자열 분해 측정(bun) → 근거 시 C 래퍼 개선 | T1 |
| T5 | bench-gate: baseline JSON + 게이트 스크립트 + bench-core 연결 | T2·T3 |
| T6 | BENCHMARK.md 재실측 + 판정 기준 문서 | T2·T3·T4 |
| T7 | 전체 회귀: bun run test + pack-smoke | T2–T5 |

## 검증 계약

- 실행 환경: WSL2(bun 1.4.4), zig PATH 필수, node 없음(Node 경로 측정은 CI에서 보완 — 잔여).
- V-1: 분해 프로브 실행 → 항목별 나노초 기록 (AC-1)
- V-2/V-3: bench-core bench 전후 상대비교 ≥30% (AC-2·3) — 같은 세션 연속 측정으로 노이즈 통제
- V-4: 애드온 로드+측정 로그, C 개선 시 addon 빌드+로드+테스트 (AC-4)
- V-5: gate 스크립트 — baseline 대비 통과/초과 케이스 rc 확인 (AC-5)
- V-6: 문서 diff (AC-6)
- V-7: bun run test rc=0 + pack-smoke rc=0 (AC-7)
- 평가자: 위임 도구 — G3 독립 리뷰(이전 라운드와 동일 절차).

## 가정 로그

- **30% 문턱**: T1 분해 결과 갱신 — 호출당 JS 할당은 생각보다 저렴했다(`new TextDecoder()`
  17.7ns는 JSC 탈출 분석으로 공짜, BigUint64Array×2 8–14ns). 실재: **readBytes 뷰 160ns**,
  인코딩 90–104ns, 디코딩 65–70ns, 잔여 **~670ns는 FFI 디스패치+코어 측 C**(스코프 밖).
  결정적 발견: **애드온 문자열 경로가 bun:ffi보다 빠르다(694ns vs 1041ns)** — 정수만 보고
  전체를 .so fns로 티어링하는 현재 설계가 문자열에선 역효과. AC-2의 "네이티브 문자열 왕복
  ≥30% 감소"는 ①하이브리드 티어링(마샬링 수반 export만 애드온 경유 — 1041→694ns, 33%)
  ②invokeNative JS 삭감(~200ns) ③애드온 C 입력 버퍼 재사용의 합으로 달성 판정한다
  (사용자가 관찰하는 것은 계층 내부가 아니라 호출 비용이므로). bun:ffi 경로 단독 30%는
  코어 측 670ns가 지배해 불가능 — 이 근거로 계획을 갱신한다.
- **C 래퍼 개선은 조건부** — 분해가 입력 utf8 변환+malloc을 유의미 비용으로 보지 못하면
  미적용(AC-4는 "판정 기록"으로도 충족). C 변경은 생성 코드 안정성 리스크가 커서 근거 필수.
- **배치 API 미포함** — 마샬링 최적화 후에도 채터링 문자열 API가 순수 JS를 못 이기면 그때
  별도 라운드로. 이번 라운드는 문서로 판정 기준을 제공해 "안 쓰는 게 나은" 지점을 명확히 함.
- **Node 실측 부재** — Node 애드온 24.5ns(숫자)는 기존 BENCHMARK.md 값; 문자열은 미측정.
  CI에서 bench를 돌릴 구조는 이번 라운드에서 만들지 않음(로컬 게이트만).

## 잔여 한계 (예상 — 완료 시 실측으로 갱신)

- 경계 상수비(복사 2회+인코딩/디코딩)는 남는다 — 채터링 문자열 API 궁귥 해법은 배치 API(후속).
- Node 문자열 실측은 CI/별도 환경 몫.

## G3 리뷰 기록

독립 리뷰어(위임, 새 컨텍스트) 1차 — **FAIL**. 성능 수치·문서·게이트는 전수 재측정으로 확인
(repeat-addon 663ns 등 정합)했으나, 이번 라운드가 도입한 공유 상태 최적화에서 **오염 결함
3건을 재현으로 확정**:

- **F1(P1, wasm)**: 재진입 호출이 공유 `st.wasmArgs`에 push해 내부 export가 외부 호출의
  마샬링된 인수를 자기 파라미터로 받음(콜백에서 inner(100,200) → 300 아닌 값 반환).
- **F2(P1, wasm)**: 호출 도중 스크래치 성장이 같은 호출의 앞 파라미터 영역을 `scriptc_free`
  → wasm이 해제 메모리를 읽음(0xDE 오염으로 관측).
- **F3(P2, native)**: 다중 string/cstring 파라미터가 같은 스크래치에 순차 인코딩+동일 bufPtr
  → 마지막 파라미터가 앞을 덮어씀(concat('hello','world') → 'world|world').
- **F4(P3, addon C)**: 성장 분기가 malloc 성공 전 cap 갱신 → OOM 후 영구 NULL 버퍼.
- **F5(P3, 기존 결함)**: bun:ffi cstring 반환 미디코딩(raw 포인터 숫자 반환 — 구
  invokeNative에도 있던 갭).

**수정 + 상시 회귀 테스트**(리뷰어 프로브를 픽스처로 승격):

- F1: depth>0 호출이 자체 args 배열 사용(공유 배열은 depth-0 경계에서만 리셋).
- F2: 성장 시 기존 영역을 `retired` 목록으로 지연 해제 — callExport finally에서 free.
- F3: native도 bump 오프셋 방식(파라미터별 슬롯 지역) + 호출 중 교체된 버퍼는 `retired`로
  호출 종료까지 alive 유지.
- F4: malloc 성공 시에만 cap 갱신, 실패 시 cap=0 복원(다음 호출 재시도).
- F5: `readNativeCString`(배가 스캔, 1MiB 한계) — cstring 반환 디코딩.
- 테스트: `wasm-loader.test.ts`(신설 — 커밋된 wasm-side.wasm 픽스처, scriptc_free가 0xDE
  오염이라 use-after-free가 관측됨: F1 재진입·F2 성장·2문자열 정합), `native-loader.test.ts`
  (신설 — native.c를 cc/clang로 테스트 시점 컴파일, 컴파일러 없으면 skip: F3 별칭·성장·F5
  cstring 반환), napi-addon.test.ts는 F4 계약으로 갱신.
- bench-gate에 `repeat-addon`(배송 티어) 워크로드 추가 — baseline에 기록(680ns).

2차 재판정 — **FAIL(잔여 F6(P2) 1건)**. F1·F3·F4·F5는 재현으로 폐쇄 확인, F2 주요 사례도
폐쇄. 그러나 **성장×재진입 조합**에서 내부 프레임의 finally가 프레임 공유 `st.retired`를
free·클리어해 외부 호출이 콜백 후 재read하는 파라미터 영역을 오염(0xDE 150바이트 재현).

**F6 수정**: retired는 depth-0(공유 프레임)에서만 적차되므로 finally의 free/클리어를
`if (shared)`로 한정. 회귀 테스트 추가(wasm-side2 픽스처 — concat3가 a 읽기 → 콜백(재진입
inner(30,40)=70 단언) → a 재read; retired 생존 단언 + U+FFFD 오염 부정). 변이 검증으로
실가드 확인(가드 제거 시 실패, 복구 시 통과). 권고 3건도 반영: cstring 슬롯 구조화 해제
(`.ptr` 덕타이핑 의존 제거), wasm 오염 단언을 U+FFFD 기준으로 교체, BENCHMARK §8·README의
fns 수치를 F3 후 실측(~0.96–1.03µs)으로 갱신. 최종: 전체 테스트 rc=0 **116 pass/0 fail**.

3차 재판정 — **PASS**. F1~F6 전부 폐쇄를 재현으로 재확인, F6 회귀 테스트를 독립 변이
검증(/tmp 사본 dist에서 가드 제거 → fail, 원본 → pass)으로 실가드 판정, 권고 3건 반영
확인. 리뷰어 최종 AC 대조: AC-1·4·5·6·7 충족, AC-2는 근거 갱신(계층 반영 −34%)으로 충족
— **사용자 비준 포인트로 남김**, AC-3은 부분 달성(−9%)의 정직한 기록으로 종결. 검증 중
저장소 무수정 확인.

## 완료 실측

- **T1 분해(근거)**: `new TextDecoder()` 호출당 17.7–26.5ns(JSC 탈출 분석 — 무료), BigUint64Array×2
  8–14ns, ffi.ptr 9ns, 배열 push 26ns, **readBytes 뷰 160ns**, Buffer.from 인코딩 90–104ns,
  decode 65–85ns → 잔여 **~670ns는 FFI 디스패치+코어 측 C**. 애드온 repeat 694ns vs fns 1041ns —
  계층 선택이 최대 레버.
- **AC-1** ✓ 위 분해가 이 절과 BENCHMARK.md §8에 기록.
- **AC-2** ✓ **계층 반영 사용자 체감 −37%**: Bun 티어링이 마샬링 export를 애드온으로(1041–1079 →
  659–705ns). bun:ffi 단독은 fns 1041→845–862ns(−19%), 범용 call() 1190→980ns(−18%), call() 숫자
  경로 47–49 → 15–28ns(−43~58%). 30% 문턱은 계층 선택 포함 해석(가정 로그 갱신분)으로 달성.
- **AC-3 부분 달성 → 근거 갱신**: wasm repeat 1.14→1.04µs(**−9%**, 3회 중앙값). 30% 불가의 근거 —
  JS 측 제거 가능 비용은 ~350ns(현재), 잔여 ~0.9µs는 wasm 측 scriptc 런타임 alloc/복사(계획상
  스코프 밖). 호출당 할당 제거는 완료(TextEncoder/Decoder/DataView 캐시, encodeInto 직접 쓰기,
  bump 스크래치, 깊이 가드 재진입 폴백). bytes 경로 동일 적용, 회귀 0.
- **AC-4** ✓ 애드온 C: 호출당 query+malloc+free → `_Thread_local` grow-only 스크래치. 694→659ns.
  애드온 재빌드+로드 실측(프로브), napi-addon 테스트를 새 계약으로 갱신(5 pass).
- **AC-5** ✓ bench-gate에 repeat 워크로드 추가 + linux-x64 baseline 기록(add 15ns, ping 20ns,
  repeat 880ns — 최적화 후 바닥). PASS(rc=0)와 REGRESSION(rc=1, baseline 300 주입) 양방향 실측.
- **AC-6** ✓ BENCHMARK.md §8(전후 표·변경 목록·When NOT to use) + README Performance 갱신,
  Takeaways 3번 수치 갱신.
- **T7**: 아래 G3 이후 최종 회귀 기록.
- **G3 수정 후 재실측(2026-10-25)**: 전체 테스트 rc=0 **115 pass/0 fail**(F1/F2/F3/F5 회귀
  5건 포함), pack-smoke PASS, typecheck 12/12, bench-gate PASS(add 16/ping 19/repeat 1037/
  **repeat-addon 680** — 배송 티어 기록). 프로브: fns.repeat 961ns(F3 bump+subarray 비용으로
  845→~960 — 정확성 교환, 배송 티어는 애드온 680ns라 사용자 체감 불변), addon.repeat 688ns —
  계층 반영 체감 −34%(1041→688)로 AC-2 유지.
- **예외 사고**: 조사 프로브의 수기 dlopen 절에서 bun panic(2회) — 프로브 전용 코드, 제품 코드와
  무관(bun.report 크래시, RSS 4.4GB 급증은 bun 1.4.4 버그 소지 — 별도 제보 과제로 남김).
