import { MtmAgentSection } from "@/components/mtm/agent-section"
import { FieldContactsGate } from "@/components/mtm/field-contacts-gate"

export default async function MtmAgentSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <FieldContactsGate>
      {/* Keyed: another employee is another section, not this one with stale rows. */}
      <MtmAgentSection key={id} agentId={id} />
    </FieldContactsGate>
  )
}
