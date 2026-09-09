"use client"

import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Plus, Trash2, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"

interface Condition {
  field: string
  operator: string
  value: string
}

interface ConditionGroup {
  logic: "AND" | "OR"
  conditions: Condition[]
}

interface SegmentConditionBuilderProps {
  initialConditions?: any[]
  onSave: (groups: ConditionGroup[]) => void
}

const FIELDS = [
  { value: "company", label: "Company" },
  { value: "source", label: "Source" },
  { value: "role", label: "Role / Position" },
  { value: "tag", label: "Tag" },
  { value: "name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "createdAfter", label: "Created After" },
  { value: "createdBefore", label: "Created Before" },
  { value: "hasEmail", label: "Has Email" },
  { value: "hasPhone", label: "Has Phone" },
  { value: "isActive", label: "Is Active" },
]

const OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "starts_with", label: "starts with" },
  { value: "is_true", label: "is true" },
  { value: "is_false", label: "is false" },
]

const GROUP_COLORS = [
  "border-blue-300 bg-blue-50/50 dark:bg-blue-900/10",
  "border-purple-300 bg-purple-50/50 dark:bg-purple-900/10",
  "border-green-300 bg-green-50/50 dark:bg-green-900/10",
  "border-orange-300 bg-orange-50/50 dark:bg-orange-900/10",
]

function parseConditions(raw: any[]): ConditionGroup[] {
  if (!raw?.length) return [{ logic: "AND", conditions: [{ field: "company", operator: "contains", value: "" }] }]

  // Simple flat conditions → single AND group
  if (raw[0] && typeof raw[0] === "object" && "field" in raw[0]) {
    return [{ logic: "AND", conditions: raw.map(c => ({ field: c.field || c.key || "company", operator: c.operator || "contains", value: c.value || "" })) }]
  }

  // Already grouped
  if (raw[0]?.conditions) return raw as ConditionGroup[]

  return [{ logic: "AND", conditions: [{ field: "company", operator: "contains", value: "" }] }]
}

export function SegmentConditionBuilder({ initialConditions, onSave }: SegmentConditionBuilderProps) {
  const tcb = useTranslations("conditionBuilder")
  const [groups, setGroups] = useState<ConditionGroup[]>(() => parseConditions(initialConditions || []))

  const fields = useMemo(() => FIELDS.map(f => ({ ...f, label: tcb(`field_${f.value}` as any) || f.label })), [tcb])
  const operators = useMemo(() => OPERATORS.map(o => ({ ...o, label: tcb(`op_${o.value}` as any) || o.label })), [tcb])

  const addGroup = () => {
    setGroups(prev => [...prev, { logic: "AND", conditions: [{ field: "company", operator: "contains", value: "" }] }])
  }

  const removeGroup = (gi: number) => {
    setGroups(prev => prev.filter((_, i) => i !== gi))
  }

  const toggleLogic = (gi: number) => {
    setGroups(prev => prev.map((g, i) => i === gi ? { ...g, logic: g.logic === "AND" ? "OR" : "AND" } : g))
  }

  const addCondition = (gi: number) => {
    setGroups(prev => prev.map((g, i) => i === gi ? { ...g, conditions: [...g.conditions, { field: "company", operator: "contains", value: "" }] } : g))
  }

  const removeCondition = (gi: number, ci: number) => {
    setGroups(prev => prev.map((g, i) => i === gi ? { ...g, conditions: g.conditions.filter((_, j) => j !== ci) } : g))
  }

  const updateCondition = (gi: number, ci: number, updates: Partial<Condition>) => {
    setGroups(prev => prev.map((g, i) => i === gi ? { ...g, conditions: g.conditions.map((c, j) => j === ci ? { ...c, ...updates } : c) } : g))
  }

  const noValueOperators = ["is_true", "is_false"]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{tcb("title")}</span>
      </div>

      {groups.map((group, gi) => (
        <div key={gi} className={cn("rounded-lg border-2 p-4 space-y-3", GROUP_COLORS[gi % GROUP_COLORS.length])}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">{tcb("group")} {gi + 1}</span>
              <button
                onClick={() => toggleLogic(gi)}
                className={cn(
                  "px-2 py-0.5 rounded-full text-xs font-bold transition-colors",
                  group.logic === "AND" ? "bg-blue-500 text-white" : "bg-orange-500 text-white"
                )}
              >
                {group.logic}
              </button>
            </div>
            {groups.length > 1 && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-red-500" onClick={() => removeGroup(gi)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>

          {group.conditions.map((cond, ci) => (
            <div key={ci} className="flex items-center gap-2">
              <Select value={cond.field} onChange={e => updateCondition(gi, ci, { field: e.target.value })} className="w-[140px] h-8 text-xs">
                {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
              <Select value={cond.operator} onChange={e => updateCondition(gi, ci, { operator: e.target.value })} className="w-[130px] h-8 text-xs">
                {operators.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              {!noValueOperators.includes(cond.operator) && (
                <Input
                  value={cond.value}
                  onChange={e => updateCondition(gi, ci, { value: e.target.value })}
                  placeholder={tcb("valuePlaceholder")}
                  className="flex-1 h-8 text-xs"
                />
              )}
              {group.conditions.length > 1 && (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-red-500" onClick={() => removeCondition(gi, ci)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
              {ci < group.conditions.length - 1 && (
                <span className={cn("text-[10px] font-bold px-1", group.logic === "AND" ? "text-blue-600" : "text-orange-600")}>
                  {group.logic}
                </span>
              )}
            </div>
          ))}

          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => addCondition(gi)}>
            <Plus className="h-3 w-3" /> {tcb("addCondition")}
          </Button>
        </div>
      ))}

      {groups.length > 1 && (
        <div className="text-center text-xs font-bold text-muted-foreground">— OR —</div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="gap-1" onClick={addGroup}>
          <Plus className="h-3 w-3" /> {tcb("addGroup")}
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => onSave(groups)}>
          {tcb("saveConditions")}
        </Button>
      </div>
    </div>
  )
}
