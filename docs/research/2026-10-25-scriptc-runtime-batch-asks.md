# scriptc 런타임에 대한 배치·문자열 요구사항 제안 — 2026-10-25

**작성 계기**: scriptcable의 배치 API 2라운드(2026-10-25, `docs/plans/2026-10-25-batch-api.md` ·
`docs/plans/2026-10-25-so-batch.md`)가 측정으로 확정한 것 — **경계 밖(호스트 JS/C)에서 더
삭제할 비용은 이제 없다. 남은 per-op 비용의 주범은 scriptc 런타임 내부다.** 이 문서는
scriptc(컴파일러·`@scriptc/runtime-*`)에 대한 세 가지 요구를 실측 근거와 함께 정리한다.
관리 주체와 무관하게 이슈·제안·로드맵 재료로 쓰기 위한 독립 문서다.

## 측정으로 확정된 바 (linux-x64 WSL2, bun 1.4.4, 2026-10-25)

단일 문자열 호출(repeat("ab",100))의 비용 분해 — 계층별 왕복:

| 계층 | 왕복 | 분해 |
| --- | --- | --- |
| wasm (WASI) | ~1.04–1.19 µs | JS 마샬링 ~0.15–0.35 µs + **wasm 측 런타임 alloc/copy ~0.9 µs** |
| bun:ffi 직결 (.so) | 1.20–1.36 µs | JS 마샬링 + ffi 디스패치(~16ns 숫자) + **코어 측 C** |
| .so 배치 실행기(우리가 추가) | **842–898 ns/op** @64 | 경계+마샬링 상각 후 — 잔여는 순수 코어 측 |
| addon (napi) | 659–828 ns | 코어 측 C + napi 변환 |
| 순수 JS | ~356 ns | 참조 하한 |

핵심 숫자들:

- **문자열당 인코딩/디코딩(~150ns)**은 서로 다른 문자열마다 1회씩 필수 — 배치로 상쇄 불가.
  JS 와이어 코덱(encodeInto+TextDecoder)과 napi C 변환(`get_value_string_utf8` 2-pass +
  `create_string_utf8`)은 비용 등급이 같아, 배치가 상각하는 건 디스패치(~50ns)뿐이었다.
- **호스트 배치 실행기의 상한이 실측됐다**: 842ns/op(bun:ffi 문자열) — 여기서 JS·디스패치·
  napi가 전부 제거됐고 잔여 ~0.5–0.67µs가 전부 코어 측이다. 이것이 scriptc 런타임 개선의
  **정량 목표선**.
- 숫자 호출은 이미 해결: bun:ffi 직결 ~16ns, 애드온 24–47ns — 건드릴 것 없음.

## 요구 1 — 경계 내 배치 프리미티브(runtime export)

**요청**: 런타임이 `scriptc_batch` 류 export를 제공 — 인덱스 디스패치로 유저 함수를
경계 안에서 N회 호출.

- scriptcable은 이미 와이어 형식을 갖고 있다(meta Int32Array `[count, (exportIdx, argBase)×]`
  + args Uint8Array 슬롯/페이로드, 자기서술 결과 블록 — `packages/core/src/batch-wire.ts`
  상단 계약 주석이 스펙). 런타임이 같은 와이어를 그대로 소비하면 JS 측 무변경으로 wasm이
  호스트 실행기와 동등해진다.
- 생성 애드온·.so 실행기의 C 코드젠(`napi-addon.ts`의 `cBatchEntry`)이 프로파일별 파서를
  이미 생성한다 — scriptc 쪽 코드젠도 동일 패턴 적용 가능.
- **예상 효과(근거)**: wasm 문자열 per-op에서 JS 루프 폴백(현재 ~1.08–1.16µs) 대비
  경계+마샬링 상각으로 **~0.7–0.8µs/op까지** — 단, 잔여 런타임 alloc/copy가 요구 2의 몫.
- 안전 요건(호스트 구현에서 배운 것): 결과 커서 `_Thread_local`(공유 시 95% 손상·힙
  overread 재현), 성장 시 지연 해제(재진입 use-after-free), 와이어 경계 검증.

## 요구 2 — 입력 zero-copy / arena 수명

**요청**: 런타임이 호스트가 제공한 (ptr,len)을 재복사하지 않고 소비하고, 호출당 malloc/free를
배치 단위 arena reset으로 대체.

- 현재 런타임은 입력을 내부 표현으로 재할당·복사하고 결과도 새 버퍼에 복사하는 것으로
  보인다(요구 1의 842ns/op 잔여 분해가 이것 — 유저 함수 실작업은 ~200바이트 문자열 조작에
  불과). 출력은 이미 호출자 out-slot(ptr,len)이라 절반은 해결돼 있다.
- 스펙 옵션(선언만으로 충분 — scriptc가 선택): (a) 문자열 파라미터를 소유하지 않는
  뷰로 수신(빌림 수명 = 호출 동안), (b) `scriptc_alloc` 영역을 arena로 삼아
  `scriptc_arena_reset` 제공, (c) 결과도 호출자 제공 버퍼에 기록(out-slot 확장).
- **예상 효과**: 문자열 per-op 하한이 ~842ns → 인코딩/디코딩(~150ns)+실작업 수준까지.
  이것이 "채터링 문자열 API가 scriptcable에서 이기는" 문의 실질 해법이다. coarse export
  권장 문구(BENCHMARK §8-9)는 이 요구가 받아들여지기 전까지의 처방.

## 요구 3 — export 테이블 디스패치(reference-types)

**요청**: 유저 export를 exported funcref table에 올려주면, scriptcable이 (또는 런타임이)
동반 wasm 실행기 모듈로 `call_indirect` 루프를 돌릴 수 있다 — 런타임 코드젠 변경 없이도
경계 내 배치가 가능해지는 경량 경로.

- 각 인스턴스가 자기 linear memory를 갖는 WASI reactor 구조라 모듈 합성은 불가하지만,
  funcref table 교차 호출은 메모리 공유를 요구하지 않는다.
- 우선순위는 요구 1·2에 밀린다(런타임 내부 배치가 더 간단하고 저렴) — 요구 1·2가
  받아들여지기 어려운 경우의 대안으로 기록.

## 부수 정정 (scriptcable 측 — 이미 반영)

- 애드온 bool 파라미터가 비존재 `napi_get_value_boolean`을 생성하던 것은 scriptcable
  코드젠 결함(정상 심볼 `napi_get_value_bool`) — 2026-10-25 수정.
- `_Thread_local` 스태틱은 `-fPIC` 없이 컴파일 시 local-exec TLS 재배치로 `-shared` 링크
  실패(R_X86_64_TPOFF32) — link-shared에 `-fPIC` 상시 적용. NDK/zig 드라이버는 PIC 기본이라
  android만 무사했던 함정.

## 재현

```bash
bun run --filter @scriptcable/example-bench-core build
bun run --filter @scriptcable/example-bench-core bench   # 배치 표 포함
bun examples/bench-core/scripts/bench-node.ts            # CI에서 Node(V8) 몫
```
