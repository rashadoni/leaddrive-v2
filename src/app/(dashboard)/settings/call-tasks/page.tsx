"use client"

/**
 * Call tasks — where the work a call creates goes, and how long it gets.
 *
 * Both choices used to be engineering: the board was a feature flag set by a
 * script, the due window a constant in the source. They are business decisions,
 * so they belong here. The pipeline overrides exist because one tenant can run
 * two sales motions that have no business sharing a wall.
 *
 * The API gates on `settings:write` and re-checks for admin, so this page does
 * not duplicate a permission check it cannot enforce.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ClipboardList, Loader2, Save } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { PageDescription } from "@/components/page-description"

type Board = { id: string; name: string }
type Pipeline = { id: string; name: string; taskBoardId: string | null }

const MIN_DAYS = 1
const MAX_DAYS = 30

export default function CallTaskSettingsPage() {
  const t = useTranslations("callTaskSettings")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [boards, setBoards] = useState<Board[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [boardId, setBoardId] = useState<string>("")
  const [dueDays, setDueDays] = useState<number>(2)

  useEffect(() => {
    let cancelled = false
    fetch("/api/v1/settings/call-tasks", { credentials: "include" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        const data = json?.data
        if (!data) throw new Error("no data")
        setBoards(data.boards ?? [])
        setPipelines(data.pipelines ?? [])
        setBoardId(data.boardId ?? "")
        setDueDays(data.dueDays ?? 2)
      })
      .catch(() => toast.error(t("loadError")))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [t])

  const daysValid = Number.isInteger(dueDays) && dueDays >= MIN_DAYS && dueDays <= MAX_DAYS

  async function save() {
    setSaving(true)
    try {
      const res = await fetch("/api/v1/settings/call-tasks", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardId: boardId || null,
          dueDays,
          pipelineBoards: Object.fromEntries(pipelines.map((p) => [p.id, p.taskBoardId])),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "save failed")
      toast.success(t("saved"))
    } catch {
      toast.error(t("saveError"))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ClipboardList className="h-6 w-6" />
          {t("title")}
        </h1>
        <PageDescription text={t("description")} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("boardTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="call-task-board">{t("boardLabel")}</Label>
            <select
              id="call-task-board"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={boardId}
              onChange={(event) => setBoardId(event.target.value)}
            >
              <option value="">{t("boardNone")}</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>{board.name}</option>
              ))}
            </select>
            <p className="text-sm text-muted-foreground">{t("boardHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dueTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="call-task-days">{t("dueLabel")}</Label>
          <Input
            id="call-task-days"
            type="number"
            min={MIN_DAYS}
            max={MAX_DAYS}
            value={dueDays}
            onChange={(event) => setDueDays(Number(event.target.value))}
            className="max-w-32"
          />
          <p className="text-sm text-muted-foreground">{t("dueHint")}</p>
          {!daysValid && <p className="text-sm text-destructive">{t("dueInvalid")}</p>}
        </CardContent>
      </Card>

      {pipelines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("pipelinesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("pipelinesHint")}</p>
            {pipelines.map((pipeline) => (
              <div key={pipeline.id} className="flex items-center justify-between gap-4">
                <Label htmlFor={`pipeline-${pipeline.id}`} className="font-normal">
                  {pipeline.name}
                </Label>
                <select
                  id={`pipeline-${pipeline.id}`}
                  className="h-10 w-64 rounded-md border border-input bg-background px-3 text-sm"
                  value={pipeline.taskBoardId ?? ""}
                  onChange={(event) => setPipelines((current) => current.map((item) => (
                    item.id === pipeline.id
                      ? { ...item, taskBoardId: event.target.value || null }
                      : item
                  )))}
                >
                  <option value="">{t("pipelineDefault")}</option>
                  {boards.map((board) => (
                    <option key={board.id} value={board.id}>{board.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button onClick={save} disabled={saving || !daysValid}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        {t("save")}
      </Button>
    </div>
  )
}
