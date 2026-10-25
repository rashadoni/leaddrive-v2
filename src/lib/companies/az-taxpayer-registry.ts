/**
 * A company's card from the State Tax Service's public registry
 * («Kommersiya qurumlarının dövlət reyestri məlumatlarının verilməsi»,
 * new.e-taxes.gov.az) by its VÖEN: name, legal form, legal address, legal
 * representative, and whether it is active and a VAT payer.
 *
 * The registry answers only Azerbaijani addresses, and LeadDrive runs abroad,
 * so the request goes through the Fanum station in Baku: one nginx location
 * (`scripts/pbx/az-taxpayer-registry/`) behind the station's pinned TLS and
 * its one-host source ACL. Without the relay the lookup answers "unavailable"
 * and the form still works by hand.
 *
 * The registry is public and needs no login; it is asked once per press of
 * «VÖEN ilə doldur», never in bulk.
 */
import { secureFanumPbxControlFetch } from "@/lib/voip/fanum-pbx-control-transport"

const DEFAULT_RELAY = "https://185.161.225.131:8088"
const RELAY_PATH = "/registry/az/find-taxpayer"
const TIMEOUT_MS = 20_000

/** Digits only; a VÖEN is ten of them. Null when it is not one. */
export function normaliseVoen(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const digits = raw.replace(/\D/g, "")
  return /^\d{10}$/.test(digits) ? digits : null
}

/** A VÖEN as a form sends it: empty clears it, anything else must be its ten digits. */
export function voenInput(raw: string | null | undefined): { ok: true; value: string | null | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined }
  if (raw === null || raw.trim() === "") return { ok: true, value: null }
  const voen = normaliseVoen(raw)
  return voen ? { ok: true, value: voen } : { ok: false }
}

export interface TaxpayerCard {
  voen: string
  name: string
  legalForm: string | null
  legalAddress: string | null
  director: string | null
  active: boolean | null
  vatPayer: boolean | null
}

export class RegistryUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RegistryUnavailableError"
  }
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null)

/** «FƏRİD HÜSEYNOV ARİF OĞLU» → «Fərid Hüseynov Arif oğlu»: the registry writes people in capitals. */
export function personName(raw: string | null): string | null {
  if (!raw) return null
  return raw
    .toLocaleLowerCase("az")
    .split(" ")
    .map((word) => (/^(oğlu|qızı)$/.test(word) ? word : word.charAt(0).toLocaleUpperCase("az") + word.slice(1)))
    .join(" ")
}

/** The registry's answer, read field by field. Null when it found no legal entity. */
export function readTaxpayer(voen: string, body: unknown): TaxpayerCard | null {
  const list = (body as { taxpayers?: unknown })?.taxpayers
  if (!Array.isArray(list)) return null
  const found = list.find((item) => (item as { tin?: unknown })?.tin === voen) as Record<string, unknown> | undefined
  if (!found) return null
  const legal = (found.legalTaxpayerStatus ?? {}) as Record<string, unknown>
  const legalForm = (legal.legalForm as { name?: { az?: unknown } } | undefined)?.name?.az
  const name = text(legal.name) ?? text(found.name)
  if (!name) return null
  return {
    voen,
    name,
    legalForm: text(legalForm) ?? text(found.organizationType),
    legalAddress: text(legal.legalAddress),
    director: personName(text(legal.legitimate)),
    active: typeof found.active === "boolean" ? found.active : null,
    vatPayer: typeof found.vatPayer === "boolean" ? found.vatPayer : null,
  }
}

/** Ask the registry, through the station. Throws RegistryUnavailableError when it cannot answer. */
export async function lookupTaxpayer(voen: string, fetchImpl: typeof fetch = secureFanumPbxControlFetch as typeof fetch): Promise<TaxpayerCard | null> {
  const relay = (process.env.AZ_TAXPAYER_REGISTRY_RELAY || DEFAULT_RELAY).replace(/\/+$/, "")
  let response: Response
  try {
    response = await fetchImpl(`${relay}${RELAY_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ tin: voen, type: "legalEntity", serviceCode: "checkLegalName", isStateRegistry: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    })
  } catch (error) {
    throw new RegistryUnavailableError(error instanceof Error ? error.message : "Registry relay unreachable")
  }
  const body = await response.json().catch(() => null)
  // The registry's own "no such entity" is a 404 with `debug: tax_payer_not_found`
  // (seen live 2026-10-24); any other 404 is the station without the relay.
  if (response.status === 404 && (body as { debug?: unknown } | null)?.debug === "tax_payer_not_found") return null
  if (!response.ok) throw new RegistryUnavailableError(`Registry relay answered HTTP ${response.status}`)
  if (!body) throw new RegistryUnavailableError("Registry answered something that is not JSON")
  return readTaxpayer(voen, body)
}
