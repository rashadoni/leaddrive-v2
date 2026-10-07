const privateCanary = "WORKFORCE_PRIVATE_CANARY tenant=synthetic employee=synthetic coordinates=synthetic reason=synthetic token=synthetic"

/** Synthetic thrown values: failure handling must neither serialize nor inspect them. */
export const workforceLogFailures = [
  {
    kind: "Error with private name, stack, cause and metadata",
    make: () => Object.assign(new Error(privateCanary), {
      name: privateCanary,
      stack: privateCanary,
      cause: { message: privateCanary },
      metadata: { location: privateCanary, requestReason: privateCanary },
    }),
  },
  { kind: "private thrown string", make: () => privateCanary },
  {
    kind: "opaque value with hostile accessors",
    make: () => Object.defineProperties({}, Object.fromEntries(
      ["name", "message", "stack", "cause", "toJSON"].map(key => [key, {
        enumerable: true,
        get() { throw new Error("Failure handler inspected a private thrown value") },
      }]),
    )),
  },
  { kind: "null thrown value", make: () => null },
]
