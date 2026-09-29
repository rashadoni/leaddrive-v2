export type WorkforceReadIdentityInput = {
  view: "today" | "timesheet" | "requests"
  organizationId: string
  retry: number
  timesheetQuery: {
    agentId: string
    start: string
    end: string
  }
}

export function createWorkforceReadIdentity(input: WorkforceReadIdentityInput): string {
  return JSON.stringify([
    input.view,
    input.organizationId,
    input.retry,
    input.timesheetQuery.agentId,
    input.timesheetQuery.start,
    input.timesheetQuery.end,
  ])
}

export class TimesheetApprovalRefreshLifecycle {
  private taggedIdentity: string | null = null

  tag(identity: string): void {
    this.taggedIdentity = identity
  }

  clear(): void {
    this.taggedIdentity = null
  }

  isActive(identity: string): boolean {
    return this.taggedIdentity === identity
  }

  begin(identity: string): boolean {
    if (!this.isActive(identity)) {
      this.clear()
      return false
    }
    return true
  }

  settle(identity: string, cancelled: boolean): void {
    if (!cancelled && this.isActive(identity)) this.clear()
  }
}

export function shouldRenderWorkforceData(input: {
  loadedIdentity: string | null
  activeIdentity: string
  loading: boolean
  taggedApprovalRefresh: boolean
}): boolean {
  return input.taggedApprovalRefresh
    || (!input.loading && input.loadedIdentity === input.activeIdentity)
}
