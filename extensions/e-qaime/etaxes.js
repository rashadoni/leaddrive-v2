/*
 * LeadDrive e-Qaimə — on the tax portal's pages.
 *
 * Reads the signed-in company's electronic invoices the way the portal's own
 * screens do, with the pass the portal keeps in this tab, and hands them to the
 * background, which brings them to LeadDrive. The pass never leaves this tab.
 *
 * What is read: incoming and outgoing invoices of the chosen period, each
 * invoice's card (lines, VAT bases) and its PDF. LeadDrive is asked first which
 * invoices it already has, so a second reading opens only the new ones and the
 * ones whose status changed.
 */
(function () {
  "use strict"
  if (window.__leaddriveEqaime) return
  window.__leaddriveEqaime = true

  const C = window.LeadDriveEqaimeCore
  const RENEW_BEFORE_MS = 2 * 60 * 1000
  const PAUSE_MS = 150
  const IMPORT_BATCH = 25
  const KNOWN_BATCH = 200

  // ─── Words ────────────────────────────────────────────────────────────────
  const RU = {
    button: "LeadDrive · e-qaimə",
    title: "LeadDrive · e-qaimə",
    portalCompany: "e-Taxes: «{name}», VÖEN {voen}",
    signInPortal: "Войдите в e-Taxes как компания — тогда можно загрузить накладные.",
    leaddrive: "LeadDrive: {org} · {user}",
    signInLeadDrive: "Войдите в LeadDrive в этом Chrome — накладные попадут туда.",
    openLeadDrive: "Открыть LeadDrive",
    noRights: "В LeadDrive у вас нет права добавлять данные в «Финансы». Попросите администратора.",
    period: "Период",
    from: "с",
    to: "по",
    inbox: "Входящие",
    outbox: "Исходящие",
    start: "Загрузить в LeadDrive",
    stop: "Остановить",
    keepOpen: "Не закрывайте эту вкладку, пока идёт загрузка.",
    listing: "{dir}: ищу накладные за {month}…",
    reading: "{dir}: открываю накладные {done} из {total}",
    pdfs: "{dir}: PDF {done} из {total}",
    done: "Готово: найдено {found}, новых или изменённых {opened}, PDF {pdfs}.",
    doneErrors: "С ошибками: {count}. Нажмите «Загрузить» ещё раз — уже загруженное повторно не откроется.",
    stopped: "Остановлено. Уже загруженное сохранено в LeadDrive.",
    openInLeadDrive: "Открыть в LeadDrive",
    expired: "Сессия e-Taxes закончилась. Войдите заново и нажмите «Загрузить».",
    portalError: "e-Taxes не ответил ({detail}). Попробуйте ещё раз позже.",
    leaddriveError: "LeadDrive не принял данные ({detail}).",
    badPeriod: "Проверьте даты: с 01.01.2020 и не позже сегодняшнего дня.",
    close: "Закрыть",
  }
  const AZ = {
    button: "LeadDrive · e-qaimə",
    title: "LeadDrive · e-qaimə",
    portalCompany: "e-Taxes: «{name}», VÖEN {voen}",
    signInPortal: "e-Taxes-ə şirkət kimi daxil olun — sonra qaimələri yükləmək olar.",
    leaddrive: "LeadDrive: {org} · {user}",
    signInLeadDrive: "Bu Chrome-da LeadDrive-a daxil olun — qaimələr ora düşəcək.",
    openLeadDrive: "LeadDrive-ı aç",
    noRights: "LeadDrive-da «Maliyyə»yə məlumat əlavə etmək hüququnuz yoxdur. Administratora müraciət edin.",
    period: "Dövr",
    from: "başlanğıc",
    to: "son",
    inbox: "Gələnlər",
    outbox: "Göndərilənlər",
    start: "LeadDrive-a yüklə",
    stop: "Dayandır",
    keepOpen: "Yükləmə gedərkən bu səhifəni bağlamayın.",
    listing: "{dir}: {month} üzrə qaimələr axtarılır…",
    reading: "{dir}: qaimələr açılır, {done} / {total}",
    pdfs: "{dir}: PDF {done} / {total}",
    done: "Hazırdır: tapıldı {found}, yeni və ya dəyişmiş {opened}, PDF {pdfs}.",
    doneErrors: "Xəta ilə: {count}. «Yüklə»ni yenidən basın — artıq yüklənənlər təkrar açılmayacaq.",
    stopped: "Dayandırıldı. Yüklənənlər LeadDrive-da saxlanıb.",
    openInLeadDrive: "LeadDrive-da aç",
    expired: "e-Taxes sessiyası bitib. Yenidən daxil olun və «Yüklə»ni basın.",
    portalError: "e-Taxes cavab vermədi ({detail}). Bir az sonra yenidən cəhd edin.",
    leaddriveError: "LeadDrive məlumatı qəbul etmədi ({detail}).",
    badPeriod: "Tarixləri yoxlayın: 01.01.2020-dən və bu gündən gec olmayaraq.",
    close: "Bağla",
  }
  const W = /^ru\b/i.test(navigator.language || "") ? RU : AZ
  const say = (key, vars) => String(W[key] || key).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ""))

  // ─── The portal ───────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function readToken() {
    try { return localStorage.getItem(C.TOKEN_KEY) || "" } catch { return "" }
  }
  function claims() {
    const token = readToken()
    if (!token) return null
    try { return C.tokenClaims(token) } catch { return null }
  }
  const bearer = (token) => (/^Bearer\s/i.test(token) ? token : "Bearer " + token)

  class SessionExpired extends Error {}

  let renewing = null
  /** The pass lives about ten minutes; a long reading renews it the way the portal does. */
  function renew() {
    renewing = renewing || (async () => {
      const old = readToken()
      if (!old) throw new SessionExpired()
      const response = await fetch(C.RENEW_URL, { method: "POST", headers: { "x-authorization": bearer(old) }, credentials: "include" })
      const fresh = response.ok && response.headers.get("x-authorization")
      if (!fresh) throw new SessionExpired()
      const value = fresh.replace(/^Bearer\s+/i, "")
      localStorage.setItem(C.TOKEN_KEY, /^Bearer\s/i.test(old) ? "Bearer " + value : value)
    })().finally(() => { renewing = null })
    return renewing
  }

  async function portal(url, init) {
    const c = claims()
    if (!c) throw new SessionExpired()
    if (c.exp && c.exp * 1000 - Date.now() < RENEW_BEFORE_MS) await renew()
    const send = () => {
      const headers = new Headers((init && init.headers) || {})
      headers.set("x-authorization", bearer(readToken()))
      if (init && init.body) headers.set("content-type", "application/json")
      return fetch(url, Object.assign({}, init, { headers, credentials: "include" }))
    }
    let response = await send()
    if (response.status === 401) {
      await renew()
      response = await send()
    }
    if (response.status === 401) throw new SessionExpired()
    return response
  }

  async function portalJson(url, init) {
    const response = await portal(url, init)
    if (!response.ok) throw new Error(say("portalError", { detail: "HTTP " + response.status }))
    return response.json()
  }

  /** Every invoice listed for one direction and one chunk; a chunk over the limit is read by days. */
  async function listChunk(direction, chunk, seen, onProgress) {
    const url = C.API + "/invoice/" + (direction === "outbox" ? "find.outbox" : "find.inbox")
    const out = []
    for (let offset = 0; ; ) {
      if (stopRequested) return out
      const answer = await portalJson(url, { method: "POST", body: JSON.stringify(C.searchBody(direction, chunk, offset)) })
      const page = C.listOf(answer)
      const total = C.totalOf(answer)
      if (offset === 0 && total !== null && total > C.OFFSET_LIMIT && chunk.from !== chunk.to) {
        const all = []
        for (const day of C.dayChunks(chunk.from, chunk.to)) all.push(...await listChunk(direction, day, seen, onProgress))
        return out.concat(all)
      }
      let fresh = 0
      for (const item of page) {
        if (item && item.id != null && !seen.has(String(item.id))) {
          seen.add(String(item.id))
          out.push(item)
          fresh++
        }
      }
      onProgress()
      offset += page.length
      // Stop at the end, and when the portal answers the same page again.
      if (!page.length || fresh === 0 || page.length < C.PAGE_SIZE) break
      if ((total !== null && offset >= total) || answer.hasMore === false || offset >= C.OFFSET_LIMIT) break
      await sleep(PAUSE_MS)
    }
    return out
  }

  async function pdfBase64(item) {
    const url = C.API + "/invoiceV2/" + encodeURIComponent(item.id) + "/pdf?sourceSystem=" + encodeURIComponent(item.sourceSystem || "avis")
    const response = await portal(url, { method: "GET" })
    if (!response.ok) throw new Error("PDF HTTP " + response.status)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length < 5) throw new Error("PDF empty")
    return C.bytesToBase64(bytes)
  }

  // ─── LeadDrive, through the background ────────────────────────────────────
  async function ld(message) {
    const answer = await chrome.runtime.sendMessage(message)
    if (!answer || !answer.ok) {
      const error = new Error(say("leaddriveError", { detail: answer && answer.status ? "HTTP " + answer.status : (answer && answer.error) || "?" }))
      error.status = answer && answer.status
      throw error
    }
    return answer.json
  }

  // ─── The reading ──────────────────────────────────────────────────────────
  let running = false
  let stopRequested = false

  async function run(period, directions) {
    const own = C.ownCompany(claims())
    if (!own) throw new SessionExpired()
    let found = 0
    let opened = 0
    let pdfs = 0
    let errors = 0

    for (const direction of directions) {
      const dirName = say(direction)
      const seen = new Set()
      const listed = []
      for (const chunk of C.monthChunks(period.from, period.to)) {
        if (stopRequested) break
        status(say("listing", { dir: dirName, month: chunk.from.slice(0, 7) }))
        listed.push(...await listChunk(direction, chunk, seen, () => {}))
      }
      found += listed.length

      for (let i = 0; i < listed.length && !stopRequested; i += KNOWN_BATCH) {
        const slice = listed.slice(i, i + KNOWN_BATCH)
        const known = (await ld({
          type: "ld-known",
          body: { ownVoen: own.voen, keys: slice.map((item) => ({ portalId: String(item.id), priorSystem: false, direction })) },
        })).data
        const todo = C.plan(slice, known)
        const pdfQueue = todo.pdfOnly.slice()

        // Open the new and the changed, and bring them in a batch at a time.
        for (let j = 0; j < todo.open.length && !stopRequested; j += IMPORT_BATCH) {
          const batch = []
          for (const item of todo.open.slice(j, j + IMPORT_BATCH)) {
            if (stopRequested) break
            status(say("reading", { dir: dirName, done: i + j + batch.length + 1, total: listed.length }))
            try {
              const detail = await portalJson(C.API + "/invoice/" + encodeURIComponent(item.id) + "?sourceSystem=" + encodeURIComponent(item.sourceSystem || "avis"))
              batch.push({ item, invoice: C.importInvoice(item, detail, direction) })
            } catch (error) {
              if (error instanceof SessionExpired) throw error
              errors++
            }
            await sleep(PAUSE_MS)
          }
          const valid = batch.filter((b) => b.invoice.issuedAt && b.invoice.serialNumber)
          errors += batch.length - valid.length
          if (!valid.length) continue
          const saved = (await ld({ type: "ld-import", body: { own, invoices: valid.map((b) => b.invoice) } })).data
          opened += saved.length
          for (const row of saved) {
            if (row.hasPdf) continue
            const match = valid.find((b) => String(b.item.id) === row.portalId)
            if (match) pdfQueue.push({ item: match.item, id: row.id })
          }
        }

        for (let k = 0; k < pdfQueue.length && !stopRequested; k++) {
          status(say("pdfs", { dir: dirName, done: k + 1, total: pdfQueue.length }))
          try {
            await ld({ type: "ld-pdf", id: pdfQueue[k].id, base64: await pdfBase64(pdfQueue[k].item) })
            pdfs++
          } catch (error) {
            if (error instanceof SessionExpired) throw error
            errors++
          }
          await sleep(PAUSE_MS)
        }
      }
    }
    return { found, opened, pdfs, errors }
  }

  // ─── The panel ────────────────────────────────────────────────────────────
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483646;"
  const shadow = host.attachShadow({ mode: "closed" })
  shadow.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; font-family: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif; }
      .pill { display:flex; align-items:center; gap:8px; border:0; border-radius:999px; padding:10px 16px; background:#EA580C; color:#fff; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 8px 24px rgba(0,0,0,.18); }
      .pill img { width:20px; height:20px; border-radius:5px; background:#fff; }
      .card { width:380px; background:#fff; color:#1b2433; border-radius:14px; box-shadow:0 18px 50px rgba(0,0,0,.25); padding:16px; font-size:13px; line-height:1.45; }
      .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
      .head b { font-size:15px; }
      .x { border:1px solid #e5e7eb; background:#fff; border-radius:8px; padding:4px 10px; font-size:12px; cursor:pointer; }
      .line { margin:4px 0; }
      .muted { color:#5f6b7a; }
      .warn { background:#fff7ed; color:#9a3412; border-radius:8px; padding:8px 10px; margin:8px 0; }
      .ok { background:#f0fdf4; color:#166534; border-radius:8px; padding:8px 10px; margin:8px 0; }
      .row { display:flex; gap:8px; align-items:center; margin:8px 0; flex-wrap:wrap; }
      input[type=date] { border:1px solid #d1d5db; border-radius:8px; padding:5px 8px; font-size:13px; }
      label.check { display:flex; align-items:center; gap:6px; }
      .go { width:100%; border:0; border-radius:10px; padding:10px; background:#EA580C; color:#fff; font-size:14px; font-weight:700; cursor:pointer; margin-top:6px; }
      .go[disabled] { opacity:.5; cursor:default; }
      .ghost { border:1px solid #d1d5db; background:#fff; border-radius:10px; padding:8px 12px; font-size:13px; font-weight:600; cursor:pointer; }
      .status { margin-top:10px; min-height:18px; }
      .hidden { display:none !important; }
    </style>
    <button class="pill" part="pill"><img alt="" src="${chrome.runtime.getURL("icons/icon32.png")}"><span class="pill-text"></span></button>
    <div class="card hidden">
      <div class="head"><b class="title"></b><button class="x close"></button></div>
      <div class="line portal muted"></div>
      <div class="line ld muted"></div>
      <div class="warn notice hidden"></div>
      <div class="form">
        <div class="row"><span class="period-label"></span>
          <span class="muted from-label"></span><input type="date" class="from">
          <span class="muted to-label"></span><input type="date" class="to"></div>
        <div class="row">
          <label class="check"><input type="checkbox" class="dir-inbox" checked><span class="inbox-label"></span></label>
          <label class="check"><input type="checkbox" class="dir-outbox" checked><span class="outbox-label"></span></label>
        </div>
        <button class="go start"></button>
      </div>
      <div class="status muted"></div>
      <div class="row result hidden"><button class="ghost open-ld"></button></div>
    </div>`

  const $ = (selector) => shadow.querySelector(selector)
  const pill = $(".pill")
  const card = $(".card")
  $(".pill-text").textContent = say("button")
  $(".title").textContent = say("title")
  $(".close").textContent = say("close")
  $(".period-label").textContent = say("period")
  $(".from-label").textContent = say("from")
  $(".to-label").textContent = say("to")
  $(".inbox-label").textContent = say("inbox")
  $(".outbox-label").textContent = say("outbox")
  $(".open-ld").textContent = say("openInLeadDrive")
  const startButton = $(".start")
  startButton.textContent = say("start")
  const period = C.defaultPeriod()
  $(".from").value = period.from
  $(".to").value = period.to
  $(".from").min = C.FIRST_DAY
  $(".to").min = C.FIRST_DAY

  function status(text, kind) {
    const node = $(".status")
    node.textContent = text || ""
    node.className = "status " + (kind === "ok" ? "ok" : kind === "warn" ? "warn" : "muted")
  }
  function notice(text) {
    const node = $(".notice")
    node.textContent = text || ""
    node.classList.toggle("hidden", !text)
  }

  let leaddriveReady = false
  async function refreshHeader() {
    const c = claims()
    const own = C.ownCompany(c)
    $(".portal").textContent = own ? say("portalCompany", { name: own.name, voen: own.voen }) : say("signInPortal")
    leaddriveReady = false
    const session = await chrome.runtime.sendMessage({ type: "ld-session" }).catch(() => null)
    if (session && session.ok && session.json && session.json.data) {
      const d = session.json.data
      $(".ld").textContent = say("leaddrive", { org: d.organization, user: d.user })
      if (!d.canImport) notice(say("noRights"))
      else notice("")
      leaddriveReady = Boolean(d.canImport)
    } else {
      $(".ld").textContent = say("signInLeadDrive")
      notice("")
    }
    startButton.disabled = running || !own || !leaddriveReady
    startButton.textContent = running ? say("stop") : say("start")
    if (running) startButton.disabled = false
  }

  function openPanel() {
    card.classList.remove("hidden")
    pill.classList.add("hidden")
    refreshHeader()
  }
  pill.addEventListener("click", openPanel)
  $(".close").addEventListener("click", () => {
    card.classList.add("hidden")
    pill.classList.remove("hidden")
  })
  $(".open-ld").addEventListener("click", () => chrome.runtime.sendMessage({ type: "ld-open-tab" }).catch(() => {}))

  async function start() {
    if (running) {
      stopRequested = true
      return
    }
    const from = $(".from").value
    const to = $(".to").value
    const today = C.ymd(new Date())
    if (!C.parseDay(from) || !C.parseDay(to) || from > to || from < C.FIRST_DAY || to > today) {
      status(say("badPeriod"), "warn")
      return
    }
    const directions = [$(".dir-inbox").checked ? "inbox" : null, $(".dir-outbox").checked ? "outbox" : null].filter(Boolean)
    if (!directions.length) return
    running = true
    stopRequested = false
    $(".result").classList.add("hidden")
    startButton.textContent = say("stop")
    startButton.disabled = false
    status(say("keepOpen"))
    try {
      const result = await run({ from, to }, directions)
      if (stopRequested) status(say("stopped"), "warn")
      else {
        status(say("done", { found: result.found, opened: result.opened, pdfs: result.pdfs }) +
          (result.errors ? " " + say("doneErrors", { count: result.errors }) : ""), result.errors ? "warn" : "ok")
      }
      $(".result").classList.remove("hidden")
    } catch (error) {
      status(error instanceof SessionExpired ? say("expired") : String(error && error.message || error), "warn")
    } finally {
      running = false
      stopRequested = false
      refreshHeader()
    }
  }
  startButton.addEventListener("click", start)

  // Shown only to a signed-in company: the portal keeps its pass from the sign-in on.
  let autoChecked = false
  async function watchSignIn() {
    const signedIn = Boolean(C.ownCompany(claims()))
    if (signedIn && !host.isConnected) document.documentElement.appendChild(host)
    if (!signedIn && host.isConnected && !running) host.remove()
    if (signedIn && !autoChecked) {
      autoChecked = true
      const answer = await chrome.runtime.sendMessage({ type: "take-auto-sync" }).catch(() => null)
      if (answer && answer.json && answer.json.autoSync) {
        openPanel()
        await refreshHeader()
        if (leaddriveReady) start()
      }
    }
  }
  setInterval(watchSignIn, 1000)
  watchSignIn()

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return
    if (message.type === "toggle-panel") {
      if (!host.isConnected) document.documentElement.appendChild(host)
      if (card.classList.contains("hidden")) openPanel()
      else $(".close").click()
    }
    if (message.type === "auto-sync") {
      autoChecked = false
      watchSignIn()
    }
  })
})()
