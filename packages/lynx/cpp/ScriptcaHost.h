#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace scriptca {

/** Host-side handle around a scriptc library (calculator demo ABI). */
class Host {
 public:
  Host();
  ~Host() = default;

  double add(double a, double b);
  double mul(double a, double b);
  std::string greet(const std::string& name);

  /** Generic invoke used by the JS bridge: name + JSON-ish number/string args. */
  std::string callJson(const std::string& exportName, const std::string& argsJson);
};

}  // namespace scriptca
