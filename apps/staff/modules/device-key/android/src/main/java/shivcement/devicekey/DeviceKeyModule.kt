package shivcement.devicekey

import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

private const val KEY_STORE = "AndroidKeyStore"
private const val ALIAS = "shiv-staff-device-key"

class KeyUnavailableException(cause: Throwable) :
  CodedException("ERR_DEVICE_KEY", "The device key is not available: ${cause.message}", cause)

/**
 * The phone is the login. A P-256 key made inside Android Keystore that can sign but can never
 * leave the phone, so a copied token is useless without the phone itself.
 *
 * StrongBox is never asked for: budget phones do not have it, and asking would refuse them.
 */
class DeviceKeyModule : Module() {
  private fun keyStore(): KeyStore = KeyStore.getInstance(KEY_STORE).apply { load(null) }

  private fun createKey() {
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEY_STORE)
    generator.initialize(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .build()
    )
    generator.generateKeyPair()
  }

  /** The public half in SPKI form (X.509 DER), which is what the server reads. */
  private fun publicKeyBase64(): String {
    val store = keyStore()
    if (!store.containsAlias(ALIAS)) createKey()
    val encoded = keyStore().getCertificate(ALIAS).publicKey.encoded
    return Base64.encodeToString(encoded, Base64.NO_WRAP)
  }

  private fun signText(message: String): String {
    val store = keyStore()
    if (!store.containsAlias(ALIAS)) createKey()
    val key = keyStore().getKey(ALIAS, null) as PrivateKey
    val signer = Signature.getInstance("SHA256withECDSA")
    signer.initSign(key)
    signer.update(message.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(signer.sign(), Base64.NO_WRAP)
  }

  override fun definition() = ModuleDefinition {
    Name("DeviceKey")

    AsyncFunction("publicKey") {
      try {
        publicKeyBase64()
      } catch (error: Exception) {
        throw KeyUnavailableException(error)
      }
    }

    AsyncFunction("sign") { message: String ->
      try {
        signText(message)
      } catch (error: Exception) {
        throw KeyUnavailableException(error)
      }
    }

    AsyncFunction("deleteKey") {
      try {
        keyStore().deleteEntry(ALIAS)
      } catch (error: Exception) {
        throw KeyUnavailableException(error)
      }
    }

    // Time since this boot, which the user cannot change. The server's time is advanced by this.
    Function("elapsedRealtime") { SystemClock.elapsedRealtime().toDouble() }

    // Tells the app that a reboot came between a scan and its sending.
    Function("bootCount") {
      val resolver = appContext.reactContext?.contentResolver
      if (resolver == null) 0
      else Settings.Global.getInt(resolver, Settings.Global.BOOT_COUNT, 0)
    }

    Function("model") { "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(80) }

    Function("sdk") { Build.VERSION.SDK_INT }
  }
}
