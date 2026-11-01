/**
 * Защита от повторной публикации данных клиентов, проверенная на поведении.
 *
 * Прежняя защита спрашивала, откуда растёт ветка: `git merge-base
 * --is-ancestor 87ba5ae0 HEAD` должна была падать. 2026-11-01 выяснилось, что
 * это не то же самое, что «в ветке нет данных»: локальная
 * `feat/chat-voice-parity` со своим корнем `7f9a57e8` проверку проходила,
 * имея в дереве 74 файла из `migration_data/`, `scripts/v1-data/` и
 * `cost_model_migration_data/`.
 *
 * Поэтому тест не проверяет форму вызова. Он собирает настоящие репозитории и
 * доказывает поведение:
 *   - ветка с посторонним корнем: прежняя проверка её пропускает, новая — нет;
 *   - файл, добавленный одним коммитом и убранный следующим: в дифе к базе его
 *     не видно, в дереве вершины его нет, а в истории он есть и уедет на
 *     GitHub — проверка краснеет;
 *   - настоящий `git push` такой ветки в настоящий bare-ремоут отказывает
 *     хуком, и ссылка на ремоуте не сдвигается;
 *   - чистая ветка пушится, и похожие, но другие пути не блокируются.
 *
 * Скрипт и хук берутся из репозитория как файлы и копируются в тестовый
 * репозиторий по тем же относительным путям — проверяется та копия, которая
 * поедет в прод, а не её пересказ.
 */
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const ROOT = process.cwd()
const CHECKER = path.join("scripts", "ci", "check-forbidden-data-paths.sh")
const LIST = path.join("scripts", "ci", "forbidden-data-paths.txt")
const HOOK = path.join("scripts", "git-hooks", "pre-push")
const INSTALL = path.join("scripts", "git-hooks", "install.sh")

// Список из ~/.claude/CLAUDE.md, раздел про перезапись истории 2026-09-11.
// Дублируется здесь намеренно: тест, читающий ожидание из проверяемого файла,
// согласен сам с собой и не заметит, что из списка что-то вынули.
const EXPECTED_PATHS = [
  "scripts/v1-data",
  "migration_data",
  "cost_model_migration_data",
  "public/data/company_details.json",
  "public/data/pricing_data.json",
  "public/data/company_legal_names.json",
  "public/data/pricing_crm_mapping.json",
]

const GIT_ENV = {
  ...process.env,
  // Репозиторий владельца собственный core.hooksPath уже имеет; тестовые
  // репозитории не должны ни читать чужую настройку, ни зависеть от неё.
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
}

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV })
  return { status: run.status, out: `${run.stdout ?? ""}${run.stderr ?? ""}` }
}

