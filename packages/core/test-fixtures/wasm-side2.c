/* Residual check: growth (retired region) + host-callback re-entrancy.
 * probe_concat3 reads param a, calls the host cb, then reads param a AGAIN —
 * if the inner re-entrant call freed the retired region holding `a`, the
 * post-callback re-read returns 0xDE poison bytes. */
#include <stdint.h>

#define WEXP(name) __attribute__((export_name(name)))

static unsigned char heap[524288];
static unsigned char* const heap_base = heap;
static unsigned int heap_pos = 0;

#define MAX_ALLOC 256
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

__attribute__((import_module("scriptc"))) __attribute__((import_name("cb")))
unsigned int cb_impl(unsigned int x);

static unsigned char outbuf[262144];

WEXP("probe_concat3") void probe_concat3(unsigned int ap, unsigned int al,
                                          unsigned int bp, unsigned int bl,
                                          unsigned int optr, unsigned int olen) {
  const unsigned char* a = (const unsigned char*)(uintptr_t)ap;
  const unsigned char* b = (const unsigned char*)(uintptr_t)bp;
  unsigned int k = 0;
  /* First half: from param a (currently in the RETIRED region after growth). */
  for (unsigned int i = 0; i < al / 2; i++) outbuf[k++] = a[i];
  /* Host callback — the JS side makes a re-entrant marshaled call here. */
  cb_impl(1);
  /* Second half: re-read param a AFTER the callback, then b. */
  for (unsigned int i = al / 2; i < al; i++) outbuf[k++] = a[i];
  outbuf[k++] = '|';
  for (unsigned int i = 0; i < bl; i++) outbuf[k++] = b[i];
  *(volatile unsigned int*)(uintptr_t)optr = (unsigned int)(uintptr_t)outbuf;
  *(volatile unsigned int*)(uintptr_t)olen = k;
}

/* Re-entrancy target for the residual probe. */
WEXP("probe_inner2") unsigned int probe_inner2(unsigned int x, unsigned int y) {
  return x + y;
}
