#include "ScriptcaHost.h"
#include <cstdio>
int main() {
  scriptca::Host h;
  std::printf("{\"sum\":%.0f,\"hi\":\"%s\"}\n", h.add(20,22), h.greet("lynx").c_str());
  return 0;
}
