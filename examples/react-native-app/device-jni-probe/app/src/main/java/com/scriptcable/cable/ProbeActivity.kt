package com.scriptcable.cable

import android.app.Activity
import android.os.Bundle

/**
 * Device probe for the GENERATED native host — no React Native in the loop.
 * Logs CABLE_RESULT:{"sum":42,...} through the real JNI bridge.
 */
class ProbeActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      val module = CableModule(this)
      val add = module.nativeCall("add", "[20,22]")
      val mul = module.nativeCall("mul", "[6,7]")
      val greet = module.nativeCall("greet", "[\"device\"]")
      android.util.Log.i("CABLE", "add=$add mul=$mul greet=$greet")
      val ok = add == "{\"ok\":true,\"value\":42}" &&
          mul == "{\"ok\":true,\"value\":42}" &&
          greet == "{\"ok\":true,\"value\":\"hello, device\"}"
      if (ok) {
        android.util.Log.i("CABLE", "CABLE_RESULT:{\"sum\":42}")
        android.util.Log.i("CABLE", "on-device bridge OK")
      } else {
        android.util.Log.e("CABLE", "CABLE_RESULT:{\"error\":\"contract mismatch\"}")
      }
    } catch (e: Throwable) {
      android.util.Log.e("CABLE", "CABLE_RESULT:" + "{\"error\":\"" + e.message + "\"}")
    }
    finish()
  }
}
