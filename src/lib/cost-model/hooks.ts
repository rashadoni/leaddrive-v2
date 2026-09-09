"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import type { CostModelResult, OverheadItem, EmployeeRow, CostModelParams } from "./types"

function useOrgId() {
  const { data: session } = useSession()
  return session?.user?.organizationId || ""
}

function apiHeaders(orgId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-organization-id": orgId,
  }
}

async function apiFetch<T>(url: string, orgId: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { ...apiHeaders(orgId), ...options?.headers },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || "API error")
  return json.data
}

// ═══ Analytics (full computation) ═══
export function useCostModelAnalytics() {
  const orgId = useOrgId()
  return useQuery<CostModelResult>({
    queryKey: ["cost-model", "analytics", orgId],
    queryFn: () => apiFetch("/api/cost-model/analytics", orgId),
    enabled: !!orgId,
  })
}

// ═══ Overhead CRUD ═══
export function useOverheadItems() {
  const orgId = useOrgId()
  return useQuery<OverheadItem[]>({
    queryKey: ["cost-model", "overhead", orgId],
    queryFn: () => apiFetch("/api/cost-model/overhead", orgId),
    enabled: !!orgId,
  })
}

export function useCreateOverhead() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<OverheadItem>) =>
      apiFetch("/api/cost-model/overhead", orgId, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-model"] }),
  })
}

export function useUpdateOverhead() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<OverheadItem> & { id: string }) =>
      apiFetch(`/api/cost-model/overhead/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-model"] }),
  })
}

export function useDeleteOverhead() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/cost-model/overhead/${id}`, orgId, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-model"] }),
  })
}

// ═══ Employees CRUD ═══
export function useEmployees() {
  const orgId = useOrgId()
  return useQuery<EmployeeRow[]>({
    queryKey: ["cost-model", "employees", orgId],
    queryFn: () => apiFetch("/api/cost-model/employees", orgId),
    enabled: !!orgId,
  })
}

export function useCreateEmployee() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<EmployeeRow>) =>
      apiFetch("/api/cost-model/employees", orgId, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-model"] }),
  })
}

export function useUpdateEmployee() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<EmployeeRow> & { id: string }) =>
      apiFetch(`/api/cost-model/employees/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-model"] }),
  })
}

export function useDeleteEmployee() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/cost-model/employees/${id}`, orgId, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-model"] }),
  })
}

// ═══ Parameters ═══
export function useParameters() {
  const orgId = useOrgId()
  return useQuery<CostModelParams>({
    queryKey: ["cost-model", "parameters", orgId],
    queryFn: () => apiFetch("/api/cost-model/parameters", orgId),
    enabled: !!orgId,
  })
}

export function useUpdateParameters() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<CostModelParams>) =>
      apiFetch("/api/cost-model/parameters", orgId, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-model"] }),
  })
}

// ═══ Client Analytics ═══
export function useClientCosts() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["cost-model", "client-costs", orgId],
    queryFn: () => apiFetch("/api/cost-model/client-costs", orgId),
    enabled: !!orgId,
  })
}

export function useClientDetail(id: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["cost-model", "client-analytics", id, orgId],
    queryFn: () => apiFetch(`/api/cost-model/client-analytics/${id}`, orgId),
    enabled: !!orgId && !!id,
  })
}

// ═══ Client Services ═══
export function useClientServices(companyId: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["cost-model", "client-services", companyId, orgId],
    queryFn: () => apiFetch(`/api/cost-model/client-services/${companyId}`, orgId),
    enabled: !!orgId && !!companyId,
  })
}

export function useUpdateClientServices() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, services }: { companyId: string; services: any[] }) =>
      apiFetch(`/api/cost-model/client-services/${companyId}`, orgId, {
        method: "PUT",
        body: JSON.stringify({ services }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-model"] }),
  })
}

// ═══ Snapshots ═══
export function useSnapshots() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["cost-model", "snapshots", orgId],
    queryFn: () => apiFetch("/api/cost-model/snapshots", orgId),
    enabled: !!orgId,
  })
}

export function useSnapshotDetail(month: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["cost-model", "snapshots", month, orgId],
    queryFn: () => apiFetch(`/api/cost-model/snapshots/${month}`, orgId),
    enabled: !!orgId && !!month,
  })
}

export function useCreateSnapshot() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch("/api/cost-model/snapshot", orgId, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-model", "snapshots"] }),
  })
}

// ═══ AI Analysis ═══
export function useAiAnalysis(tab: string, options?: { enabled?: boolean }) {
  const orgId = useOrgId()
  return useQuery<{ analysis: string; thinking: string; cached: boolean }>({
    queryKey: ["cost-model", "ai-analysis", tab, orgId],
    queryFn: () =>
      apiFetch("/api/cost-model/ai-analysis", orgId, {
        method: "POST",
        body: JSON.stringify({ tab, lang: "ru" }),
      }),
    enabled: (options?.enabled ?? false) && !!orgId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useRefreshAiAnalysis() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation<
    { analysis: string; thinking: string; cached: boolean },
    Error,
    { tab: string; lang?: string }
  >({
    mutationFn: ({ tab, lang = "ru" }) =>
      apiFetch("/api/cost-model/ai-analysis", orgId, {
        method: "POST",
        body: JSON.stringify({ tab, lang, force: true }),
      }),
    onSuccess: (_, { tab }) => {
      qc.invalidateQueries({ queryKey: ["cost-model", "ai-analysis", tab] })
    },
  })
}

// ═══ Audit Log ═══
export function useCostModelLog() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["cost-model", "log", orgId],
    queryFn: () => apiFetch("/api/cost-model/log", orgId),
    enabled: !!orgId,
  })
}
