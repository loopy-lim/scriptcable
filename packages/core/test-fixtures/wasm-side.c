/* Freestanding wasm module modeling the scriptc runtime contract:
 * scriptc_alloc / scriptc_free / memory + marshaled exports.
 * Uses absolute linear-memory addressing for alloc'd regions.
 * scriptc_free POISONS the freed range (0xDE) — a conforming allocator may
 * reuse freed memory, so anything read from a freed region is garbage. */
#include <stdint.h>

#define WEXP(name) __attribute__((export_name(name)))

static unsigned char heap[262144];
static unsigned char* const heap_base = heap;
static unsigned int heap_pos = 0;

#define MAX_ALLOC 128
static unsigned int allocs[MAX_ALLOC][2];
static int nallocs = 0;

WEXP("scriptc_alloc") unsigned int scriptc_alloc(unsigned int n) {
  unsigned int p = (unsigned int)(uintptr_t)(heap_base + heap_pos);
  if (n == 0) n = 1;
  heap_pos += n;
  if (nallocs < MAX_ALLOC) { allocs[nallocs][0] = p; allocs[nallocs][1] = n; nallocs++; }
  return p;
}

WEXP("scriptc_free") void scriptc_free(unsigned int p) {
  for (int i = 0; i < nallocs; i++) {
    if (allocs[i][0] == p) {
      unsigned char* q = (unsigned char*)(uintptr_t)p;
      for (unsigned int j = 0; j < allocs[i][1]; j++) q[j] = 0xDE;
      allocs[i][0] = 0; allocs[i][1] = 0;
      return;
    }
  }
}

WEXP("probe_init") void probe_init(void) {}

/* concat2(a_ptr, a_len, b_ptr, b_len, out_ptr_slot, out_len_slot) -> void
 * Builds a + "|" + b in a static buffer so the JS side can observe what the
 * module actually read from each param pointer. */
static unsigned char outbuf[65536];

WEXP("probe_concat2") void probe_concat2(unsigned int ap, unsigned int al,
                                          unsigned int bp, unsigned int bl,
                                          unsigned int optr, unsigned int olen) {
  unsigned int k = 0;
  const unsigned char* a = (const unsigned char*)(uintptr_t)ap;
  const unsigned char* b = (const unsigned char*)(uintptr_t)bp;
  for (unsigned int i = 0; i < al; i++) outbuf[k++] = a[i];
  outbuf[k++] = '|';
  for (unsigned int i = 0; i < bl; i++) outbuf[k++] = b[i];
  *(volatile unsigned int*)(uintptr_t)optr = (unsigned int)(uintptr_t)outbuf;
  *(volatile unsigned int*)(uintptr_t)olen = k;
}

/* Single long param — sanity for the growth path without multi-param. */
WEXP("probe_echo") void probe_echo(unsigned int ap, unsigned int al,
                                    unsigned int optr, unsigned int olen) {
  static unsigned char ebuf[65536];
  const unsigned char* a = (const unsigned char*)(uintptr_t)ap;
  for (unsigned int i = 0; i < al; i++) ebuf[i] = a[i];
  *(volatile unsigned int*)(uintptr_t)optr = (unsigned int)(uintptr_t)ebuf;
  *(volatile unsigned int*)(uintptr_t)olen = al;
}

/* Host callback hook: wasm calls cb(7); the JS side will call probe_inner. */
__attribute__((import_module("scriptc"))) __attribute__((import_name("cb")))
unsigned int cb_impl(unsigned int x);

WEXP("probe_outer") unsigned int probe_outer(unsigned int p, unsigned int l) {
  return cb_impl(7);
}

/* Re-entrancy target: inner(100, 200) must be seen as a=100,b=200 → 300. */
WEXP("probe_inner") unsigned int probe_inner(unsigned int a, unsigned int b) {
  return a + b;
}
