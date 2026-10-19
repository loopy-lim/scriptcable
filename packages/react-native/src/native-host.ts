/**
 * Typed surface matching the C++ Host. In a real RN app, NativeModules /
 * TurboModule would implement this. On Linux we test via the C++ smoke binary
 * and the mock bridge.
 */
export type ScriptcaNativeHost = {
  add(a: number, b: number): number;
  mul(a: number, b: number): number;
  greet(name: string): string;
  callJson?(exportName: string, argsJson: string): string;
};
