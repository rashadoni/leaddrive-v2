"use client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import type {
  FinanceDashboardData,
  ReceivablesData,
  PayablesStats,
  Bill,
  BillPayment,
  CreateBillInput,
  UpdateBillInput,
  Fund,
  FundTransaction,
  FundTransactionMutationResult,
  FundRule,
  CreateFundInput,
  CreateFundTransactionInput,
  CreateFundRuleInput,
  PaymentOrder,
  PaymentOrdersStats,
  PaymentRegistryEntry,
  PaymentRegistryStats,
  PaymentRegistryFilters,
  CreatePaymentOrderInput,
  UpdatePaymentOrderInput,
  BankAccount,
  CreateBankAccountInput,
} from "./types"

function useOrgId() {
  const { data: session } = useSession()
  return (session?.user as any)?.organizationId || ""
}

async function apiFetch<T>(url: string, orgId: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-organization-id": orgId,
      ...options?.headers,
    },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || "API error")
  return json.data ?? json
}

// ─── Finance Dashboard ─────────────────────────────────────────────────────

export function useFinanceDashboard(year: number, dateRange?: { dateFrom?: string; dateTo?: string }) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "dashboard", year, dateRange?.dateFrom ?? null, dateRange?.dateTo ?? null, orgId],
    queryFn: () => {
      const qs = new URLSearchParams({ year: year.toString() })
      if (dateRange?.dateFrom) qs.set("dateFrom", dateRange.dateFrom)
      if (dateRange?.dateTo) qs.set("dateTo", dateRange.dateTo)
      return apiFetch<FinanceDashboardData>(`/api/finance/dashboard?${qs}`, orgId)
    },
    enabled: !!orgId,
  })
}

// ─── Receivables (A/R) ─────────────────────────────────────────────────────

export function useReceivables(dateRange?: { dateFrom?: string; dateTo?: string }) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "receivables", dateRange?.dateFrom ?? null, dateRange?.dateTo ?? null, orgId],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (dateRange?.dateFrom) qs.set("dateFrom", dateRange.dateFrom)
      if (dateRange?.dateTo) qs.set("dateTo", dateRange.dateTo)
      const suffix = qs.toString() ? `?${qs}` : ""
      return apiFetch<ReceivablesData>(`/api/finance/receivables${suffix}`, orgId)
    },
    enabled: !!orgId,
  })
}

// ─── Payables (A/P) ────────────────────────────────────────────────────────

export function usePayables() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "payables", orgId],
    queryFn: () => apiFetch<Bill[]>("/api/finance/payables", orgId),
    enabled: !!orgId,
  })
}

export function usePayablesStats(dateRange?: { dateFrom?: string; dateTo?: string }) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "payables-stats", dateRange?.dateFrom ?? null, dateRange?.dateTo ?? null, orgId],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (dateRange?.dateFrom) qs.set("dateFrom", dateRange.dateFrom)
      if (dateRange?.dateTo) qs.set("dateTo", dateRange.dateTo)
      const suffix = qs.toString() ? `?${qs}` : ""
      return apiFetch<PayablesStats>(`/api/finance/payables/stats${suffix}`, orgId)
    },
    enabled: !!orgId,
  })
}

export function useCreateBill() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateBillInput) =>
      apiFetch<Bill>("/api/finance/payables", orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payables", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "payables-stats", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "dashboard"] })
    },
  })
}

export function useUpdateBill() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateBillInput & { id: string }) =>
      apiFetch<Bill>(`/api/finance/payables/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payables", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "payables-stats", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "dashboard"] })
    },
  })
}

export function useDeleteBill() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/finance/payables/${id}`, orgId, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payables", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "payables-stats", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "dashboard"] })
    },
  })
}

export function useBillPayments(billId: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "bill-payments", billId, orgId],
    queryFn: () => apiFetch<BillPayment[]>(`/api/finance/payables/${billId}/payments`, orgId),
    enabled: !!orgId && !!billId,
  })
}

export function useCreateBillPayment() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ billId, ...input }: { billId: string; amount: number; paymentMethod?: string; paymentDate?: string; reference?: string; notes?: string }) =>
      apiFetch<BillPayment>(`/api/finance/payables/${billId}/payments`, orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["finance", "bill-payments", vars.billId, orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "payables", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "payables-stats", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "dashboard"] })
    },
  })
}

// ─── Funds ──────────────────────────────────────────────────────────────────

export function useFunds() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "funds", orgId],
    queryFn: () => apiFetch<Fund[]>("/api/finance/funds", orgId),
    enabled: !!orgId,
  })
}

export function useCreateFund() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idempotencyKey, ...input }: CreateFundInput) =>
      apiFetch<Fund>("/api/finance/funds", orgId, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "funds", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "dashboard"] })
    },
  })
}

export function useUpdateFund() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Omit<Partial<CreateFundInput>, "idempotencyKey"> & { id: string }) =>
      apiFetch<Fund>(`/api/finance/funds/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "funds", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "dashboard"] })
    },
  })
}

export function useDeleteFund() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/finance/funds/${id}`, orgId, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "funds", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "dashboard"] })
    },
  })
}

export function useFundTransactions(fundId: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "fund-transactions", fundId, orgId],
    queryFn: () => apiFetch<FundTransaction[]>(`/api/finance/funds/${fundId}/transactions`, orgId),
    enabled: !!orgId && !!fundId,
  })
}

export function useCreateFundTransaction() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fundId, idempotencyKey, ...input }: CreateFundTransactionInput) =>
      apiFetch<FundTransactionMutationResult>(`/api/finance/funds/${fundId}/transactions`, orgId, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["finance", "fund-transactions", vars.fundId, orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "funds", orgId] })
      qc.invalidateQueries({ queryKey: ["finance", "dashboard"] })
    },
  })
}

