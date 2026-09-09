"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Eye, Download, FileText, Image as ImageIcon, File } from "lucide-react"

interface FilePreviewProps {
  file: {
    id: string
    fileName: string
    originalName: string
    mimeType: string
    fileSize?: number
  }
  downloadUrl: string
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="h-4 w-4 text-green-600" />
  if (mimeType === "application/pdf") return <FileText className="h-4 w-4 text-red-600" />
  return <File className="h-4 w-4 text-muted-foreground" />
}

function isPreviewable(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType === "application/pdf"
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FilePreview({ file, downloadUrl }: FilePreviewProps) {
  const [open, setOpen] = useState(false)
  const canPreview = isPreviewable(file.mimeType)

  return (
    <>
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2 bg-card hover:bg-muted/50 transition-colors">
        {getFileIcon(file.mimeType)}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{file.originalName}</p>
          {file.fileSize && <p className="text-[10px] text-muted-foreground">{formatFileSize(file.fileSize)}</p>}
        </div>
        <div className="flex items-center gap-1">
          {canPreview && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOpen(true)}>
              <Eye className="h-3 w-3" />
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
            <a href={downloadUrl} download={file.originalName}>
              <Download className="h-3 w-3" />
            </a>
          </Button>
        </div>
      </div>

      {canPreview && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogHeader>
            <DialogTitle>{file.originalName}</DialogTitle>
          </DialogHeader>
          <DialogContent className="max-w-4xl">
            {file.mimeType.startsWith("image/") ? (
              <img
                src={downloadUrl}
                alt={file.originalName}
                className="max-h-[70vh] w-auto mx-auto rounded-lg"
              />
            ) : file.mimeType === "application/pdf" ? (
              <iframe
                src={downloadUrl}
                className="w-full h-[70vh] rounded-lg border border-zinc-200 dark:border-zinc-700"
                title={file.originalName}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
