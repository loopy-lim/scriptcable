#include "ScriptcaHost.h"
#include <cstdio>
#include <iostream>

int main() {
  scriptca::Host host;
  std::printf("{\"sum\":%.0f,\"product\":%.0f,\"hi\":\"%s\"}\n",
              host.add(20, 22), host.mul(6, 7), host.greet("rn").c_str());
  auto json = host.callJson("add", "[1,2]");
  std::cout << "callJson add => " << json << "\n";
  return 0;
}
