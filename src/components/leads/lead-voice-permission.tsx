"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Ban,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type PermissionStatus = "allowed" | "blocked" | "unknown";
type Phase = "loading" | "ready" | "hidden" | "error";
type PendingAction = "block" | "allow" | null;
type MutationError = "generic" | "stale" | "broader" | null;

type PermissionEvent = {
  action: "block" | "allow";
  occurredAt: string;
};

type PermissionData = {
  state: PermissionStatus;
  suppressionActive: boolean;
  globalBlockActive: boolean;
  salesBlockActive: boolean;
  durableConsent: PermissionStatus;
  changedAt: string | null;
  leadVersion: string;
  phoneReady: boolean;
  canBlock: boolean;
  canManage: boolean;
  recentEvents?: PermissionEvent[];
  replayed?: boolean;
};

function requestHeaders(organizationId?: string): Record<string, string> {
  return organizationId ? { "x-organization-id": organizationId } : {};
}

function isPermissionData(value: unknown): value is PermissionData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    ["allowed", "blocked", "unknown"].includes(String(candidate.state)) &&
    ["allowed", "blocked", "unknown"].includes(
      String(candidate.durableConsent),
    ) &&
    typeof candidate.suppressionActive === "boolean" &&
    typeof candidate.globalBlockActive === "boolean" &&
    typeof candidate.salesBlockActive === "boolean" &&
    (candidate.changedAt === null || typeof candidate.changedAt === "string") &&
    typeof candidate.leadVersion === "string" &&
    typeof candidate.phoneReady === "boolean" &&
    typeof candidate.canBlock === "boolean" &&
    typeof candidate.canManage === "boolean" &&
    (candidate.recentEvents === undefined ||
      (Array.isArray(candidate.recentEvents) &&
        candidate.recentEvents.every((event) => {
          if (!event || typeof event !== "object" || Array.isArray(event))
            return false;
          const entry = event as Record<string, unknown>;
          return (
            ["block", "allow"].includes(String(entry.action)) &&
            typeof entry.occurredAt === "string"
          );
        })))
  );
}

