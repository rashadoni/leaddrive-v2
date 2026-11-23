import { fileKindOf, type FileKind } from "@/lib/tasks/file-kind"

// The colours people know these programs by; pictures stay quiet, being most of
// what a card holds (Zeytun: 3 700 of 4 900 files), so a sheet stands out.
// One set for both themes: white text on each of them is readable on either.
const FILL: Record<FileKind, string> = {
  excel: "#1D7A46",
  word: "#185FA5",
  powerpoint: "#C2410C",
  pdf: "#C8332F",
  image: "#5F5E5A",
  video: "#534AB7",
  audio: "#0E7490",
  design: "#993556",
  archive: "#854F0B",
  other: "#475569",
}

/** A file's mark: a sheet of paper in its program's colour — large on a tile, smaller on a message's file card. */
export function TaskFileBadge({ name, mimeType, size = "tile" }: { name: string; mimeType?: string | null; size?: "tile" | "card" }) {
  const { kind, label } = fileKindOf(name, mimeType)
  return (
    <span
      aria-hidden="true"
      data-file-kind={kind}
      style={{ background: FILL[kind] }}
      className={size === "tile"
        ? "flex h-11 w-9 shrink-0 items-end justify-center rounded-[4px_11px_4px_4px] pb-1.5 text-[10px] font-semibold leading-none text-white"
        : "flex h-[34px] w-7 shrink-0 items-end justify-center rounded-[3px_8px_3px_3px] pb-1 text-[9px] font-semibold leading-none text-white"}
    >
      {label}
    </span>
  )
}
