import { inflateSync } from "node:zlib"

/** Decode the actual jsPDF text streams and embedded ToUnicode maps. */
export function attendancePdfText(bytes: Buffer) {
  const source = bytes.toString("latin1")
  const streams: string[] = []
  for (const match of source.matchAll(/(\d+) 0 obj\b([\s\S]*?)endobj/g)) {
    const body = match[2]
    const start = body.indexOf("stream\n")
    if (start < 0) continue
    const end = body.lastIndexOf("\nendstream")
    const buffer = Buffer.from(body.slice(start + 7, end), "latin1")
    streams.push(/\/FlateDecode/.test(body.slice(0, start)) ? inflateSync(buffer).toString("latin1") : buffer.toString("latin1"))
  }
  const map = new Map<string, string>()
  for (const stream of streams.filter((value) => value.includes("beginbfchar"))) {
    for (const block of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1].matchAll(/<([a-f\d]+)>\s*<([a-f\d]+)>/gi)) {
        map.set(pair[1].toLowerCase(), pair[2].match(/.{4}/g)!.map((unit) => String.fromCharCode(parseInt(unit, 16))).join(""))
      }
    }
  }
  return streams.flatMap((stream) => [...stream.matchAll(/<([a-f\d]+)>\s*Tj/gi)].map((match) => (match[1].match(/.{4}/g) ?? []).map((unit) => map.get(unit.toLowerCase()) ?? "?").join(""))).join("\n")
}

