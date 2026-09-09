import { MtmTaskWorkspace } from "@/components/mtm/task-workspace"

export default async function MtmTaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <MtmTaskWorkspace taskId={id} />
}
