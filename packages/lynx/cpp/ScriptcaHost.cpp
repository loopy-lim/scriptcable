#include "ScriptcaHost.h"
#include <cstdlib>
#include <cstring>
#include <stdexcept>

extern "C" {
void calc_init();
double calc_add(double a, double b);
double calc_mul(double a, double b);
void calc_greet(const uint8_t* in_ptr, int64_t in_len, uint8_t** out_ptr, size_t* out_len);
}

namespace scriptca {

Host::Host() { calc_init(); }

double Host::add(double a, double b) { return calc_add(a, b); }
double Host::mul(double a, double b) { return calc_mul(a, b); }

std::string Host::greet(const std::string& name) {
  uint8_t* out = nullptr;
  size_t out_len = 0;
  calc_greet(reinterpret_cast<const uint8_t*>(name.data()),
             static_cast<int64_t>(name.size()), &out, &out_len);
  if (!out || out_len == 0) return {};
  return std::string(reinterpret_cast<char*>(out), out_len);
}

std::string Host::callJson(const std::string& exportName, const std::string& argsJson) {
  // Minimal parser for "[20,22]" / "[\"rn\"]" — enough for tests & codegen demos.
  if (exportName == "add" || exportName == "mul") {
    double a = 0, b = 0;
    if (sscanf(argsJson.c_str(), "[%lf,%lf]", &a, &b) != 2)
      throw std::runtime_error("expected [number,number]");
    double r = exportName == "add" ? add(a, b) : mul(a, b);
    char buf[64];
    snprintf(buf, sizeof(buf), "%.17g", r);
    return buf;
  }
  if (exportName == "greet") {
    // ["name"]
    auto start = argsJson.find('"');
    auto end = argsJson.find('"', start + 1);
    if (start == std::string::npos || end == std::string::npos)
      throw std::runtime_error("expected [\"string\"]");
    auto name = argsJson.substr(start + 1, end - start - 1);
    auto g = greet(name);
    return std::string("\"") + g + "\"";
  }
  throw std::runtime_error("unknown export: " + exportName);
}

}  // namespace scriptca
