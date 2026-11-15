/**
 * Sending a folder to a task from the card (Nazrin, 2026-11-15: «papka
 * yükləmək olsa daha rahat olar… bir dəfəyə bir neçə sənəd»): a big file goes
 * in 8 MB parts, a file the task would refuse is named back without a request,
 * system junk is left out, a dropped folder is read all the way down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  filesFromDrop, filesFromPicker, nameInFolder, sendTaskFiles, taskFileRefusal, type TaskFileToSend,
} from "@/lib/tasks/task-file-upload"
import { TASK_FILE_PART_SIZE } from "@/lib/tasks/task-file-rules"

type Sent = { url: URL; size: number }
let sent: Sent[] = []
let answer: (url: URL, attempt: number) => Response = () => new Response("{}", { status: 202 })

beforeEach(() => {
  sent = []
  answer = (url) => new Response("{}", { status: Number(url.searchParams.get("index")) + 1 === Number(url.searchParams.get("count")) ? 201 : 202 })
  const attempts = new Map<string, number>()
  vi.stubGlobal("fetch", vi.fn(async (href: string, init?: RequestInit) => {
    const url = new URL(href, "http://crm.test")
    const key = `${url.searchParams.get("upload")}:${url.searchParams.get("index")}`
    const attempt = (attempts.get(key) ?? 0) + 1
    attempts.set(key, attempt)
    sent.push({ url, size: (init?.body as Blob).size })
    return answer(url, attempt)
  }))
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const file = (name: string, size: number, type = "") => new File([new Uint8Array(size)], name, { type })
const item = (name: string, size: number, type = ""): TaskFileToSend => ({ file: file(name.split("/").pop()!, size, type), name })

describe("task file sending", () => {
  it("a 20 MB video goes in three parts of 8, 8 and the rest, all under one upload id", async () => {
    const size = 2 * TASK_FILE_PART_SIZE + 4321
    const progress: number[] = []
    const result = await sendTaskFiles("t1", [item("Promo/reels.mp4", size, "video/mp4")], { onProgress: (p) => progress.push(p.sentBytes) })
    expect(result).toEqual({ added: ["Promo/reels.mp4"], failed: [] })
    expect(sent.map((s) => s.size)).toEqual([TASK_FILE_PART_SIZE, TASK_FILE_PART_SIZE, 4321])
    expect(new Set(sent.map((s) => s.url.searchParams.get("upload"))).size).toBe(1)
    expect(sent[0].url.pathname).toBe("/api/v1/tasks/t1/files/parts")
    expect(sent[0].url.searchParams.get("upload")).toMatch(/^[0-9a-f]{32}$/u)
    expect(sent.map((s) => s.url.searchParams.get("index"))).toEqual(["0", "1", "2"])
    expect(sent[2].url.searchParams.get("name")).toBe("Promo/reels.mp4")
    expect(sent[2].url.searchParams.get("size")).toBe(String(size))
    expect(Math.max(...progress)).toBe(size)
  })

  it("names back what the task would refuse without sending it, and leaves system junk out in silence", async () => {
    const huge = { name: "film.mp4", size: 100 * 1024 * 1024 + 1, type: "video/mp4", slice: () => new Blob() } as unknown as File
    const result = await sendTaskFiles("t1", [
      { file: huge, name: "film.mp4" },
      item("logo.svg", 10, "image/svg+xml"),
      item("setup.exe", 10),
      item("empty.pdf", 0),
      item(".DS_Store", 10),
      item("Banner/Thumbs.db", 10),
      item("~$brif.docx", 10),
      item("logo.png", 10, "image/png"),
    ])
    expect(result.added).toEqual(["logo.png"])
    expect(result.failed).toEqual([
      { name: "empty.pdf", refusal: "empty", message: undefined },
      { name: "film.mp4", refusal: "too_big", message: undefined },
      { name: "logo.svg", refusal: "type", message: undefined },
      { name: "setup.exe", refusal: "type", message: undefined },
    ])
    expect(sent.map((s) => s.url.searchParams.get("name"))).toEqual(["logo.png"])
  })

  it("sends in the order a person reads: 2 before 10", async () => {
    await sendTaskFiles("t1", [item("10.png", 5, "image/png"), item("2.png", 5, "image/png"), item("1.png", 5, "image/png")])
    expect(sent.map((s) => s.url.searchParams.get("name"))).toEqual(["1.png", "2.png", "10.png"])
  })

  it("a dropped connection or a restarting server costs a retry, not the file; a refusal is not retried", async () => {
    answer = (url, attempt) => (url.searchParams.get("name") === "a.png" && attempt === 1
      ? new Response("{}", { status: 503 })
      : url.searchParams.get("name") === "b.png"
        ? new Response(JSON.stringify({ error: "File content is not a valid PNG", refusal: "content" }), { status: 400 })
        : new Response("{}", { status: 201 }))
    const result = await sendTaskFiles("t1", [item("a.png", 5, "image/png"), item("b.png", 5, "image/png")])
    expect(result.added).toEqual(["a.png"])
    expect(result.failed).toEqual([{ name: "b.png", refusal: "content", message: "File content is not a valid PNG" }])
    expect(sent.map((s) => s.url.searchParams.get("name"))).toEqual(["a.png", "a.png", "b.png"])
  })

  it("the browser's word for a type is taken when it is ours, the name's otherwise", () => {
    expect(taskFileRefusal({ size: 5, type: "" }, "brand.cdr")).toBeNull()
    expect(taskFileRefusal({ size: 5, type: "application/octet-stream" }, "logo.AI")).toBeNull()
    expect(taskFileRefusal({ size: 5, type: "image/svg+xml" }, "logo.svg")).toBe("type")
  })
})

describe("what a picker or a drop gives", () => {
  it("a picked folder's files are named by their place inside it", () => {
    expect(nameInFolder("Promo/Banner/az.png", "az.png")).toBe("Banner/az.png")
    expect(nameInFolder("Promo/logo.png", "logo.png")).toBe("logo.png")
    expect(nameInFolder("", "logo.png")).toBe("logo.png")
    const inFolder = file("az.png", 1)
    Object.defineProperty(inFolder, "webkitRelativePath", { value: "Promo/Story/az.png" })
    expect(filesFromPicker([file("brif.pdf", 1), inFolder]).map((f) => f.name)).toEqual(["brif.pdf", "Story/az.png"])
  })

  type FakeEntry = { name: string; isFile: boolean; isDirectory: boolean; file?: (ok: (f: File) => void) => void; createReader?: () => { readEntries: (ok: (e: FakeEntry[]) => void) => void } }
  const fileEntry = (name: string): FakeEntry => ({ name, isFile: true, isDirectory: false, file: (ok) => ok(file(name, 3, "image/png")) })
  // Hands its entries over in batches of two, then an empty one — as Chrome does in hundreds.
  const folder = (name: string, children: FakeEntry[]): FakeEntry => ({
    name, isFile: false, isDirectory: true,
    createReader: () => { let at = 0; return { readEntries: (ok) => { const batch = children.slice(at, at + 2); at += 2; ok(batch) } } },
  })
  const drop = (entries: FakeEntry[]) => ({ items: entries.map((entry) => ({ kind: "file", webkitGetAsEntry: () => entry })), files: [] }) as unknown as DataTransfer

  it("a dropped folder is read all the way down, its files named by their place inside it", async () => {
    const promo = folder("Promo", [fileEntry("logo.png"), fileEntry("2.png"), fileEntry("3.png"), folder("Story", [fileEntry("az.png"), folder("RU", [fileEntry("ru.png")])])])
    const got = await filesFromDrop(drop([promo, fileEntry("brif.png")]))
    expect(got.map((f) => f.name)).toEqual(["logo.png", "2.png", "3.png", "Story/az.png", "Story/RU/ru.png", "brif.png"])
  })

  it("two folders dropped together keep their own names in front, so their files stay apart", async () => {
    const got = await filesFromDrop(drop([folder("AZ", [fileEntry("banner.png")]), folder("RU", [fileEntry("banner.png")])]))
    expect(got.map((f) => f.name)).toEqual(["AZ/banner.png", "RU/banner.png"])
  })
})
