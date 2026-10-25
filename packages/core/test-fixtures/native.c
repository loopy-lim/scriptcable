#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void probe_init(void) {}

void probe_noop(void) {}

/* Two marshaled string params + marshaled return: echoes a + "|" + b. */
void concat(const uint8_t* a, int64_t alen, const uint8_t* b, int64_t blen,
            const uint8_t** out, int64_t* outlen) {
  uint8_t* buf = (uint8_t*)malloc((size_t)(alen + blen + 1));
  memcpy(buf, a, (size_t)alen);
  buf[alen] = '|';
  memcpy(buf + alen + 1, b, (size_t)blen);
  *out = buf;
  *outlen = alen + blen + 1;
}

/* Two cstring params, returns concatenated C string. */
const char* cc(const char* a, const char* b) {
  static char buf[512];
  snprintf(buf, sizeof(buf), "%s/%s", a, b);
  return buf;
}

/* Long single string param — forces scratch growth mid-marshal. */
void echo(const uint8_t* a, int64_t alen, const uint8_t** out, int64_t* outlen) {
  uint8_t* buf = (uint8_t*)malloc((size_t)alen);
  memcpy(buf, a, (size_t)alen);
  *out = buf;
  *outlen = alen;
}
