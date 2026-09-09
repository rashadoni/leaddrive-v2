"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2, Mail, CheckSquare, Edit3, Bell, Globe, Zap, Loader2, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"

interface WorkflowAction {
  id?: string
  actionType: string
  actionConfig: any
  actionOrder: number
}

interface Workflow {
  id: string
  name: string
  actions: WorkflowAction[]
}

interface WorkflowActionsModalProps {
  workflow: Workflow | null
  onClose: () => void
  onSaved: () => void
  orgId?: string
}

export function WorkflowActionsModal({ workflow, onClose, onSaved, orgId }: WorkflowActionsModalProps) {
  const t = useTranslations("workflows")
  const tc = useTranslations("common")
  const [actions, setActions] = useState<WorkflowAction[]>([])
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newType, setNewType] = useState("")
  const [newConfig, setNewConfig] = useState<any>({})
  const [editIndex, setEditIndex] = useState<number | null>(null)

  const actionTypes = [
    { value: "send_email", label: t("actionSendEmail"), icon: Mail, color: "bg-blue-500", borderColor: "border-blue-200 bg-blue-50/50" },
    { value: "create_task", label: t("actionCreateTask"), icon: CheckSquare, color: "bg-teal-500", borderColor: "border-teal-200 bg-teal-50/50" },
    { value: "update_field", label: t("actionUpdateField"), icon: Edit3, color: "bg-purple-500", borderColor: "border-purple-200 bg-purple-50/50" },
    { value: "send_notification", label: t("actionNotification"), icon: Bell, color: "bg-orange-500", borderColor: "border-orange-200 bg-orange-50/50" },
    { value: "webhook", label: t("actionWebhook"), icon: Globe, color: "bg-muted-foreground/50", borderColor: "border-zinc-200 dark:border-zinc-700 bg-muted/50" },
    { value: "auto_assign", label: t("actionAutoAssign"), icon: UserPlus, color: "bg-indigo-500", borderColor: "border-indigo-200 bg-indigo-50/50" },
  ]

  useEffect(() => {
    if (workflow) {
      setActions([...workflow.actions].sort((a, b) => a.actionOrder - b.actionOrder))
    }
  }, [workflow])

  function getActionInfo(type: string) {
    return actionTypes.find(at => at.value === type) || actionTypes[0]
  }

  function getActionSummary(action: WorkflowAction): string {
    const c = action.actionConfig || {}
    switch (action.actionType) {
      case "send_email": return c.template || c.subject || "Email"
      case "create_task": return c.title || "Task"
      case "update_field": return c.field ? `${c.field} = ${c.value || "..."}` : "..."
      case "send_notification": return c.message ? c.message.slice(0, 50) : "..."
      case "webhook": return c.url ? `${c.method || "POST"} ${c.url.slice(0, 40)}` : "..."
      case "auto_assign": return c.assignTo || "..."
      default: return ""
    }
  }

  function openAdd() {
    setNewType("")
    setNewConfig({})
    setEditIndex(null)
    setAddOpen(true)
  }

  function openEdit(index: number) {
    const action = actions[index]
    setNewType(action.actionType)
    setNewConfig({ ...action.actionConfig })
    setEditIndex(index)
    setAddOpen(true)
  }

  function confirmAction() {
    if (!newType) return
    const newAction: WorkflowAction = {
      actionType: newType,
      actionConfig: { ...newConfig },
      actionOrder: editIndex !== null ? actions[editIndex].actionOrder : actions.length,
    }
    if (editIndex !== null) {
      setActions(prev => prev.map((a, i) => i === editIndex ? newAction : a))
    } else {
      setActions(prev => [...prev, newAction])
    }
    setAddOpen(false)
  }

  function removeAction(index: number) {
    setActions(prev => prev.filter((_, i) => i !== index))
  }

  async function saveActions() {
    if (!workflow) return
    setSaving(true)
    try {
      await fetch(`/api/v1/workflows/${workflow.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          actions: actions.map((a, i) => ({
            actionType: a.actionType,
            actionConfig: a.actionConfig,
            actionOrder: i,
          })),
        }),
      })
      onSaved()
      onClose()
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  if (!workflow) return null

  return (
    <>
      {/* Main actions modal */}
      <Dialog open={!!workflow} onOpenChange={open => { if (!open) onClose() }}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>{t("actions")}: {workflow.name}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {actions.length} {t("actions").toLowerCase()}
              </p>
            </div>
          </div>
        </DialogHeader>
        <DialogContent className="max-h-[65vh] overflow-y-auto">
          {actions.length === 0 ? (
            <div className="py-8 text-center">
              <Zap className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">{t("noActions")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("noActionsHint")}</p>
            </div>
          ) : (
            <>
              {/* Trigger node */}
              <div className="flex items-center gap-3 mb-1">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-purple-500 text-white shrink-0">
                  <Zap className="h-4 w-4" />
                </div>
                <div className="flex-1 bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 rounded-lg px-4 py-3">
                  <span className="font-semibold text-sm text-purple-800 dark:text-purple-200">
                    {t("trigger")}
                  </span>
                </div>
              </div>

              {/* Actions flow */}
              {actions.map((action, index) => {
                const info = getActionInfo(action.actionType)
                const Icon = info.icon
                const summary = getActionSummary(action)
                return (
                  <div key={index}>
                    <div className="ml-[17px] h-5 w-0.5 bg-primary/20" />
                    <div className="flex items-start gap-3">
                      <div className={cn("flex items-center justify-center w-9 h-9 rounded-full text-white shrink-0 mt-1", info.color)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className={cn("flex-1 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-3", info.borderColor)}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-sm">{index + 1}. {info.label}</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEdit(index)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button onClick={() => removeAction(index)} className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}

          <div className={actions.length > 0 ? "mt-3" : ""}>
            <Button type="button" variant="outline" size="sm" className="gap-1.5 w-full" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" /> {t("addAction")}
            </Button>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tc("cancel")}</Button>
          <Button onClick={saveActions} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> {tc("saving")}</> : tc("save")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Add/Edit action sub-dialog */}
      {addOpen && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogHeader>
            <DialogTitle>{editIndex !== null ? t("actionConfig") : t("selectActionType")}</DialogTitle>
          </DialogHeader>
          <DialogContent>
            {/* Type selector grid (only when adding new) */}
            {editIndex === null && !newType && (
              <div className="grid grid-cols-2 gap-2">
                {actionTypes.map(at => {
                  const Icon = at.icon
                  return (
                    <button
                      key={at.value}
                      type="button"
                      onClick={() => setNewType(at.value)}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-left transition-colors hover:bg-muted/50",
                        at.borderColor
                      )}
                    >
                      <div className={cn("flex items-center justify-center w-8 h-8 rounded-full text-white shrink-0", at.color)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-medium">{at.label}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Config form based on selected type */}
            {newType && (
              <div className="space-y-3 mt-2">
                {newType === "send_email" && (
                  <>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("emailTemplate")}</Label>
                      <Input value={newConfig.template || ""} onChange={e => setNewConfig({ ...newConfig, template: e.target.value })} placeholder="Template name" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Subject</Label>
                      <Input value={newConfig.subject || ""} onChange={e => setNewConfig({ ...newConfig, subject: e.target.value })} />
                    </div>
                  </>
                )}
                {newType === "create_task" && (
                  <>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("taskTitle")}</Label>
                      <Input value={newConfig.title || ""} onChange={e => setNewConfig({ ...newConfig, title: e.target.value })} placeholder={t("taskTitlePlaceholder")} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("taskDescription")}</Label>
                      <Textarea value={newConfig.description || ""} onChange={e => setNewConfig({ ...newConfig, description: e.target.value })} rows={2} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">{t("taskPriority")}</Label>
                        <Select value={newConfig.priority || "medium"} onChange={e => setNewConfig({ ...newConfig, priority: e.target.value })}>
                          <option value="low">{t("priorityLow")}</option>
                          <option value="medium">{t("priorityMedium")}</option>
                          <option value="high">{t("priorityHigh")}</option>
                          <option value="urgent">{t("priorityUrgent")}</option>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">{t("taskAssignee")}</Label>
                        <Input value={newConfig.assignee || ""} onChange={e => setNewConfig({ ...newConfig, assignee: e.target.value })} placeholder="User ID" />
                      </div>
                    </div>
                  </>
                )}
                {newType === "update_field" && (
                  <>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("fieldToUpdate")}</Label>
                      <Input value={newConfig.field || ""} onChange={e => setNewConfig({ ...newConfig, field: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("newValue")}</Label>
                      <Input value={newConfig.value || ""} onChange={e => setNewConfig({ ...newConfig, value: e.target.value })} />
                    </div>
                  </>
                )}
                {newType === "send_notification" && (
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("notificationMessage")}</Label>
                    <Textarea value={newConfig.message || ""} onChange={e => setNewConfig({ ...newConfig, message: e.target.value })} rows={3} />
                  </div>
                )}
                {newType === "webhook" && (
                  <>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("webhookUrl")}</Label>
                      <Input value={newConfig.url || ""} onChange={e => setNewConfig({ ...newConfig, url: e.target.value })} placeholder="https://..." />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("webhookMethod")}</Label>
                      <Select value={newConfig.method || "POST"} onChange={e => setNewConfig({ ...newConfig, method: e.target.value })}>
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </Select>
                    </div>
                  </>
                )}
                {newType === "auto_assign" && (
                  <div>
                    <Label className="text-xs text-muted-foreground">{t("assignTo")}</Label>
                    <Input value={newConfig.assignTo || ""} onChange={e => setNewConfig({ ...newConfig, assignTo: e.target.value })} placeholder="User ID" />
                  </div>
                )}
              </div>
            )}
          </DialogContent>
          <DialogFooter>
            {editIndex === null && newType && (
              <Button variant="ghost" size="sm" onClick={() => setNewType("")}>← {tc("back")}</Button>
            )}
            <Button variant="outline" onClick={() => setAddOpen(false)}>{tc("cancel")}</Button>
            <Button onClick={confirmAction} disabled={!newType}>{tc("save")}</Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  )
}
