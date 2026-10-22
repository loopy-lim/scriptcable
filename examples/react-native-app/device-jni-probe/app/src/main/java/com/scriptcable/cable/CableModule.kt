package com.scriptcable.cable

import android.content.Context
import java.io.File

/**
 * Minimal copy of the generated RN module's native binding — same package +
 * class name, so the generated JNI symbol resolves unchanged, with no
 * React Native dependency. Probe-only: the RN flavor is the generated file.
 */
class CableModule(context: Context) {

  init {
    load(context)
  }

  private fun load(ctx: Context) {
    try {
      System.loadLibrary("calculator_cable")
      return
    } catch (_: UnsatisfiedLinkError) {
    }
    System.load(File(ctx.applicationInfo.nativeLibraryDir, "libcalculator_cable.so").absolutePath)
  }

  external fun nativeCall(name: String, argsJson: String): String
}
