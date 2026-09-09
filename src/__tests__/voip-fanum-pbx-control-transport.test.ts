import { execFileSync } from "node:child_process"
import { createHash, X509Certificate } from "node:crypto"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import type { Server } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  FANUM_PBX_CONTROL_CA_PEM,
  FANUM_PBX_CONTROL_SERVERNAME,
} from "@/lib/voip/fanum-pbx-control-ca"
import { createPinnedHttpsFetch } from "@/lib/voip/fanum-pbx-control-transport"

const SOURCE_CA_PEM_SHA256 = "e9b00c72a527ae396f44756181f77561e765d2580bbc343da7760b2775a4cf34"
const SOURCE_CA_CERT_FINGERPRINT = "0F:FB:3A:17:6A:CA:71:70:24:A7:14:21:E2:FD:33:C4:E0:76:5C:AE:26:23:40:95:85:A8:61:67:7A:4C:43:D1"

type TestPki = {
  directory: string
  ca: string
  trustedCertificate: Buffer
  trustedKey: Buffer
  wrongHostnameCertificate: Buffer
  wrongHostnameKey: Buffer
}

function openssl(directory: string, args: string[]): void {
  execFileSync("openssl", args, {
    cwd: directory,
    stdio: ["ignore", "ignore", "pipe"],
  })
}

function makeCertificate(
  directory: string,
  prefix: string,
  commonName: string,
): void {
  openssl(directory, [
    "req", "-new", "-newkey", "rsa:2048", "-nodes",
    "-keyout", `${prefix}.key`,
    "-out", `${prefix}.csr`,
    "-subj", `/CN=${commonName}`,
  ])
  writeFileSync(
    join(directory, `${prefix}.ext`),
    `subjectAltName=DNS:${commonName}\nextendedKeyUsage=serverAuth\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  openssl(directory, [
    "x509", "-req",
    "-in", `${prefix}.csr`,
    "-CA", "ca.pem",
    "-CAkey", "ca.key",
    "-CAcreateserial",
    "-out", `${prefix}.pem`,
    "-days", "1",
    "-sha256",
    "-extfile", `${prefix}.ext`,
  ])
}

function makeTestPki(): TestPki {
  const directory = mkdtempSync(join(tmpdir(), "fanum-pbx-control-tls-"))
  openssl(directory, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", "ca.key",
    "-out", "ca.pem",
    "-days", "1",
    "-subj", "/CN=Fanum PBX transport fixture CA",
  ])
  makeCertificate(directory, "trusted", FANUM_PBX_CONTROL_SERVERNAME)
  makeCertificate(directory, "wrong-host", "wrong-pbx-control.internal")
  return {
    directory,
    ca: readFileSync(join(directory, "ca.pem"), "utf8"),
    trustedCertificate: readFileSync(join(directory, "trusted.pem")),
    trustedKey: readFileSync(join(directory, "trusted.key")),
    wrongHostnameCertificate: readFileSync(join(directory, "wrong-host.pem")),
    wrongHostnameKey: readFileSync(join(directory, "wrong-host.key")),
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Fixture did not bind TCP")
  return address.port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

describe("Fanum PBX public trust root", () => {
  it("is the exact reviewed public artifact and parses as the expected CA", () => {
    const reconstructedPem = FANUM_PBX_CONTROL_CA_PEM
    expect(createHash("sha256").update(reconstructedPem, "utf8").digest("hex"))
      .toBe(SOURCE_CA_PEM_SHA256)

    const certificate = new X509Certificate(reconstructedPem)
    expect(certificate.subject).toBe("CN=LeadDrive Private Voice Control CA")
    expect(certificate.issuer).toBe("CN=LeadDrive Private Voice Control CA")
    expect(certificate.subjectAltName).toBeUndefined()
    expect(Date.parse(certificate.validFrom)).toBe(Date.UTC(2026, 7, 10, 6, 22, 31))
    expect(Date.parse(certificate.validTo)).toBe(Date.UTC(2036, 7, 7, 6, 22, 31))
    expect(certificate.fingerprint256).toBe(SOURCE_CA_CERT_FINGERPRINT)
  })
})

describe("pinned Fanum PBX HTTPS transport", () => {
  let pki: TestPki

  beforeAll(() => {
    pki = makeTestPki()
  })

  afterAll(() => {
    rmSync(pki.directory, { force: true, recursive: true })
  })

  it("accepts the pinned CA and fixed SNI/SAN while connecting to an IP", async () => {
    let requestCount = 0
    let observedHost = ""
    const server = createHttpsServer({
      cert: pki.trustedCertificate,
      key: pki.trustedKey,
    }, (request, response) => {
      requestCount += 1
      observedHost = request.headers.host || ""
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end('{"ok":true}')
    })
    const port = await listen(server)
    try {
      const pinnedFetch = createPinnedHttpsFetch({
        caPem: pki.ca,
        servername: FANUM_PBX_CONTROL_SERVERNAME,
      })
      const response = await pinnedFetch(`https://127.0.0.1:${port}/ari/asterisk/info`, {
        redirect: "error",
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
      expect(requestCount).toBe(1)
      expect(observedHost).toBe(FANUM_PBX_CONTROL_SERVERNAME)
    } finally {
      await close(server)
    }
  })

  it("rejects a server certificate outside the pinned CA before HTTP handling", async () => {
    let requestCount = 0
    const server = createHttpsServer({
      cert: pki.trustedCertificate,
      key: pki.trustedKey,
    }, (_request, response) => {
      requestCount += 1
      response.end("unexpected")
    })
    const port = await listen(server)
    try {
      const pinnedFetch = createPinnedHttpsFetch({
        caPem: FANUM_PBX_CONTROL_CA_PEM,
        servername: FANUM_PBX_CONTROL_SERVERNAME,
      })
      await expect(pinnedFetch(`https://127.0.0.1:${port}/ari/asterisk/info`, {
        redirect: "error",
      })).rejects.toThrow()
      expect(requestCount).toBe(0)
    } finally {
      await close(server)
    }
  })

  it("rejects a trusted certificate with the wrong hostname before HTTP handling", async () => {
    let requestCount = 0
    const server = createHttpsServer({
      cert: pki.wrongHostnameCertificate,
      key: pki.wrongHostnameKey,
    }, (_request, response) => {
      requestCount += 1
      response.end("unexpected")
    })
    const port = await listen(server)
    try {
      const pinnedFetch = createPinnedHttpsFetch({
        caPem: pki.ca,
        servername: FANUM_PBX_CONTROL_SERVERNAME,
      })
      await expect(pinnedFetch(`https://127.0.0.1:${port}/ari/asterisk/info`, {
        redirect: "error",
      })).rejects.toThrow()
      expect(requestCount).toBe(0)
    } finally {
      await close(server)
    }
  })

  it("refuses plaintext and redirect-following inputs before any request", async () => {
    let requestCount = 0
    const server = createHttpServer((_request, response) => {
      requestCount += 1
      response.end("unexpected")
    })
    const port = await listen(server)
    try {
      const pinnedFetch = createPinnedHttpsFetch({
        caPem: pki.ca,
        servername: FANUM_PBX_CONTROL_SERVERNAME,
      })
      await expect(pinnedFetch(`http://127.0.0.1:${port}/ari/asterisk/info`, {
        redirect: "error",
      })).rejects.toThrow("requires HTTPS")
      await expect(pinnedFetch(`https://127.0.0.1:${port}/ari/asterisk/info`, {
        redirect: "follow",
      })).rejects.toThrow("forbids redirects")
      expect(requestCount).toBe(0)
    } finally {
      await close(server)
    }
  })
})
