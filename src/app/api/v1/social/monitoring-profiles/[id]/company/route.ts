import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

type Context = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  // null — отвязать. Отдельное значение, а не отсутствие поля: «не трогать» и
  // «убрать связь» должны различаться явно.
  companyId: z.string().trim().min(1).max(255).nullable(),
  // Осознанная передача объекта другому клиенту. Без флага перевешивание
  // отклоняется: у карточки прежнего клиента блок мониторинга просто опустеет,
  // и никто не узнает, что связь увели.
  reassign: z.boolean().optional(),
}).strict()

/**
 * Привязка объекта мониторинга к клиенту CRM (и отвязка).
 *
 * Вынесено отдельным подресурсом, а не полем в PATCH профиля: сохранение
 * профиля имеет компенсирующий откат по фиксированному набору полей субъекта,
 * и связь, записанная внутри него, при сбое молча откатилась бы вместе с ним.
 *
 * PUT идемпотентен: повторный клик с тем же companyId возвращает 200 и не
 * пишет второй аудит.
 */
export const PUT = withSocialMonitoringMutationFence<Context>("social", "write", async (req: NextRequest, auth, context) => {
  const { id } = await context.params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  }

  const subject = await prisma.monitoringSubject.findFirst({
    where: { organizationId: auth.orgId, id, status: { not: "deleted" } },
    select: { id: true, name: true, companyId: true, company: { select: { id: true, name: true } } },
  })
  if (!subject) {
    return NextResponse.json({ error: "monitoring_not_found" }, { status: 404 })
  }

  const companyId = parsed.data.companyId
  let company: { id: string; name: string } | null = null
  if (companyId) {
    // Внешний ключ в Postgres проверяется в обход row security, поэтому
    // принадлежность компании тенанту обязана проверяться здесь — иначе
    // объект мониторинга можно было бы привязать к чужой компании.
    company = await prisma.company.findFirst({
      where: { organizationId: auth.orgId, id: companyId },
      select: { id: true, name: true },
    })
    if (!company) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 })
    }
  }

  // Объект уже принадлежит другому клиенту: молча переписать связь нельзя.
  if (
    companyId
    && subject.companyId
    && subject.companyId !== companyId
    && parsed.data.reassign !== true
  ) {
    return NextResponse.json({
      error: "already_linked_to_other_company",
      data: { company: subject.company },
    }, { status: 409 })
  }

  if (subject.companyId !== companyId) {
    await prisma.monitoringSubject.updateMany({
      where: { organizationId: auth.orgId, id: subject.id },
      data: { companyId },
    })
    await logAudit(
      auth.orgId,
      "update",
      "monitoring_profile",
      subject.id,
      // В журнале нужна и прежняя связь: иначе по записи не понять, у кого
      // объект забрали.
      companyId
        ? `company:${companyId}${subject.companyId ? ` (was ${subject.companyId})` : ""}`
        : `company:unlinked${subject.companyId ? ` (was ${subject.companyId})` : ""}`,
    )
  }

  return NextResponse.json({ success: true, data: { id: subject.id, company } })
})
