# Workforce mobile platform scope

Decision: **iOS is excluded from the current Workforce release and pilot**.

The first native validation target remains an Android app distributed through
a managed test track. This decision does not claim that the Android app or its
physical matrix is complete; those gates remain open. It prevents an untested
iOS client, browser wrapper or shared mobile code path from being represented
as parity.

No iOS signing identity, bundle identifier, provisioning profile, App Store
account, background-location entitlement or biometric/attestation claim is
approved by this document. No iOS credential belongs in this repository.

## Re-entry criteria

An iOS roadmap may start only after the Android pilot records:

- the exact released protocol/schema/config compatibility window;
- signed physical results for QR, action-time location, offline recovery,
  process death, reboot, device replacement and date rollover;
- measured support burden, false-positive/correction rates and privacy issues;
- an approved minimum OS/device matrix, managed distribution owner and signing
  custody; and
- explicit parity decisions for Secure Enclave/Keychain attestation, local
  authentication, background collection, permission recovery and accessibility.

Until then, bootstrap/version policy must not advertise an iOS Workforce
client, and product/help text must not promise iOS parity. Any future iOS work
uses a separate reviewed effective release plan; it cannot reinterpret Android
pilot evidence or existing server attendance facts.
