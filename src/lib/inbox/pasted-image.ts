/**
 * The picture a paste into the inbox reply box carries (owner, 2026-11-27: «сделай функцию чтоб можно
 * было из буфер обмена вставлять фото. сейчас мне приходится сохранять фото а потом выбирать через
 * файл»). A screenshot or a browser's «Copy image» puts the picture on the clipboard as a file; the
 * reply box then sends it as the paperclip would.
 *
 * A paste that carries text stays a text paste: a spreadsheet or a document copies its cells together
 * with a picture of them, and the person pasting those meant the words.
 */
export function pastedImage(data: Pick<DataTransfer, "getData" | "items" | "files"> | null | undefined): File | null {
  if (!data) return null
  if (data.getData("text/plain").trim()) return null
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue
    const file = item.getAsFile()
    if (file) return withName(file)
  }
  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith("image/")) return withName(file)
  }
  return null
}

/** Some clipboards hand the picture over without a name; the upload and the chip need one. */
function withName(file: File): File {
  if (file.name) return file
  const extension = file.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png"
  return new File([file], `image.${extension}`, { type: file.type })
}