function gitOk(cwd: string, ...args: string[]) {
  const run = git(cwd, ...args)
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${run.out}`)
  return run.out
}

/** Пустой репозиторий с копиями проверки и хука на их настоящих путях. */
function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "forbidden-paths-"))
  dirs.push(dir)
  gitOk(dir, "init", "-b", "main")
  for (const file of [CHECKER, LIST, HOOK, INSTALL]) {
    mkdirSync(path.join(dir, path.dirname(file)), { recursive: true })
    cpSync(path.join(ROOT, file), path.join(dir, file))
  }
  write(dir, "README.md", "temp repo\n")
  commit(dir, "base")
  return dir
}

function write(repo: string, file: string, body: string) {
  const full = path.join(repo, file)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, body)
}

function commit(repo: string, message: string) {
  gitOk(repo, "add", "-A")
  gitOk(repo, "-c", "commit.gpgsign=false", "commit", "-m", message)
  return gitOk(repo, "rev-parse", "HEAD").trim()
}

/** Запускает проверку так же, как её запускает CI. */
function check(repo: string, ...args: string[]) {
  const run = spawnSync("bash", [path.join(repo, CHECKER), ...args], {
    cwd: repo,
    encoding: "utf8",
    env: GIT_ENV,
  })
  return { status: run.status, out: `${run.stdout ?? ""}${run.stderr ?? ""}` }
}

describe("forbidden-data-paths: список", () => {
  it("содержит ровно те пути, что вычистили из истории 2026-09-11", () => {
    const listed = check(ROOT, "--list")
    expect(listed.status).toBe(0)
    expect(listed.out.trim().split("\n")).toEqual(EXPECTED_PATHS)
  })

  it("читается и скриптом, и хуком — второго списка нет", () => {
    const hook = readFileSync(path.join(ROOT, HOOK), "utf8")
    expect(hook).toContain("check-forbidden-data-paths.sh")
    for (const forbidden of EXPECTED_PATHS) {
      expect(hook).not.toContain(forbidden)
    }
  })
})

describe("forbidden-data-paths: дерево", () => {
  it("чистая ветка проходит", () => {
    const repo = makeRepo()
    write(repo, "src/app.ts", "export const a = 1\n")
    commit(repo, "work")
    const run = check(repo, "HEAD", "--history", "HEAD")
    expect(run.status).toBe(0)
    expect(run.out).toContain("чисто")
  })

  it("краснеет на файле в вершине ветки и называет его", () => {
    const repo = makeRepo()
    write(repo, "migration_data/companies_db.json", '{"company":"ACME"}\n')
    commit(repo, "oops")
    const run = check(repo, "HEAD")
    expect(run.status).toBe(1)
    expect(run.out).toContain("migration_data/companies_db.json")
  })

  it.each(EXPECTED_PATHS)("ловит файл по пути %s", (forbidden) => {
    const repo = makeRepo()
    const file = forbidden.endsWith(".json") ? forbidden : `${forbidden}/leak.json`
    write(repo, file, '{"client":"данные"}\n')
    commit(repo, "oops")
    const run = check(repo, "HEAD")
    expect(run.status).toBe(1)
    expect(run.out).toContain(file)
  })

  it("не блокирует похожие, но другие пути", () => {
    const repo = makeRepo()
    write(repo, "public/data/az-regions.json", "[]\n")
    write(repo, "src/lib/migration_data.ts", "export const x = 1\n")
    write(repo, "docs/migration_data-notes.md", "заметки\n")
    write(repo, "scripts/v1-data-export.ts", "export const y = 2\n")
    commit(repo, "work")
    const run = check(repo, "HEAD", "--history", "HEAD")
    expect(run.status).toBe(0)
  })
})

describe("forbidden-data-paths: история, которой нет в дифе", () => {
  it("краснеет на коммите, добавившем файл, даже если следующий его убрал", () => {
    const repo = makeRepo()
    const base = gitOk(repo, "rev-parse", "HEAD").trim()
    gitOk(repo, "checkout", "-b", "sneaky")
    write(repo, "scripts/v1-data/clients.json", '{"client":"ACME"}\n')
    const added = commit(repo, "add data")
    rmSync(path.join(repo, "scripts/v1-data/clients.json"))
    const head = commit(repo, "remove data again")

    // Премисса теста: ни диф к базе, ни дерево вершины этого файла не видят.
    expect(gitOk(repo, "diff", "--name-only", `${base}...${head}`).trim()).toBe("")
    expect(gitOk(repo, "ls-tree", "-r", "--name-only", head).includes("scripts/v1-data")).toBe(false)
    // А в истории он есть, и пуш опубликует именно её.
    expect(gitOk(repo, "ls-tree", "-r", "--name-only", added)).toContain("scripts/v1-data/clients.json")

    const run = check(repo, "HEAD", "--history", `${base}..${head}`)
    expect(run.status).toBe(1)
    expect(run.out).toContain("scripts/v1-data/clients.json")
    expect(run.out).toContain(added)
  })
})

describe("forbidden-data-paths: ветка с посторонним корнем", () => {
  it("проходит прежнюю проверку по предку и краснеет на новой", () => {
    const repo = makeRepo()
    const oldRoot = gitOk(repo, "rev-parse", "HEAD").trim()

    // Третий корень: ни старый, ни новый — ровно случай feat/chat-voice-parity.
    gitOk(repo, "checkout", "--orphan", "rogue")
    gitOk(repo, "rm", "-rf", "--cached", ".")
    write(repo, "README.md", "rogue root\n")
    write(repo, "migration_data/company_legal_names.json", '{"legal":"ACME LLC"}\n')
    const rogue = commit(repo, "rogue root with client data")

    expect(gitOk(repo, "rev-list", "--max-parents=0", rogue).trim()).toBe(rogue)
    expect(git(repo, "merge-base", oldRoot, rogue).status).not.toBe(0)
    // Прежняя защита: `--is-ancestor` возвращает 1, то есть «не потомок
    // старого корня, пушить можно». Именно эта дыра и закрывается.
    expect(git(repo, "merge-base", "--is-ancestor", oldRoot, rogue).status).toBe(1)

    const tree = check(repo, "HEAD")
    expect(tree.status).toBe(1)
    expect(tree.out).toContain("migration_data/company_legal_names.json")

    // И так же — когда такую ветку сравнивают с базой диапазоном.
    const range = check(repo, "HEAD", "--history", `${oldRoot}..${rogue}`)
    expect(range.status).toBe(1)
  })
})

describe("forbidden-data-paths: pre-push hook", () => {
  /** Ремоут и установленные хуки, как после install.sh в свежем клоне. */
  function withRemote(repo: string) {
    const remote = mkdtempSync(path.join(tmpdir(), "forbidden-paths-remote-"))
    dirs.push(remote)
    gitOk(remote, "init", "--bare", "-b", "main")
    gitOk(repo, "remote", "add", "origin", remote)
    const install = spawnSync("bash", [path.join(repo, INSTALL)], { cwd: repo, encoding: "utf8", env: GIT_ENV })
    if (install.status !== 0) throw new Error(`install.sh failed:\n${install.stdout}${install.stderr}`)
    // Хук ставится копией по абсолютному пути: относительный core.hooksPath
    // исчез бы в чекауте, чья ветка старше хука, — а это и есть опасный случай.
    const hooksPath = gitOk(repo, "config", "--get", "core.hooksPath").trim()
    expect(path.isAbsolute(hooksPath)).toBe(true)
    expect(readFileSync(path.join(hooksPath, "pre-push"), "utf8")).toBe(readFileSync(path.join(repo, HOOK), "utf8"))
    return remote
  }

  it("отказывает в настоящем пуше и не двигает ссылку на ремоуте", () => {
    const repo = makeRepo()
    const remote = withRemote(repo)

    write(repo, "cost_model_migration_data/client_companies.json", '{"client":"ACME"}\n')
    commit(repo, "oops")

    const refused = git(repo, "push", "origin", "main")
    expect(refused.status).not.toBe(0)
    expect(refused.out).toContain("cost_model_migration_data/client_companies.json")
    expect(gitOk(remote, "for-each-ref").trim()).toBe("")

    // Убрать файл из вершины недостаточно: коммит с ним всё ещё уехал бы.
    rmSync(path.join(repo, "cost_model_migration_data/client_companies.json"))
    commit(repo, "remove it")
    const stillRefused = git(repo, "push", "origin", "main")
    expect(stillRefused.status).not.toBe(0)
    expect(gitOk(remote, "for-each-ref").trim()).toBe("")

    // Чистая история пушится.
    gitOk(repo, "checkout", "-b", "clean", gitOk(repo, "rev-parse", "HEAD~2").trim())
    write(repo, "src/app.ts", "export const a = 1\n")
    commit(repo, "clean work")
    const allowed = git(repo, "push", "origin", "clean")
    expect(allowed.status).toBe(0)
    expect(gitOk(remote, "for-each-ref", "--format=%(refname)").trim()).toBe("refs/heads/clean")
  }, 60_000)

  it("отказывает и в ветке старше самой проверки — берёт её из origin/main", () => {
    // Ровно случай feat/chat-voice-parity: посторонний корень, в дереве нет ни
    // scripts/ci/check-forbidden-data-paths.sh, ни хука, зато есть данные.
    const repo = makeRepo()
    const remote = withRemote(repo)
    expect(git(repo, "push", "origin", "main").status).toBe(0)

    gitOk(repo, "checkout", "--orphan", "rogue")
    gitOk(repo, "rm", "-rf", "--cached", ".")
    rmSync(path.join(repo, "scripts"), { recursive: true, force: true })
    write(repo, "README.md", "rogue root\n")
    write(repo, "migration_data/companies_db.json", '{"company":"ACME"}\n')
    commit(repo, "rogue root with client data")
    expect(gitOk(repo, "ls-tree", "-r", "--name-only", "HEAD")).not.toContain("check-forbidden-data-paths")

    const refused = git(repo, "push", "origin", "rogue")
    expect(refused.status).not.toBe(0)
    expect(refused.out).toContain("взял её из origin/main")
    expect(refused.out).toContain("migration_data/companies_db.json")
    expect(gitOk(remote, "for-each-ref", "--format=%(refname)").trim()).toBe("refs/heads/main")
  }, 60_000)

  it("останавливает пуш, если проверки нет ни в дереве, ни в origin/main (fail closed)", () => {
    const repo = makeRepo()
    const remote = withRemote(repo)

    rmSync(path.join(repo, CHECKER))
    commit(repo, "checkout without the checker")

    const refused = git(repo, "push", "origin", "main")
    expect(refused.status).not.toBe(0)
    expect(refused.out).toContain("проверка запрещённых путей не выполнена")
    expect(gitOk(remote, "for-each-ref").trim()).toBe("")
  }, 60_000)

  it("не мешает удалению ветки на ремоуте", () => {
    const repo = makeRepo()
    const remote = withRemote(repo)

    // Не `main`: git сам отказывается удалять текущую ветку bare-ремоута, и
    // это не про хук.
    gitOk(repo, "checkout", "-b", "topic")
    expect(git(repo, "push", "origin", "topic").status).toBe(0)
    const deleted = git(repo, "push", "origin", "--delete", "topic")
    expect(deleted.status).toBe(0)
    // Удаление ничего не публикует, поэтому проверка по нему и не запускается.
    expect(deleted.out).not.toContain("проверяю")
    expect(gitOk(remote, "for-each-ref", "--format=%(refname)").trim()).toBe("")
  }, 60_000)

  it("install.sh не затирает чужой core.hooksPath без --force", () => {
    const repo = makeRepo()
    gitOk(repo, "config", "core.hooksPath", "/nowhere/hooks")
    const refused = spawnSync("bash", [path.join(repo, INSTALL)], { cwd: repo, encoding: "utf8", env: GIT_ENV })
    expect(refused.status).not.toBe(0)
    expect(`${refused.stdout}${refused.stderr}`).toContain("--force")
    expect(gitOk(repo, "config", "--get", "core.hooksPath").trim()).toBe("/nowhere/hooks")

    const forced = spawnSync("bash", [path.join(repo, INSTALL), "--force"], { cwd: repo, encoding: "utf8", env: GIT_ENV })
    expect(forced.status).toBe(0)
    expect(gitOk(repo, "config", "--get", "core.hooksPath").trim()).toContain("hooks-leaddrive")
  })
})

describe("forbidden-data-paths: гейт в CI", () => {
  it("живёт в уже обязательной джобе scan, без path-фильтра", () => {
    const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "gitleaks.yml"), "utf8")
    expect(workflow).toContain("check-forbidden-data-paths.sh")
    // Обязательный контекст обязан приходить на КАЖДОМ PR: path-фильтр повесил
    // бы PR вне своих путей на «Expected — waiting for status» навсегда.
    const pullRequestTrigger = workflow.slice(workflow.indexOf("pull_request:"), workflow.indexOf("permissions:"))
    expect(pullRequestTrigger).not.toContain("paths:")
  })

  it("проверяет и дерево, и историю PR", () => {
    const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "gitleaks.yml"), "utf8")
    expect(workflow).toContain('check-forbidden-data-paths.sh HEAD --history "$BASE_SHA..$HEAD_SHA"')
  })
})