export function useFundRules(fundId: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "fund-rules", fundId, orgId],
    queryFn: () => apiFetch<FundRule[]>(`/api/finance/funds/${fundId}/rules`, orgId),
    enabled: !!orgId && !!fundId,
  })
}

export function useCreateFundRule() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateFundRuleInput) =>
      apiFetch<FundRule>(`/api/finance/funds/${input.fundId}/rules`, orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["finance", "fund-rules", vars.fundId, orgId] })
    },
  })
}

export function useUpdateFundRule() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, fundId, ...input }: Partial<CreateFundRuleInput> & { id: string; fundId: string }) =>
      apiFetch<FundRule>(`/api/finance/funds/${fundId}/rules`, orgId, {
        method: "PUT",
        body: JSON.stringify({ id, ...input }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["finance", "fund-rules", vars.fundId, orgId] })
    },
  })
}

export function useDeleteFundRule() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, fundId }: { id: string; fundId: string }) =>
      apiFetch<void>(`/api/finance/funds/${fundId}/rules`, orgId, {
        method: "DELETE",
        body: JSON.stringify({ id }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["finance", "fund-rules", vars.fundId, orgId] })
    },
  })
}

// ─── Payment Registry ──────────────────────────────────────────────────────

export function usePaymentRegistry(filters?: PaymentRegistryFilters, page = 1) {
  const orgId = useOrgId()
  const qs = new URLSearchParams()
  if (filters?.direction) qs.set("direction", filters.direction)
  if (filters?.dateFrom) qs.set("dateFrom", filters.dateFrom)
  if (filters?.dateTo) qs.set("dateTo", filters.dateTo)
  if (filters?.category) qs.set("category", filters.category)
  if (filters?.counterparty) qs.set("counterparty", filters.counterparty)
  if (filters?.sourceType) qs.set("sourceType", filters.sourceType)
  if (page > 1) qs.set("page", String(page))
  const query = qs.toString()
  return useQuery({
    queryKey: ["finance", "registry", orgId, query],
    queryFn: async () => {
      const res = await fetch(`/api/finance/registry${query ? `?${query}` : ""}`, {
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "API error")
      return json as { data: PaymentRegistryEntry[]; stats: PaymentRegistryStats; total: number }
    },
    enabled: !!orgId,
  })
}

// ─── Payment Orders ────────────────────────────────────────────────────────

export function usePaymentOrders(status?: string) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "payment-orders", orgId, status],
    queryFn: () => apiFetch<PaymentOrder[]>(`/api/finance/payment-orders${status ? `?status=${status}` : ""}`, orgId),
    enabled: !!orgId,
  })
}

export function usePaymentOrdersStats() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "payment-orders-stats", orgId],
    queryFn: () => apiFetch<PaymentOrdersStats>("/api/finance/payment-orders/stats", orgId),
    enabled: !!orgId,
  })
}

export function useCreatePaymentOrder() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePaymentOrderInput) =>
      apiFetch<PaymentOrder>("/api/finance/payment-orders", orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders"] })
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders-stats"] })
    },
  })
}

export function useUpdatePaymentOrder() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdatePaymentOrderInput & { id: string }) =>
      apiFetch<PaymentOrder>(`/api/finance/payment-orders/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders"] })
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders-stats"] })
    },
  })
}

export function useDeletePaymentOrder() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/finance/payment-orders/${id}`, orgId, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders"] })
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders-stats"] })
    },
  })
}

export function useSubmitPaymentOrder() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<PaymentOrder>(`/api/finance/payment-orders/${id}/submit`, orgId, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders"] })
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders-stats"] })
    },
  })
}

export function useApprovePaymentOrder() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<PaymentOrder>(`/api/finance/payment-orders/${id}/approve`, orgId, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders"] })
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders-stats"] })
    },
  })
}

export function useRejectPaymentOrder() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch<PaymentOrder>(`/api/finance/payment-orders/${id}/reject`, orgId, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders"] })
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders-stats"] })
    },
  })
}

export function useExecutePaymentOrder() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<PaymentOrder>(`/api/finance/payment-orders/${id}/execute`, orgId, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders"] })
      qc.invalidateQueries({ queryKey: ["finance", "payment-orders-stats"] })
      qc.invalidateQueries({ queryKey: ["finance", "registry"] })
      qc.invalidateQueries({ queryKey: ["finance", "payables"] })
      qc.invalidateQueries({ queryKey: ["finance", "payables-stats"] })
      qc.invalidateQueries({ queryKey: ["finance", "dashboard"] })
    },
  })
}

// ─── Bank Accounts ─────────────────────────────────────────────────────

export function useBankAccounts() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ["finance", "bank-accounts", orgId],
    queryFn: () => apiFetch<BankAccount[]>("/api/finance/bank-accounts", orgId),
    enabled: !!orgId,
  })
}

export function useCreateBankAccount() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateBankAccountInput) =>
      apiFetch<BankAccount>("/api/finance/bank-accounts", orgId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "bank-accounts"] })
    },
  })
}

export function useUpdateBankAccount() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CreateBankAccountInput> & { id: string }) =>
      apiFetch<BankAccount>(`/api/finance/bank-accounts/${id}`, orgId, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "bank-accounts"] })
    },
  })
}

export function useDeleteBankAccount() {
  const orgId = useOrgId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/finance/bank-accounts/${id}`, orgId, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance", "bank-accounts"] })
    },
  })
}