export function LeadVoicePermission({
  leadId,
  organizationId,
}: {
  leadId: string;
  organizationId?: string;
}) {
  const t = useTranslations("leads.voicePermission");
  const locale = useLocale();
  const allowConfirmationId = useId();
  const [phase, setPhase] = useState<Phase>("loading");
  const [permission, setPermission] = useState<PermissionData | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [allowConfirmed, setAllowConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<MutationError>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const loadPermission = useCallback(
    async (signal?: AbortSignal) => {
      setPhase("loading");
      try {
        const response = await fetch(
          `/api/v1/leads/${encodeURIComponent(leadId)}/voice-permission`,
          {
            headers: requestHeaders(organizationId),
            cache: "no-store",
            signal,
          },
        );
        if (signal?.aborted) return;
        if (response.status === 403 || response.status === 404) {
          setPhase("hidden");
          return;
        }
        const payload = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: unknown;
        } | null;
        if (
          !response.ok ||
          payload?.success !== true ||
          !isPermissionData(payload.data)
        ) {
          setPhase("error");
          return;
        }
        setPermission(payload.data);
        setPhase("ready");
      } catch {
        if (!signal?.aborted) setPhase("error");
      }
    },
    [leadId, organizationId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPermission(controller.signal);
    return () => controller.abort();
  }, [loadPermission]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const changedAt = useMemo(() => {
    if (!permission?.changedAt) return null;
    const date = new Date(permission.changedAt);
    if (Number.isNaN(date.getTime())) return null;
    return dateFormatter.format(date);
  }, [dateFormatter, permission?.changedAt]);

  const openConfirmation = (action: Exclude<PendingAction, null>) => {
    setPendingAction(action);
    setAllowConfirmed(false);
    setMutationError(null);
    idempotencyKeyRef.current = crypto.randomUUID();
  };

  const closeConfirmation = () => {
    if (saving) return;
    setPendingAction(null);
    setAllowConfirmed(false);
    const shouldReload =
      mutationError === "stale" || mutationError === "broader";
    setMutationError(null);
    idempotencyKeyRef.current = null;
    if (shouldReload) void loadPermission();
  };

  const savePermission = async () => {
    if (!pendingAction || !idempotencyKeyRef.current || !permission) return;
    if (pendingAction === "allow" && !allowConfirmed) return;
    setSaving(true);
    setMutationError(null);
    try {
      const response = await fetch(
        `/api/v1/leads/${encodeURIComponent(leadId)}/voice-permission`,
        {
          method: "POST",
          headers: {
            ...requestHeaders(organizationId),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: pendingAction,
            idempotencyKey: idempotencyKeyRef.current,
            leadVersion: permission.leadVersion,
            ...(pendingAction === "allow" ? { confirmation: true } : {}),
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: unknown;
        code?: string;
      } | null;
      if (
        !response.ok ||
        payload?.success !== true ||
        !isPermissionData(payload.data)
      ) {
        setMutationError(
          payload?.code === "lead_version_conflict"
            ? "stale"
            : payload?.code === "broader_restriction_active"
              ? "broader"
              : "generic",
        );
        return;
      }
      setPermission(payload.data);
      setPhase("ready");
      toast.success(
        pendingAction === "block" ? t("blockedSaved") : t("allowedSaved"),
      );
      setPendingAction(null);
      setAllowConfirmed(false);
      setMutationError(null);
      idempotencyKeyRef.current = null;
    } catch {
      setMutationError("generic");
    } finally {
      setSaving(false);
    }
  };

  if (phase === "hidden") return null;

  if (phase === "loading") {
    return (
      <Card aria-busy="true">
        <CardContent className="flex min-h-24 items-center justify-center py-5 text-muted-foreground">
          <Loader2
            aria-hidden="true"
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
          />
          <span className="sr-only">{t("loading")}</span>
        </CardContent>
      </Card>
    );
  }

  if (phase === "error" || !permission) {
    return (
      <Card>
        <CardContent className="space-y-3 py-4">
          <p
            role="alert"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            {t("loadError")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void loadPermission()}
          >
            <RefreshCw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
            {t("retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const statusTone =
    permission.state === "blocked"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
      : permission.state === "allowed"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
        : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300";

  return (
    <>
      <Card>
        <CardHeader className="space-y-2 pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="flex min-w-0 items-start gap-2 text-sm leading-snug">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
              />
              <span className="min-w-0">{t("title")}</span>
            </CardTitle>
            <Badge variant="outline" className={cn("shrink-0", statusTone)}>
              {t(`status.${permission.state}`)}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {!permission.phoneReady
              ? t("phoneUnavailable")
              : t(`description.${permission.state}`)}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {changedAt ? (
            <p className="text-[11px] text-muted-foreground">
              {t("lastChanged", { date: changedAt })}
            </p>
          ) : null}

          {permission.globalBlockActive ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("broaderRestrictionActive")}
            </p>
          ) : permission.state === "blocked" && !permission.canManage ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("managerRestoreOnly")}
            </p>
          ) : null}

          {permission.phoneReady &&
          (permission.canBlock || permission.canManage) ? (
            <div className="flex flex-col gap-2">
              {permission.state !== "blocked" && permission.canBlock ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left leading-snug border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800 sm:min-h-9 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
                  onClick={() => openConfirmation("block")}
                >
                  <Ban aria-hidden="true" className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                  {t("blockAction")}
                </Button>
              ) : null}
              {permission.canManage &&
              !permission.globalBlockActive &&
              permission.state !== "allowed" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left leading-snug sm:min-h-9"
                  onClick={() => openConfirmation("allow")}
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                  />
                  {permission.state === "blocked"
                    ? t("restoreAction")
                    : t("allowAction")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {permission.recentEvents && permission.recentEvents.length > 0 ? (
            <div className="border-t pt-3">
              <p className="mb-2 text-xs font-medium text-foreground">
                {t("historyTitle")}
              </p>
              <ul className="space-y-1.5">
                {permission.recentEvents.map((event) => {
                  const occurredAt = new Date(event.occurredAt);
                  if (Number.isNaN(occurredAt.getTime())) return null;
                  return (
                    <li
                      key={`${event.action}:${event.occurredAt}`}
                      className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground"
                    >
                      <span>{t(`history.${event.action}`)}</span>
                      <time dateTime={event.occurredAt} className="shrink-0">
                        {dateFormatter.format(occurredAt)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) closeConfirmation();
        }}
        hideClose={saving}
      >
        <DialogHeader>
          <DialogTitle>
            {pendingAction === "block"
              ? t("blockDialogTitle")
              : t("allowDialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {pendingAction === "block"
              ? t("blockDialogDescription")
              : t("allowDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-4">
          {pendingAction === "allow" ? (
            <label
              htmlFor={allowConfirmationId}
              className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed"
            >
              <input
                id={allowConfirmationId}
                type="checkbox"
                checked={allowConfirmed}
                onChange={(event) => setAllowConfirmed(event.target.checked)}
                disabled={saving}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
              />
              <span>{t("allowConfirmation")}</span>
            </label>
          ) : null}
          {mutationError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(
                mutationError === "stale"
                  ? "staleError"
                  : mutationError === "broader"
                    ? "broaderRestrictionError"
                    : "saveError",
              )}
            </p>
          ) : null}
        </DialogContent>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={closeConfirmation}
            disabled={saving}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant={pendingAction === "block" ? "destructive" : "default"}
            onClick={() => void savePermission()}
            disabled={
              saving ||
              mutationError === "stale" ||
              mutationError === "broader" ||
              (pendingAction === "allow" && !allowConfirmed)
            }
          >
            {saving ? (
              <Loader2
                aria-hidden="true"
                className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {saving
              ? t("saving")
              : pendingAction === "block"
                ? t("confirmBlock")
                : t("confirmAllow")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
