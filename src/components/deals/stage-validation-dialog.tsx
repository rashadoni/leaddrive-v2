"use client"

import { motion, AnimatePresence } from "framer-motion"
import { XCircle, AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"

interface ValidationError {
  field: string
  message: string
}

interface StageValidationDialogProps {
  open: boolean
  onClose: () => void
  errors: ValidationError[]
  targetStage: string
  stageLabel: string
  stageColor: string
}

export function StageValidationDialog({
  open,
  onClose,
  errors,
  targetStage,
  stageLabel,
  stageColor,
}: StageValidationDialogProps) {
  const t = useTranslations("deals")

  if (!open) return null

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40"
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-full max-w-md rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <div>
                    <p className="text-sm font-semibold">{t("stageTransitionBlocked")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("requirementsFor")} <span className="font-medium" style={{ color: stageColor }}>{stageLabel}</span>
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Checklist */}
              <div className="p-4 space-y-2">
                {errors.map((err, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30"
                  >
                    <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-700 dark:text-red-400">{err.message}</p>
                      <p className="text-xs text-red-500/70 dark:text-red-400/60 mt-0.5">
                        {t("fieldLabel")}: {err.field}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Footer */}
              <div className="p-4 border-t bg-muted/20">
                <Button onClick={onClose} variant="outline" className="w-full">
                  {t("understood")}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
