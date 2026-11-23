import { fileKindOf, type FileKind } from "@/lib/tasks/file-kind"

// The colours people know these programs by (Excel: the green of Bordio's sheet); pictures stay quiet, being most of
// what a card holds (Zeytun: 3 700 of 4 900 files), so a sheet stands out.
// One set for both themes: white text on each of them is readable on either.
const FILL: Record<FileKind, string> = {
  excel: "#5E8E32",
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
      style={{ background: FILL[kind], clipPath: "polygon(0 0, 68% 0, 100% 24%, 100% 100%, 0 100%)" }}
      className={`relative flex shrink-0 items-end justify-center leading-none text-white ${size === "tile" ? "h-[42px] w-[34px] pb-1.5 text-[11px]" : "h-[34px] w-7 pb-1 text-[9px] font-medium"}`}
    >
      {/* The folded corner of the sheet. */}
      <span className="absolute right-0 top-0 h-[24%] w-[32%] bg-black/30" style={{ clipPath: "polygon(0 0, 100% 100%, 0 100%)" }} />
      {label}
    </span>
  )
}
