/**
 * App-marketplace types — L1/L2 Phase 5 slice 1.
 *
 * The manifest is a declarative description of an app's side-effects.
 * `parseManifest` validates the raw JSONB and returns a typed
 * `AppManifest`; `buildInstallPlan` translates that into a list of
 * concrete actions (create custom field, subscribe webhook, etc.)
 * the route applies inside a transaction.
 *
 * Slice 1 ships the parser + plan generator + a static first-party
 * catalog seed. Slice 2 wires the actual side-effect executors
 * (custom-field creation, webhook subscription registration, event
 * subscription binding) and the marketplace UI.
 */

/* ─── Manifest shape ──────────────────────────────────────────────────── */

/**
 * Custom field the app needs added to an entity at install time.
 * Slice 2's executor creates these via CustomField rows. Uninstall
 * cleanup leaves the field in place (data preservation) but marks
 * it inactive — same Salesforce behaviour.
 */
export interface ManifestCustomField {
  entityType: string // EntityKey from the schema-builder registry
  fieldName: string
  fieldLabel: string
  fieldType: "string" | "number" | "boolean" | "date" | "select"
  required: boolean
  options?: string[] // For select fields.
}

/**
 * Outbound webhook the app wants the tenant's platform to register.
 * Slice 2 wires these to the Webhook subscription table; payload
 * delivery uses N17 NamedCredential auth if `credentialRef` is set.
 */
export interface ManifestWebhookSubscription {
  /** Stable handle the app uses to identify the subscription. */
  ref: string
  /** Platform event name(s) the app wants delivered. */
  eventNames: string[]
  /** Destination URL — must be https (validated at install time). */
  targetUrl: string
  /** Optional NamedCredential ref for the Authorization header. */
  credentialRef?: string
}

/**
 * Platform-event subscription registered for the app at install time.
 * Slice 2 wires the in-process bus listener; slice 3 promotes to
 * durable Redis Streams consumer-group.
 */
export interface ManifestEventSubscription {
  ref: string
  eventName: string
  /** Optional code module the subscription invokes (slice 2 link). */
  codeModuleSlug?: string
}

/**
 * Settings key the tenant must supply during install. The
 * AppInstallation.config JSONB carries the user-entered values.
 */
export interface ManifestSettingKey {
  key: string
  label: string
  type: "string" | "number" | "boolean" | "secret"
  required: boolean
  /** Default value if the user doesn't supply one. */
  defaultValue?: string | number | boolean
}

/**
 * Requirements an org must meet before install succeeds. Slice 1
 * checks `namedCredentialNames` exist; `modules` checks org plan
 * via the existing module gate.
 */
export interface ManifestRequirements {
  namedCredentialNames?: string[]
  modules?: string[]
}

export interface AppManifest {
  /** Manifest schema version — bumps when the manifest shape itself changes. */
  schemaVersion: 1
  capabilities: {
    customFields?: ManifestCustomField[]
    webhookSubscriptions?: ManifestWebhookSubscription[]
    eventSubscriptions?: ManifestEventSubscription[]
    settingsKeys?: ManifestSettingKey[]
  }
  requirements?: ManifestRequirements
}

/* ─── Install plan ────────────────────────────────────────────────────── */

/**
 * One action the slice-2 executor will perform. Slice 1 just builds
 * + validates the plan; the route's response includes the plan so
 * the UI can show "this app will create X fields, subscribe to Y
 * events" before the user confirms.
 */
export type InstallAction =
  | { kind: "create_custom_field"; spec: ManifestCustomField }
  | { kind: "register_webhook_subscription"; spec: ManifestWebhookSubscription }
  | { kind: "register_event_subscription"; spec: ManifestEventSubscription }
  | { kind: "set_setting"; key: string; value: string | number | boolean }

export interface InstallPlan {
  appId: string
  appSlug: string
  installedVersion: string
  /** Concrete actions the slice-2 executor will run inside a tx. */
  actions: InstallAction[]
  /** Caller-supplied config that the actions reference. */
  config: Record<string, unknown>
}

/* ─── Parser results ─────────────────────────────────────────────────── */

export interface ManifestParseOk {
  ok: true
  manifest: AppManifest
}

export interface ManifestParseFail {
  ok: false
  errors: string[]
}

export type ManifestParseResult = ManifestParseOk | ManifestParseFail
