/**
 * Demo tab keys in UI order: compute-heavy kernels first (where the compiled
 * core wins big), boundary-cost demos last (honest baselines).
 */
export type DemoTabKey = 'mandelbrot' | 'image' | 'coarse' | 'fib' | 'bytes' | 'add' | 'repeat';

export type ImageFilter = 'grayscale' | 'blur' | 'resize' | 'sobel';

export type MandelbrotPresetKey = 'home' | 'seahorse' | 'elephant' | 'spiral';
