// Synthetic records only; no copied customer data or credentials.
export const clientGuid = "33333333-4444-4555-8666-777777777777"
export const otherClientGuid = "55555555-6666-4777-8888-999999999999"
export const clientStamp = "2026-10-22T12:00:00.000Z"
export const clientContext = { organizationId: "tenant-test", observedAt: clientStamp, source: "live" as const }
export function clientRow(patch: Record<string, string> = {}) {
  return { Name: "Sınaq aptek", chain: "", chainGUIDE: "00000000-0000-0000-0000-000000000000", GUIDE: clientGuid,
    balance: "12.50", Region: "Test", Adress: "Synthetic address", Phone: "994500000001", Mail: "test@example.invalid", Debet: "3", Kredit: "4", ...patch }
}
export function clientsXml(rows = [clientRow()]) {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
  return Buffer.from('<?xml version="1.0"?><Корневой>' + rows.map((r) => `<Data ${Object.entries(r).map(([k, v]) => `${k}="${escape(v)}"`).join(" ")}/>`).join("") + "</Корневой>")
}
