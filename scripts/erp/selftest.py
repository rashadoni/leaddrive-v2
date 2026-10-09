#!/usr/bin/env python3
"""selftest — самопроверка команд на маленьком выдуманном реестре во временной папке.

Настоящие registry.json, order.json и репозиторий не трогает; GitHub не спрашивает (вместо
команды gh — подставная, она отдаёт заготовленные «прогоны»). Проверяет главное: карточку
нельзя взять не по порядку и по отставшему дереву; правило нельзя отметить без теста со
статусом passed в отчёте прогона GitHub (набранный руками файл, пропущенный, выключенный,
закомментированный тест, *.spec.ts и номер в имени файла не проходят); «досмотреть» нельзя
отметить; изменённый текст сбрасывает отметку; ворота не закрываются без дословных слов
владельца, закрытие ворот вместе с другой работой — красное, запись о воротах из main
нельзя стереть или изменить; ветка, уже влитая в main, карточку не держит; записка не
теряется; изменённый документ останавливает работу — и то, что вокруг.

  python3 selftest.py [-v]      -v печатает вывод каждой команды
Код возврата 0 — все проверки прошли. Только стандартная библиотека.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import erp_lib as L  # noqa: E402

VERBOSE = "-v" in sys.argv
TODAY = "2026-10-09"
results = []
SHA0 = "0" * 40
FAKE_GH = """#!/usr/bin/env python3
import os, shutil, sys
runs, a = os.environ["FAKE_GH_RUNS"], sys.argv[1:]
if a[:2] == ["run", "view"]:
    p = os.path.join(runs, a[2], "view.json")
    if not os.path.exists(p):
        sys.stderr.write("run not found"); sys.exit(1)
    sys.stdout.write(open(p, encoding="utf-8").read()); sys.exit(0)
if a[:2] == ["run", "download"]:
    src = os.path.join(runs, a[2], a[a.index("-n") + 1] + ".json")
    if not os.path.exists(src):
        sys.stderr.write("no artifact"); sys.exit(1)
    shutil.copy(src, a[a.index("-D") + 1]); sys.exit(0)
sys.exit(2)
"""
WORKFLOW_OK = """jobs:
  pr-scope:
    steps:
      - run: python3 scripts/erp/check_progress.py --branch "$GITHUB_HEAD_REF" --base-ref "$BASE_SHA" --repo "$GITHUB_WORKSPACE"
  static-checks:
    steps:
      - run: npx vitest run src/__tests__/erp- --reporter=json --outputFile=erp-tests.json --passWithNoTests
        env:
          ERP_TEST_DATABASE_URL: postgresql://x
      - run: |
          python3 scripts/erp/ci_report.py erp-tests.json
          python3 scripts/erp/check_progress.py --tests-report erp-tests.json --branch "$GITHUB_HEAD_REF" --repo "$GITHUB_WORKSPACE"
      - uses: actions/upload-artifact@v4
        with:
          name: erp-tests
          path: erp-tests.json
"""


def sha(t):
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def check(name, cond, out=""):
    results.append((name, bool(cond)))
    print(f"{'ok  ' if cond else 'FAIL'} {len(results):>3}. {name}")
    if not cond and out:
        print("       вывод: " + out.strip().replace("\n", "\n       ")[:1800])


def git_at(path, *args):
    r = subprocess.run(["git", "-c", "user.name=selftest", "-c", "user.email=selftest@example.invalid",
                        "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", *args],
                       cwd=str(path), capture_output=True, text=True)
    return r.returncode == 0


class Box:
    """Временная «закрытая папка» (свой git, как настоящая) и «репозиторий» с тестами."""

    def __init__(self, root: Path):
        self.root = root
        self.home = root / "home"                    # корень закрытой папки, под своим git
        self.dir = self.home / "reports" / "exec"
        self.repo = root / "repo"
        self.runs = root / "runs"
        (self.dir / "rules_text").mkdir(parents=True)
        (self.dir / "cards").mkdir()
        (self.repo / "src" / "__tests__").mkdir(parents=True)
        (root / "bin").mkdir()
        self.runs.mkdir()
        gh = root / "bin" / "gh"
        gh.write_text(FAKE_GH, encoding="utf-8")
        gh.chmod(0o755)
        git_at(self.home, "init", "-q")
        self._run = 1000

    def git(self, *args):
        return git_at(self.repo, *args)

    def run(self, tool, *args, branch=None, dir=None, extra=(), git=False, repo=None, env=None,
            private=None):
        d = Path(dir or self.dir)
        e = dict(os.environ, ERP_TODAY=TODAY, PYTHONDONTWRITEBYTECODE="1",
                 FAKE_GH_RUNS=str(self.runs),
                 PATH=str(self.root / "bin") + os.pathsep + os.environ.get("PATH", ""))
        for k in ("ERP_DIR", "ERP_PRIVATE", "ERP_REPO", "ERP_BRANCH", "GITHUB_HEAD_REF",
                  "GITHUB_ACTIONS", "HEAD_SHA", "GITHUB_SHA", "GITHUB_WORKSPACE"):
            e.pop(k, None)
        # закрытая папка задаётся явно: настоящая (~/projects/erp-private) сюда попасть не должна
        e["ERP_PRIVATE"] = str(private or (d if L.is_private(d) else self.root / "no-private"))
        if branch:
            e["ERP_BRANCH"] = branch
        e.update(env or {})
        cmd = [sys.executable, str(TOOLS / tool), "--dir", str(d),
               "--repo", str(repo or self.repo), *(() if git else ("--no-git",)), *extra, *args]
        r = subprocess.run(cmd, capture_output=True, text=True, env=e)
        out = r.stdout + r.stderr
        if VERBOSE:
            print(f"   $ {tool} {' '.join(args)}  -> {r.returncode}\n      "
                  + out.strip().replace("\n", "\n      "))
        return r.returncode, out

    def ci(self, branch, green=(), red=(), skip=(), head=SHA0, stamp=True, artifact=True):
        """Заготовленный «прогон GitHub»: возвращает его номер."""
        self._run += 1
        rid = str(self._run)
        folder = self.runs / rid
        folder.mkdir()
        (folder / "view.json").write_text(json.dumps(
            {"headSha": head, "headBranch": branch, "event": "pull_request",
             "workflowName": "PR checks", "status": "completed"}), encoding="utf-8")
        cases = [{"fullName": "erp " + n, "status": st}
                 for st, names in (("passed", green), ("failed", red), ("skipped", skip))
                 for n in names]
        data = {"testResults": [{"name": "/x/src/__tests__/erp-all.test.ts",
                                 "assertionResults": cases}]}
        if stamp:
            data["erp"] = {"head_sha": head, "run_id": rid, "branch": branch, "db": True}
        if artifact:
            (folder / "erp-tests.json").write_text(json.dumps(data, ensure_ascii=False),
                                                   encoding="utf-8")
        return rid

    def report(self, name, green=(), red=(), skip=(), head=SHA0, stamp=True):
        """Файл отчёта — как его видит check_progress.py в шаге GitHub."""
        rid = self.ci("-", green, red, skip, head, stamp)
        dst = self.root / name
        shutil.copy(self.runs / rid / "erp-tests.json", dst)
        return str(dst)

    def reg(self, dir=None):
        return json.loads(((dir or self.dir) / "registry.json").read_text(encoding="utf-8"))

    def rule(self, slug, dir=None):
        return next(r for r in self.reg(dir)["rules"] if r["slug"] == slug)

    def edit_reg(self, fn, dir=None):
        path = (dir or self.dir) / "registry.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        fn({r["slug"]: r for r in data["rules"]}, data)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    def prog(self, dir=None):
        out = {"cards": {}, "gates": {}}
        for p in ((dir or self.dir) / "progress").glob("*.json"):
            d = json.loads(p.read_text(encoding="utf-8"))
            out["gates" if d["kind"] == "gate" else "cards"][d["key"]] = d["state"]
        return out

    def edit_prog(self, key, fn, dir=None):
        path = (dir or self.dir) / "progress" / f"{key}.json"
        d = json.loads(path.read_text(encoding="utf-8"))
        fn(d["state"])
        path.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")

    def text(self, slug, rid, body, mark):
        line = f"| {rid} | {body} | {mark} |"
        (self.dir / "rules_text" / f"{slug}.md").write_text(
            f"# {rid}\n\n<!-- rule-text-begin -->\n| № | Правило | Пометка |\n|---|---|---|\n"
            f"{line}\n<!-- rule-text-end -->\n", encoding="utf-8")
        return sha(line)

    def tests(self, name, lines, repo=None):
        ((repo or self.repo) / "src" / "__tests__" / name).write_text(
            'import { describe, it } from "vitest"\ndescribe("erp", () => {\n'
            + "\n".join("  " + ln for ln in lines) + "\n})\n", encoding="utf-8")

    def copy(self, name):
        dst = self.root / name
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(self.dir, dst)
        return dst

    def private_commits(self):
        r = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=str(self.home),
                           capture_output=True, text=True)
        return int(r.stdout.strip() or 0) if r.returncode == 0 else 0


RULES = [  # id, slug, mark, slice, текст, оговорка «до просмотра», ждёт
    ("А-01", "u1-A-01", "as_1c", 0, "Меню настроек учёта состоит из пяти пунктов", False, []),
    ("А-02", "u1-A-02", "as_1c", 0, "Настройка идёт в порядке: организация, политика, счета", False, []),
    ("А-03", "u1-A-03", "to_look", 0, "Смена настройки задним числом. До просмотра не кодируется: форма истории не строится", True, []),
    ("А-04", "u1-A-04", "to_look", 0, "Раздельные флажки НДС. До просмотра: отказ с сообщением", True, []),
    ("А-05", "u1-A-05", "as_1c", 0, "Сообщение при смене настройки — как покажет А-03", False, ["А-03"]),
    ("B-1.1", "u2-B-1.1", "as_1c", 0, "Приход на склад пишет количество и сумму", False, []),
    ("B-1.10", "u2-B-1.10", "addition", 0, "Отказ при отрицательном остатке", False, []),
    ("Д-01", "u3-D-01", "as_1c", 1, "Оплата долга: Дт 223 Кт 211", False, []),
    ("Д-02", "u3-D-02", "as_1c", 1, "НДС с оплаты: Дт 217 Кт 521", False, []),
    ("Д-03", "u3-D-03", "as_1c", 1, "Закрытие месяца", False, []),
    ("Д-04", "u3-D-04", "as_1c", 1, "Акт сверки", False, []),
    ("D-9.9", "u4-D-9.9", "as_1c", "later", "Правило не первой версии", False, []),
]
MARK_RU = {"as_1c": "как в 1С", "addition": "добавление", "to_look": "досмотреть"}


def build(box: Box, rule_rows=None, with_order=True):
    rules = []
    for rid, slug, mark, sl, body, pre, blocked in (rule_rows or RULES):
        h = box.text(slug, rid, body, MARK_RU[mark])
        rules.append({"id": rid, "slug": slug, "title": body[:40], "mark": mark, "slice": sl,
                      "pre_look_behavior": pre, "blocked_by": blocked, "text_hash": h,
                      "status": "blocked_to_look" if mark == "to_look" else "not_started",
                      "source": "закрытое поле: заметка 26 §2", "section": "Участок 1",
                      "text_file": f"reports/exec/rules_text/{slug}.md"})
    (box.dir / "registry.json").write_text(
        json.dumps({"meta": {"schema": 1}, "rules": rules, "unnumbered_blocks": []},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    if not with_order:
        return
    (box.dir / "cards" / "1-setup.md").write_text(
        "# Карточка 1. Настройки\n\n## Правила\n\nдословный текст правил — закрытая часть\n\n"
        "## Шаги\n\n- [ ] 1. Таблица настроек и миграция\n- [ ] 2. Экран настроек\n\n"
        "## Критерий готовности\n\n- [ ] эта галочка — не шаг\n", encoding="utf-8")
    order = {"cards": [
        {"number": 1, "slice": 0, "slug": "setup", "title": "Настройки организации", "kind": "work",
         "rules": ["А-01", "А-02", "А-03", "А-04", "А-05"], "after": [], "parallel_ok": False,
         "detail": "cards/1-setup.md", "lishnee_pole": {"x": [1, 2, 3]}},
        {"number": 2, "slice": 0, "slug": "stock", "title": "Приход на склад", "kind": "work",
         "rules": ["u2-B-1.1", {"slug": "u2-B-1.10"}], "after": [1], "parallel_ok": False,
         "detail": {"steps": ["Документ прихода"], "text": "длинный закрытый текст карточки " * 20}},
        {"number": 3, "slice": 0, "slug": "accept-0", "kind": "gate", "rules": [], "after": [1, 2],
         "title": "Приёмка среза 0: клиент и «давай» владельца", "detail": None},
        {"number": 4, "slice": 1, "slug": "money", "title": "Оплата долга", "kind": "work",
         "rules": ["Д-01"], "after": [3], "parallel_ok": True, "detail": {"steps": ["Проводки"]}},
        {"number": 5, "slice": 1, "slug": "vat", "title": "НДС с оплаты", "kind": "work",
         "rules": ["Д-02"], "after": [3], "parallel_ok": False, "detail": {"steps": ["Проводки"]}},
        {"number": 6, "slice": 1, "slug": "close", "title": "Закрытие месяца", "kind": "work",
         "rules": ["Д-03"], "after": [4, 5], "parallel_ok": True, "detail": {"steps": ["Закрытие"]}},
        {"number": 7, "slice": 1, "slug": "recon", "title": "Акт сверки", "kind": "work",
         "rules": ["Д-04"], "after": [3], "parallel_ok": False, "detail": {"steps": ["Акт"]}},
    ], "generated_by": "selftest"}
    (box.dir / "order.json").write_text(json.dumps(order, ensure_ascii=False, indent=1),
                                        encoding="utf-8")
    box.tests("erp-setup.test.ts", [
        'it("u1-A-01: меню настроек из пяти пунктов", () => {})',
        'it.skip("u1-A-02: порядок настройки", () => {})',
        'it("u1-A-03: форма истории", () => {})',
        'it("u1-A-04#pre: отказ с сообщением", () => {})',
        'it("u1-A-05: сообщение при смене", () => {})',
    ])
    box.tests("erp-stock.test.ts", ['it("u2-B-1.10: отказ при отрицательном остатке", () => {})'])
    box.tests("erp-money.test.ts", [
        'it("u3-D-01: оплата долга", () => {})', 'it("u3-D-02: НДС с оплаты", () => {})',
        'it("u3-D-03: закрытие месяца", () => {})', 'it("u3-D-04: акт сверки", () => {})'])


A01, A02, A03 = "u1-A-01: меню настроек из пяти пунктов", "u1-A-02: порядок настройки", "u1-A-03: форма истории"
A04P, A05 = "u1-A-04#pre: отказ с сообщением", "u1-A-05: сообщение при смене"
B10, B11 = "u2-B-1.10: отказ при отрицательном остатке", "u2-B-1.1: приход пишет количество и сумму"
D01, D02 = "u3-D-01: оплата долга", "u3-D-02: НДС с оплаты"
ALL = [A01, A02, A03, A04P, A05, B10, D01, D02]
SETUP_ON = [f'it("{A01}", () => {{}})', f'it("{A02}", () => {{}})', f'it("{A03}", () => {{}})',
            f'it("{A04P}", () => {{}})', f'it("{A05}", () => {{}})']


def scenario(box: Box):
    run = box.run
    b1 = "erp/1-setup"
    green_all = box.ci(b1, green=ALL)
    skipped = box.ci(b1, green=[A01], skip=[A02])
    red = box.ci(b1, green=[A02], red=[A01])

    # --- порядок
    rc, out = run("next_card.py")
    check("next_card выдаёт одну карточку — первую (1), с шагами из файла карточки",
          rc == 0 and out.count("КАРТОЧКА ") == 1 and "КАРТОЧКА 1 " in out
          and "1. Таблица настроек" in out and "не шаг" not in out, out)
    rc, out = run("next_card.py", "--take", "erp/2-stock")
    check("нельзя взять карточку не по порядку (2 раньше 1)",
          rc == 1 and "не по порядку" in out and not box.prog()["cards"].get("2", {}).get("taken_by"), out)
    rc, out = run("next_card.py", "--take", "erp/9-nothing")
    check("нельзя взять карточку с выдуманной веткой", rc == 1 and "не соответствует" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", green_all)
    check("нельзя отметить правило, пока карточка не взята", rc == 1 and "не взята" in out, out)
    rc, out = run("next_card.py", "--busy", b1)
    check("ветка erp/1-setup уже есть в git — карточка занята, другую не выдают",
          rc == 3 and "КАРТОЧКИ НЕТ" in out, out)
    rc, out = run("next_card.py", "--take", b1, branch="claude/other", extra=("--busy", b1))
    check("нельзя взять карточку, чья ветка уже создана другой сессией",
          rc == 1 and "уже существует" in out, out)
    if shutil.which("git") and box.git("init", "-q") and box.git("commit", "-q", "--allow-empty", "-m", "init"):
        box.git("branch", b1)
        rc, out = run("next_card.py", git=True)
        box.git("checkout", "-q", "-b", "erp/2-stock")
        rc2, out2 = run("next_card.py", "--take", b1, git=True)
        box.git("checkout", "-q", "-")
        rc4, out4 = run("next_card.py", "--take", b1, git=True)
        box.git("branch", "-D", b1, "erp/2-stock")
        rc3, out3 = run("next_card.py", git=True)
        check("настоящий git: ветка erp/1-setup есть — карточка занята; из ветки erp/2-… чужую "
              "не взять; не из ветки карточки её не взять; ветку удалили — карточка свободна",
              rc == 3 and rc2 == 1 and "ты в ветке" in out2 and rc4 == 1
              and "берётся из её ветки" in out4 and rc3 == 0 and "свободна" in out3,
              out + out2 + out4 + out3)
    else:
        check("настоящий git недоступен — проверка веток через git НЕ ВЫПОЛНЕНА", False)

    # --- закрытая папка: одна, под своим git, вне рабочей копии
    rc, out = run("next_card.py", private=box.root / "nowhere")
    check("без закрытой папки (rules_text/ и cards/) карточка не выдаётся",
          rc == 1 and "нет закрытой папки" in out, out)
    inside = box.repo / "reports" / "exec"
    shutil.copytree(box.dir, inside)
    rc, out = run("next_card.py", "--take", b1, dir=inside)
    rc2, out2 = run("next_card.py", dir=inside)
    check("закрытая папка внутри рабочей копии: взять карточку нельзя (записку увидела бы "
          "только эта сессия), показ — с предупреждением",
          rc == 1 and "внутри рабочей копии" in out and rc2 == 0 and "ВНИМАНИЕ" in out2
          and not (inside / "progress").exists(), out + out2)
    shutil.rmtree(inside)

    rc, out = run("next_card.py", "--take", b1)
    check("карточка 1 берётся веткой erp/1-setup",
          rc == 0 and box.prog()["cards"]["1"]["taken_by"] == b1, out)
    rc, out = run("next_card.py", branch=b1)
    check("та же ветка снова получает свою карточку (продолжение)",
          rc == 0 and "КАРТОЧКА 1 " in out and "продолжение" in out, out)
    rc, out = run("next_card.py", branch="claude/other")
    check("вторая сессия карточку не получает: 1 занята, 2 идёт после неё", rc == 3, out)

    # --- шаги
    rc, out = run("mark.py", "step", "1", "2")
    check("шаги только по порядку: шаг 2 раньше шага 1 — отказ", rc == 1 and "по порядку" in out, out)
    rc1, _ = run("mark.py", "step", "1", "1")
    rc2, out = run("mark.py", "step", "1", "2")
    rc3, out3 = run("mark.py", "step", "1", "3")
    check("шаги 1 и 2 отмечаются, шага 3 нет", rc1 == 0 and rc2 == 0 and rc3 == 1
          and box.prog()["cards"]["1"]["steps_done"] == [1, 2], out + out3)

    # --- «сделано» только по отчёту прогона GitHub
    rc, out = run("mark.py", "rule", "u1-A-01")
    check("нельзя отметить правило без номера прогона GitHub",
          rc == 1 and box.rule("u1-A-01")["status"] != "done", out)
    hand = box.root / "hand.json"
    hand.write_text(json.dumps({"tests": [{"name": A01, "status": "passed"}],
                                "testResults": [{"name": "erp-x.test.ts", "assertionResults": [
                                    {"fullName": A01, "status": "passed"}]}]}), encoding="utf-8")
    rc, out = run("mark.py", "rule", "u1-A-01", "--tests", str(hand))
    rc2, out2 = run("mark.py", "rule", "u1-A-01", "--run", str(hand))
    check("файл итогов, набранный руками, подать некуда: ключа --tests нет, --run — только номер",
          rc != 0 and rc2 == 1 and "номер прогона" in out2
          and box.rule("u1-A-01")["status"] != "done", out + out2)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", "999999")
    check("несуществующий прогон отметку не даёт", rc == 1 and "не найден" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", box.ci("erp/2-stock", green=ALL))
    check("прогон чужой ветки отметку не даёт", rc == 1 and "чужой прогон" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", box.ci(b1, green=ALL, stamp=False))
    check("отчёт без пометки шага GitHub (ci_report.py) не принимается",
          rc == 1 and "не помечен" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", box.ci(b1, green=ALL, artifact=False))
    check("прогон без отчёта erp-tests (черновик PR, шаг не дошёл) отметку не даёт",
          rc == 1 and "нет отчёта" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", box.ci(b1, green=[A02]))
    check("нельзя отметить правило, если зелёный тест — с чужим номером",
          rc == 1 and "нет зелёного теста" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", red)
    check("нельзя отметить правило, если тест с его номером красный",
          rc == 1 and "красный" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-02", "--run", green_all)
    check("it.skip в дереве тестов не считается: зелёная строка в отчёте не помогает",
          rc == 1 and "нет включённого теста" in out, out)
    # обходы из проверки схемы: каждый оставлял отметку «сделано» без выполненного теста
    tdir = box.repo / "src" / "__tests__"
    keep_setup = (tdir / "erp-setup.test.ts").read_text(encoding="utf-8")

    def tree(body, name="erp-setup.test.ts"):
        (tdir / "erp-setup.test.ts").write_text(
            'import { describe, it } from "vitest"\n' + (body if name == "erp-setup.test.ts" else ""),
            encoding="utf-8")
        if name != "erp-setup.test.ts":
            (tdir / name).write_text('import { describe, it } from "vitest"\n' + body, encoding="utf-8")
        rc_, out_ = run("mark.py", "rule", "u1-A-01", "--run", green_all)
        if name != "erp-setup.test.ts":
            (tdir / name).unlink()
        return rc_ == 1 and "нет включённого теста" in out_ and box.rule("u1-A-01")["status"] != "done", out_

    ok, out = tree(f'describe.skip("выключенный блок", () => {{\n  it("{A01}", () => {{}})\n}})\n')
    check("обход (а): тест внутри describe.skip включённым не считается", ok, out)
    ok, out = tree(f'xdescribe("блок", () => {{\n  describe("внутри", () => {{\n    it("{A01}", () => {{}})\n  }})\n}})\n')
    check("обход (а): выключен внешний блок (xdescribe) — вложенный тест не считается", ok, out)
    ok, out = tree(f'describe("erp", () => {{\n  it("{A01}", () => {{}})\n}})\n', name="erp-org2.spec.ts")
    check("обход (б): файл *.spec.ts vitest не запускает — тест в нём не считается", ok, out)
    ok, out = tree('describe("erp", () => {\n  it("что-то постороннее", () => {})\n})\n',
                   name="erp-u1-A-01.test.ts")
    check("обход (в): номер правила только в имени файла доказательством не считается", ok, out)
    ok, out = tree(f'describe("erp", () => {{\n  // it("{A01}", () => {{}})\n  /* it("{A01}", () => {{}}) */\n'
                   f'  it("другое", () => {{}})\n}})\n')
    check("закомментированный тест включённым не считается", ok, out)
    ok, out = tree(f'describe("erp", () => {{\n  it("{A01}", () => {{}})\n}})\n', name="other-setup.test.ts")
    check("тест правила вне файлов erp-*.test.ts не считается: шаг GitHub с отчётом его не запускает",
          ok, out)
    (tdir / "erp-setup.test.ts").write_text(
        'import { describe, it } from "vitest"\nconst pgDescribe = process.env.ERP_TEST_DATABASE_URL '
        f'? describe : describe.skip\npgDescribe("u1-A-01: на настоящей базе", () => {{\n'
        f'  it("меню из пяти пунктов", () => {{}})\n}})\ndescribe("erp", () => {{\n'
        f'  it.skip("{A02}", () => {{}})\n}})\n', encoding="utf-8")
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", box.ci(b1, skip=["u1-A-01: на настоящей базе меню из пяти пунктов"]))
    check("условный тест (обёртка по окружению) в отчёте пропущен — отметки нет: он не выполнялся",
          rc == 1 and "пропущен" in out and "ERP_TEST_DATABASE_URL" in out, out)
    rc, out = run("mark.py", "rule", "А-01", "--run", box.ci(b1, green=["u1-A-01: на настоящей базе меню из пяти пунктов"]))
    d = box.rule("u1-A-01").get("done") or {}
    check("условный тест, который в прогоне выполнился (passed), отметку даёт; записаны хэш текста, "
          "номер прогона и коммит",
          rc == 0 and box.rule("u1-A-01")["status"] == "done" and d.get("hash") == box.rule("u1-A-01")["text_hash"]
          and d.get("run_id") and d.get("sha") == SHA0, out)
    (tdir / "erp-setup.test.ts").write_text(keep_setup.replace("it.skip(", "it("), encoding="utf-8")
    rc, out = run("mark.py", "rule", "u1-A-02", "--run", skipped)
    check("пропущенный тест (skipped в отчёте) зелёным не считается",
          rc == 1 and "пропущен" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-02", "--run", green_all)
    check("после включения теста правило отмечается",
          rc == 0 and box.rule("u1-A-02")["status"] == "done", out)

    # --- «досмотреть»
    rc, out = run("mark.py", "rule", "u1-A-03", "--run", green_all)
    check("нельзя отметить «досмотреть», даже с зелёным тестом",
          rc == 1 and "досмотреть" in out and box.rule("u1-A-03")["status"] == "blocked_to_look", out)
    rc, out = run("mark.py", "rule", "u1-A-05", "--run", green_all)
    check("нельзя отметить правило, которое ждёт просмотра другого правила",
          rc == 1 and "ждёт просмотра" in out, out)
    rc, out = run("mark.py", "prelook", "u1-A-03", "--run", green_all)
    check("поведение «до просмотра» не отмечается обычным тестом: нужна метка #pre",
          rc == 1 and "u1-A-03#pre" in out, out)
    rc, out = run("mark.py", "prelook", "u1-A-04", "--run", green_all)
    check("поведение «до просмотра» отмечается тестом с #pre, правило остаётся заблокированным",
          rc == 0 and box.rule("u1-A-04")["status"] == "blocked_to_look"
          and box.rule("u1-A-04").get("prelook"), out)

    # --- закрытие карточки и записка
    check("без записки карточка не закрывается", not box.prog()["cards"]["1"].get("closed"))
    rc, out = run("mark.py", "note", "1", "--text", "коротко")
    check("пустая отписка вместо записки не принимается", rc == 1, out)
    rc, out = run("mark.py", "note", "1", "--text", "Настройки готовы, а дальше ждём владельца.",
                  "--blocked", "мешает всё")
    check("«мешает» в открытой части — только слово из списка", rc == 1 and "из списка" in out, out)
    before = box.private_commits()
    secret = "Настройки готовы. А-03 и А-05 ждут просмотра 1С, сеанс 1 строка 2."
    rc, out = run("mark.py", "note", "1", "--text", secret, "--blocked", "look_1c",
                  "--blocked-rules", "u1-A-03,А-05")
    note = box.prog()["cards"]["1"].get("note") or {}
    check("карточка закрывается сама: шаги, записка, правила сделаны или законно ждут",
          rc == 0 and "КАРТОЧКА 1 ЗАКРЫТА" in out and box.prog()["cards"]["1"].get("closed")
          and (box.dir / "notes" / "1-setup.md").exists(), out)
    check("записка не теряется: полный текст — в закрытой папке и в её git; в открытой части — "
          "сводка из номеров шагов и правил, без текста",
          box.private_commits() > before and secret in (box.dir / "notes" / "1-setup.md").read_text(encoding="utf-8")
          and note.get("steps_done") == [1, 2] and note.get("blocked") == "look_1c"
          and note.get("blocked_rules") == ["u1-A-03", "u1-A-05"] and "u1-A-01" in note.get("rules_done", [])
          and "сеанс" not in json.dumps(note, ensure_ascii=False), out + str(note))
    bad = box.copy("badnote")
    box.edit_prog("1", lambda st: st["note"].update(text="остановился на шаге про счётчик номеров"), dir=bad)
    rc, out = run("check_progress.py", dir=bad)
    check("check_progress краснеет, если в записку открытой части дописали текст",
          rc == 1 and "лишнее поле text" in out, out)

    # --- изменённый текст сбрасывает отметку
    new_hash = box.text("u1-A-01", "А-01", "Меню настроек учёта состоит из ШЕСТИ пунктов", "как в 1С")
    rc, out = run("status.py")
    check("текст правила изменили — экран владельца показывает, что отметка недействительна",
          rc == 0 and "Текст изменился" in out and "u1-A-01" in out, out)
    rc, out = run("check_progress.py")
    check("check_progress краснеет: текст изменился после отметки",
          rc == 1 and "текст изменился" in out, out)
    rc, out = run("mark.py", "sync")
    check("изменённый текст сбрасывает отметку «сделано» и снова открывает карточку",
          rc == 0 and "СБРОШЕНО: u1-A-01" in out and "КАРТОЧКА 1 СНОВА ОТКРЫТА" in out
          and box.rule("u1-A-01")["status"] == "not_started"
          and not box.prog()["cards"]["1"].get("closed"), out)
    rc, out = run("next_card.py")
    check("после сброса снова выдаётся карточка 1, а не следующая",
          rc == 0 and "КАРТОЧКА 1 " in out, out)
    rc, out = run("next_card.py", "--busy", b1)
    rc2, out2 = run("next_card.py", "--busy", b1, "--merged", b1)
    check("переоткрытая карточка: невлитая ветка erp/1-setup её держит; ветка прошлого закрытия, уже "
          "влитая в origin/main, занятостью не считается — карточку выдают и велят удалить ветку",
          rc == 3 and "занята веткой" in out and rc2 == 0 and "КАРТОЧКА 1 " in out2
          and "уже влита в origin/main" in out2 and "git push origin --delete erp/1-setup" in out2,
          out + out2)
    run("next_card.py", "--take", b1)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", green_all)
    check("пока реестр не пересобран под новый текст, правило отметить нельзя",
          rc == 1 and "не совпадает с реестром" in out, out)
    box.edit_reg(lambda by, _: by["u1-A-01"].update(text_hash=new_hash))  # как сделает build_registry
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", green_all)
    rc2, out2 = run("mark.py", "note", "1", "--text", "А-01 переделано под новый текст правила.")
    check("после пересборки реестра правило делается заново и карточка закрывается",
          rc == 0 and rc2 == 0 and "КАРТОЧКА 1 ЗАКРЫТА" in out2, out + out2)
    h2 = box.text("u1-A-02", "А-02", "Настройка идёт в ДРУГОМ порядке", "как в 1С")
    box.edit_reg(lambda by, _: by["u1-A-02"].update(text_hash=h2))  # хэш новый, «сделано» осталось
    rc, out = run("mark.py", "sync")
    check("хэш в реестре изменился, а «сделано» осталось — отметка сбрасывается",
          "СБРОШЕНО: u1-A-02" in out and box.rule("u1-A-02")["status"] == "not_started", out)
    run("next_card.py", "--take", b1)
    run("mark.py", "rule", "u1-A-02", "--run", green_all)
    rc, out = run("mark.py", "note", "1", "--text", "А-02 переделано под новый текст правила.")
    check("карточка 1 снова закрыта", "КАРТОЧКА 1 ЗАКРЫТА" in out, out)

    # --- карточка 2: похожие номера и вопрос владельцу
    b2 = "erp/2-stock"
    rc, out = run("next_card.py", "--take", b2)
    check("после карточки 1 выдаётся и берётся карточка 2", rc == 0 and "ВЗЯТА: карточка 2" in out, out)
    run("mark.py", "step", "2", "1")
    box.tests("erp-stock.test.ts", [f'it("{B10}", () => {{}})',
                                    'it("u2-B-1.1#pre: приход до просмотра", () => {})'])
    rc, out = run("mark.py", "rule", "u2-B-1.1", "--run",
                  box.ci(b2, green=[B10, "u2-B-1.1#pre: приход до просмотра"]))
    check("правилу u2-B-1.1 не засчитывается ни тест u2-B-1.10, ни тест с меткой #pre",
          rc == 1 and "нет включённого теста" in out, out)
    box.tests("erp-stock.test.ts", [f'it("{B10}", () => {{}})', f'it("{B11}", () => {{}})'])
    stock = box.ci(b2, green=[B11, B10])
    rc, out = run("mark.py", "rule", "u2-B-1.1", "--run", box.ci(b2, green=[B10]))
    rc2, out2 = run("mark.py", "rule", "u2-B-1.1", "--run", stock)
    check("правило u2-B-1.1 отмечается своим тестом, а зелёным u2-B-1.10 в отчёте — нет",
          rc == 1 and rc2 == 0, out + out2)
    rc, out = run("mark.py", "problem", "u2-B-1.10", "--kind", "no_data", "--text",
                  "В правиле не сказано, как считать остаток при двух складах: нужен ответ владельца.")
    check("вопрос по правилу записывается; правило сделать нельзя",
          rc == 0 and box.rule("u2-B-1.10").get("problem")
          and run("mark.py", "rule", "u2-B-1.10", "--run", stock)[0] == 1, out)
    rc, out = run("mark.py", "note", "2", "--text", "Приход готов. По B-1.10 вопрос владельцу.",
                  "--blocked", "owner", "--blocked-rules", "u2-B-1.10")
    check("карточка с вопросом закрывается — работа идёт до ворот", "КАРТОЧКА 2 ЗАКРЫТА" in out, out)

    # --- ворота: запись с дословными словами владельца, отдельным PR, после мержа неизменяемая
    rc, out = run("next_card.py")
    check("впереди ворота: карточка не выдаётся, названо, чьё действие нужно; сессии сказано не "
          "закрывать ворота по своей инициативе и не записывать слова по памяти; кодов нет",
          rc == 2 and "ВОРОТА 3" in out and "клиент" in out and "владелец" in out
          and "КАРТОЧКА" not in out and "--words" in out and "--code" not in out
          and "По своей инициативе ворота не закрываются" in out and "по памяти" in out, out)
    rc, out = run("next_card.py", "--take", "erp/4-money")
    check("нельзя взять карточку за воротами", rc == 1, out)
    rc, out = run("mark.py", "gate", "3", "--role", "owner", "--by", "Рашад", "--date", TODAY,
                  "--words", "давай")
    check("ворота не закрываются, пока по правилам есть вопросы владельцу",
          rc == 1 and "вопросы" in out, out)
    hand_gate = {"key": "3", "kind": "gate", "state": {"confirmations": [
        {"role": "client", "by": "Клиент: главбух", "date": TODAY, "words": "принял на своих данных"},
        {"role": "owner", "by": "Рашад", "date": TODAY, "words": "давай"}]}}
    base_h = box.copy("base_h")
    bad = box.copy("handgate1")
    L._write_json(bad / "progress" / "3.json", hand_gate)
    rc, out = run("check_progress.py", "--branch", "erp/3-accept-0", "--base-dir", str(base_h), dir=bad)
    rc2, out2 = run("check_progress.py", "--branch", "erp/3-accept-0", "--base-dir", str(base_h))
    check("запись о воротах, вписанная в файл руками при неснятом вопросе владельцу, — красный "
          "check_progress с номером правила; карточки при этом закрыты; без записи — зелёный",
          rc == 1 and "запись о воротах появилась" in out and "неснятые вопросы владельцу" in out
          and "u2-B-1.10" in out and "до них не закрыты" not in out and rc2 == 0, out + out2)
    rc, out = run("mark.py", "problem", "u2-B-1.10", "--clear", "--words", "считать по каждому складу")
    rc2, out2 = run("mark.py", "problem", "u2-B-1.10", "--clear", "--by", "Рашад")
    check("вопрос снимает только запись с именем и дословным ответом владельца: без имени или без "
          "слов — отказ",
          rc == 1 and rc2 == 1 and "дословные слова" in out2 and box.rule("u2-B-1.10").get("problem"),
          out + out2)
    base_q = box.copy("base_q")
    run("mark.py", "problem", "u2-B-1.10", "--clear", "--by", "Рашад",
        "--words", "считать по каждому складу отдельно")
    bad = box.copy("badclear")
    box.edit_reg(lambda by, _: by["u2-B-1.10"].pop("problem_cleared"), dir=bad)
    rc, out = run("check_progress.py", "--base-dir", str(base_q), dir=bad)
    check("check_progress краснеет, если вопрос владельцу убрали из реестра без записи его ответа",
          rc == 1 and "вопрос владельцу исчез" in out, out)
    base_q2 = box.copy("base_q2")
    bad = box.copy("badclear2")
    box.edit_reg(lambda by, _: by["u2-B-1.10"]["problem_cleared"].update(words="делай как удобнее"), dir=bad)
    rc, out = run("check_progress.py", "--base-dir", str(base_q2), dir=bad)
    bad = box.copy("badclear3")
    box.edit_reg(lambda by, _: by["u2-B-1.10"].pop("problem_cleared"), dir=bad)
    rc2, out2 = run("check_progress.py", "--base-dir", str(base_q2), dir=bad)
    check("снятый вопрос, попавший в main, нельзя ни изменить, ни стереть: check_progress красный",
          rc == 1 and "снятом вопросе из main стёрта или изменена" in out
          and rc2 == 1 and "снятом вопросе из main стёрта или изменена" in out2, out + out2)
    rc, out = run("next_card.py")
    check("вопрос снят — правило снова надо сделать: выдаётся карточка 2, а не ворота",
          rc == 0 and "КАРТОЧКА 2 " in out, out)
    run("next_card.py", "--take", b2)
    base_h = box.copy("base_h2")
    bad = box.copy("handgate2")
    L._write_json(bad / "progress" / "3.json", hand_gate)
    rc, out = run("check_progress.py", "--branch", "erp/3-accept-0", "--base-dir", str(base_h), dir=bad)
    check("запись о воротах, вписанная руками при незакрытой карточке из их «после», — красный "
          "check_progress с номером карточки (вопросов владельцу при этом нет)",
          rc == 1 and "запись о воротах появилась, а карточки 2 до них не закрыты" in out
          and "неснятые вопросы" not in out, out)
    run("mark.py", "rule", "u2-B-1.10", "--run", stock)
    run("mark.py", "note", "2", "--text", "B-1.10 сделано после ответа владельца.")
    rc, out = run("mark.py", "gate", "3", "--role", "owner", "--date", TODAY, "--words", "давай")
    check("ворота не закрываются без имени", rc == 1 and "имя" in out
          and not box.prog()["gates"].get("3"), out)
    rc, out = run("mark.py", "gate", "3", "--role", "owner", "--by", "Claude", "--date", TODAY,
                  "--words", "давай")
    check("ворота не закрываются именем сессии ИИ", rc == 1, out)
    rc, out = run("mark.py", "gate", "3", "--role", "owner", "--by", "Рашад", "--words", "давай")
    rc2, out2 = run("mark.py", "gate", "3", "--role", "owner", "--by", "Рашад", "--date", "2026-12-31",
                    "--words", "давай")
    check("ворота не закрываются без даты и с датой из будущего", rc == 1 and rc2 == 1, out + out2)
    rc, out = run("mark.py", "gate", "3", "--by", "Рашад", "--date", TODAY, "--words", "давай")
    check("у ворот два подтверждающих — нужно назвать, чьё это подтверждение", rc == 1, out)
    rc, out = run("mark.py", "gate", "3", "--role", "owner", "--by", "Рашад", "--date", TODAY)
    rc2, out2 = run("mark.py", "gate", "3", "--role", "owner", "--by", "Рашад", "--date", TODAY,
                    "--words", "  ")
    rc3, out3 = run("mark.py", "gate", "3", "--role", "owner", "--by", "Рашад", "--date", TODAY,
                    "--words", "давай " * 60)
    rc4, out4 = run("mark.py", "gate", "3", "--role", "owner", "--by", "Рашад", "--date", TODAY,
                    "--words", "давай", "--code", "AAAAA-BBBBB")
    check("ворота без слов владельца — отказ: имя и дата без дословных слов ничего не закрывают; "
          "слова не обрезаются молча; ключа --code больше нет",
          rc == 1 and "дословные слова" in out and "спроси владельца ещё раз" in out and rc2 == 1
          and rc3 == 1 and "длиннее" in out3 and rc4 != 0 and not box.prog()["gates"].get("3"),
          out + out2 + out3 + out4)
    base_g = box.copy("base_g")
    client_words = "кладовщик принял склад на своих данных; запись — client/answers/accept-0.md"
    rc, out = run("mark.py", "gate", "3", "--role", "client", "--by", "Клиент: главбух",
                  "--date", "2026-10-08", "--words", client_words)
    rc2, out2 = run("next_card.py")
    check("приёмка клиента записана (что сделал и где свидетельство), но ворота ещё стоят: нужен владелец",
          rc == 0 and rc2 == 2 and "владелец" in out2 and "уже подтвердил: клиент" in out2
          and "accept-0.md" in out2, out + out2)
    rc, out = run("mark.py", "gate", "3", "--role", "client", "--by", "Клиент: главбух",
                  "--date", TODAY, "--words", "принял ещё раз, другими словами")
    check("записанное подтверждение роли не переписывается второй записью",
          rc == 1 and "не переписывается" in out
          and box.prog()["gates"]["3"]["confirmations"][0]["words"] == client_words, out)
    rc, out = run("mark.py", "gate", "3", "--role", "owner", "--by", "Рашад", "--date", TODAY,
                  "--words", "давай")
    check("ворота закрываются записью: роль, кто, дата и дословные слова",
          rc == 0 and "ВОРОТА 3 ЗАКРЫТЫ" in out and "«давай»" in out
          and box.prog()["gates"]["3"]["confirmations"][1] ==
          {"role": "owner", "by": "Рашад", "date": TODAY, "words": "давай"}, out)
    rc, out = run("check_progress.py", "--branch", "erp/3-accept-0", "--base-dir", str(base_g))
    rc2, out2 = run("check_progress.py", "--branch", "erp/2-stock", "--base-dir", str(base_g))
    check("check_progress: PR ветки ворот, где изменилась только запись этих ворот, — зелёный; та же "
          "запись в чужой ветке — красный",
          rc == 0 and rc2 == 1 and "не в ветке этих ворот" in out2, out + out2)
    bad = box.copy("badmix1")
    box.edit_reg(lambda by, _: by["u3-D-01"].update(status="in_progress"), dir=bad)
    rc, out = run("check_progress.py", "--branch", "erp/3-accept-0", "--base-dir", str(base_g), dir=bad)
    bad = box.copy("badmix2")
    L._write_json(bad / "progress" / "4.json", {"key": "4", "kind": "card", "state": {
        "taken_by": "erp/4-money", "taken_at": TODAY}})
    rc2, out2 = run("check_progress.py", "--branch", "erp/3-accept-0", "--base-dir", str(base_g), dir=bad)
    bad = box.copy("badmix3")
    o = json.loads((bad / "order.json").read_text(encoding="utf-8"))
    o["cards"][3]["after"] = [2]
    (bad / "order.json").write_text(json.dumps(o, ensure_ascii=False), encoding="utf-8")
    rc3, out3 = run("check_progress.py", "--branch", "erp/3-accept-0", "--base-dir", str(base_g), dir=bad)
    check("закрытие ворот вместе с другой работой — красное: в том же PR отметка правила, взятая "
          "карточка или правка порядка",
          rc == 1 and "смешано с другой работой" in out and "u3-D-01" in out
          and rc2 == 1 and "смешано с другой работой" in out2 and "состояние карточек 4" in out2
          and rc3 == 1 and "порядок карточек" in out3, out + out2 + out3)
    base_closed = box.copy("base_closed")  # main после мержа PR ворот
    bad = box.copy("badgate1")
    box.edit_prog("3", lambda st: st["confirmations"][1].update(words="давай, и срез 2 тоже"), dir=bad)
    rc, out = run("check_progress.py", "--base-dir", str(base_closed), dir=bad)
    bad = box.copy("badgate2")
    box.edit_prog("3", lambda st: st["confirmations"].pop(0), dir=bad)
    rc2, out2 = run("check_progress.py", "--base-dir", str(base_closed), dir=bad)
    bad = box.copy("badgate3")
    (bad / "progress" / "3.json").unlink()
    rc3, out3 = run("check_progress.py", "--base-dir", str(base_closed), dir=bad)
    rc4, out4 = run("check_progress.py", "--base-dir", str(base_closed))
    check("запись о воротах из main нельзя изменить или стереть: правка слов, удаление одной записи "
          "и удаление файла ворот — красный check_progress; нетронутая запись — зелёный",
          rc == 1 and "стёрта или изменена" in out and rc2 == 1 and "стёрта или изменена" in out2
          and rc3 == 1 and "стёрта или изменена" in out3 and rc4 == 0, out + out2 + out3 + out4)
    stale = box.copy("stalegate")
    box.edit_prog("2", lambda st: st.pop("closed"), dir=stale)
    stale_base = box.root / "stalegate_base"
    shutil.copytree(stale, stale_base)
    rc, out = run("check_progress.py", "--base-dir", str(stale_base), dir=stale)
    check("запись о воротах уже в main, а карточка до них открылась снова — предупреждение, не "
          "ошибка: выкладку изменённого документа это не запирает",
          rc == 0 and "ворота 3 закрыты записью из main" in out and "открыты карточки 2" in out, out)
    bad = box.copy("badgate4")
    box.edit_prog("3", lambda st: [k.pop("words") for k in st["confirmations"]], dir=bad)
    rc, out = run("check_progress.py", dir=bad)
    rc2, out2 = run("next_card.py", dir=bad)
    check("запись о воротах без слов (вписали руками) воротами не считается: check_progress красный, "
          "очередь стоит на воротах",
          rc == 1 and "без слов" in out and rc2 == 2 and "ВОРОТА 3" in out2, out + out2)
    rc, out = run("next_card.py")
    check("после закрытия ворот открывается следующая карточка (4)",
          rc == 0 and "КАРТОЧКА 4 " in out, out)

    # --- параллельные сессии
    base = box.copy("base")  # состояние main до работы двух сессий
    run("next_card.py", "--take", "erp/4-money", branch="erp/4-money")
    rc, out = run("next_card.py", branch="claude/b")
    check("вторая сессия получает карточку 5 (с кодом): занятая 4 — без кода, вести рядом можно",
          rc == 0 and "КАРТОЧКА 5 " in out, out)
    rc, out = run("next_card.py", "--take", "erp/4-money", branch="erp/5-vat")
    check("сессия из другой ветки не может взять занятую карточку 4", rc == 1, out)
    rc, out = run("next_card.py", "--take", "erp/5-vat", branch="erp/5-vat")
    rc2, out2 = run("next_card.py", branch="claude/c")
    check("третьей сессии выдать нечего: 6 ждёт 4 и 5, а 7 с кодом — карточки с кодом идут по одной",
          rc == 0 and rc2 == 3 and "ждёт карточки: 4, 5" in out2 and "по одной" in out2, out + out2)
    rc, out = run("mark.py", "rule", "u3-D-01", "--run", box.ci("erp/5-vat", green=ALL), branch="erp/5-vat")
    check("сессия не может отметить правило чужой карточки", rc == 1 and "занята веткой" in out, out)
    base_r = box.copy("base_r")
    rc, out = run("mark.py", "release", "4", "--by", "Рашад")
    bad = box.copy("badrel")
    box.edit_prog("4", lambda st: st.pop("taken_by"), dir=bad)
    rc2, out2 = run("check_progress.py", "--base-dir", str(base_r), dir=bad)
    check("занятость с карточки снимает только запись владельца (имя и его слова); снятая руками — "
          "красный check_progress",
          rc == 1 and "дословные слова" in out and box.prog()["cards"]["4"].get("taken_by")
          and rc2 == 1 and "занятость снята" in out2, out + out2)

    # --- проверка для GitHub
    rc, out = run("check_progress.py", "--branch", "erp/5-vat", "--base-dir", str(base))
    check("check_progress зелёный для ветки, взявшей карточку по порядку", rc == 0, out)
    rc, out = run("check_progress.py", "--branch", "erp/5-vat", env={"GITHUB_ACTIONS": "true"})
    check("в GitHub без базы для сравнения (и без отчёта тестов) check_progress красный — "
          "молча пропустить сравнение нельзя", rc == 1 and "нет базы для сравнения" in out, out)
    rc, out = run("check_progress.py", "--branch", "erp/6-close")
    check("check_progress краснеет на ветке карточки, взятой не по порядку",
          rc == 1 and "не по порядку" in out, out)
    rc, out = run("check_progress.py", "--branch", "erp/77-foo")
    check("check_progress краснеет на ветке erp/… без карточки", rc == 1, out)
    bad = box.copy("bad1")
    box.edit_reg(lambda by, _: by["u1-A-03"].update(
        status="done", done={"hash": by["u1-A-03"]["text_hash"]}), dir=bad)
    rc, out = run("check_progress.py", dir=bad)
    check("check_progress краснеет, если «досмотреть» отмечено сделанным в обход команд",
          rc == 1 and "досмотреть" in out, out)
    bad = box.copy("bad2")
    box.edit_reg(lambda by, _: by["u3-D-03"].update(status="done"), dir=bad)
    rc, out = run("check_progress.py", dir=bad)
    check("check_progress краснеет на «сделано» без доказательства", rc == 1, out)
    bad = box.copy("bad3")
    box.edit_reg(lambda by, _: by["u3-D-01"].update(
        status="done", done={"hash": by["u3-D-01"]["text_hash"], "card": "4"}), dir=bad)
    rc, out = run("check_progress.py", "--branch", "erp/5-vat", "--base-dir", str(base), dir=bad)
    rc2, out2 = run("check_progress.py", "--branch", "erp/5-vat", dir=bad)
    check("ветка карточки 5 отметила правило карточки 4: со сравнением с main — красный "
          "(без сравнения этого не видно, поэтому в GitHub оно обязательно)",
          rc == 1 and "вне карточки 5" in out and rc2 == 0, out + out2)
    rc, out = run("check_progress.py", "--branch", "claude/docs-fix", "--base-dir", str(base), dir=bad)
    check("check_progress краснеет на новой отметке в ветке, которая не карточка", rc == 1, out)
    keep = (tdir / "erp-stock.test.ts").read_text(encoding="utf-8")
    box.tests("erp-stock.test.ts", [f'it("{B10}", () => {{}})', f'it.todo("{B11}")'])
    rc, out = run("check_progress.py")
    check("check_progress краснеет, если тест сделанного правила убрали или выключили",
          rc == 1 and "u2-B-1.1" in out and "теста" in out, out)
    (tdir / "erp-stock.test.ts").write_text(
        'import { describe, it } from "vitest"\n'
        f'describe.skip("erp", () => {{\n  it("{B10}", () => {{}})\n  it("{B11}", () => {{}})\n}})\n',
        encoding="utf-8")
    rc, out = run("check_progress.py")
    check("check_progress краснеет, если тесты сделанных правил завернули в describe.skip",
          rc == 1 and "u2-B-1.1 " in out and "u2-B-1.10" in out, out)
    (tdir / "erp-stock.test.ts").write_text(keep, encoding="utf-8")
    (box.repo / "test-baseline.json").write_text(json.dumps(
        {"knownFailingFiles": ["src/__tests__/erp-stock.test.ts"]}), encoding="utf-8")
    rc, out = run("check_progress.py")
    check("check_progress краснеет, если тест правила записан в известные красные",
          rc == 1 and "числится красным" in out, out)
    (box.repo / "test-baseline.json").unlink()
    # отчёт прогона: «сделано» держится только на тесте со статусом passed в этом же прогоне
    done_now = [A01, A02, A04P, B10, B11]
    rc, out = run("check_progress.py", "--tests-report", box.report("r_ok.json", green=done_now))
    check("check_progress с отчётом прогона зелёный, когда тест каждого «сделано» и «до просмотра» — passed",
          rc == 0 and "отчёт прогона" in out, out)
    rc, out = run("check_progress.py", "--tests-report",
                  box.report("r_skip.json", green=[A01, A02, A04P, B10], skip=[B11]))
    check("…красный, когда тест сделанного правила в прогоне пропущен (describe.skip, нет базы)",
          rc == 1 and "u2-B-1.1 " in out and "пропущен" in out, out)
    rc, out = run("check_progress.py", "--tests-report", box.report("r_none.json", green=[A01, A02, B10, B11]))
    check("…красный, когда тест «до просмотра» в прогоне не выполнялся вовсе",
          rc == 1 and "u1-A-04" in out and "не выполнялся" in out, out)
    rc, out = run("check_progress.py", "--tests-report",
                  box.report("r_red.json", green=[A02, A04P, B10, B11], red=[A01]))
    check("…красный, когда тест сделанного правила в прогоне красный", rc == 1 and "красный" in out, out)
    rc, out = run("check_progress.py", "--tests-report", str(box.root / "no-such.json"))
    rc2, out2 = run("check_progress.py", "--tests-report", str(hand))
    rc3, out3 = run("check_progress.py", "--tests-report", box.report("r_nostamp.json", green=done_now, stamp=False),
                    env={"GITHUB_ACTIONS": "true"})
    rc4, out4 = run("check_progress.py", "--tests-report", box.report("r_sha.json", green=done_now),
                    env={"GITHUB_ACTIONS": "true", "HEAD_SHA": "1" * 40})
    check("нет отчёта, отчёт не из шага GitHub или не того коммита — красный, а не «пропущено»",
          rc == 1 and rc2 == 1 and rc3 == 1 and "не помечен" in out3 and rc4 == 1 and "по коммиту" in out4,
          out + out2 + out3 + out4)
    wf = box.root / "pr-checks.yml"
    wf.write_text(WORKFLOW_OK, encoding="utf-8")
    rc, out = run("check_progress.py", "--workflow", str(wf))
    wf.write_text(WORKFLOW_OK.replace('--base-ref "$BASE_SHA" ', "")
                  .replace("      - uses: actions/upload-artifact@v4\n        with:\n          name: erp-tests\n", "")
                  .replace("          python3 scripts/erp/check_progress.py --tests-report",
                           "          # python3 scripts/erp/check_progress.py --tests-report"),
                  encoding="utf-8")
    rc2, out2 = run("check_progress.py", "--workflow", str(wf))
    check("check_progress сторожит свой workflow: убрали базу сравнения, выгрузку отчёта или "
          "закомментировали шаг — красный",
          rc == 0 and rc2 == 1 and out2.count("нет строки") == 3, out + out2)
    bad = box.copy("bad4")
    o = json.loads((bad / "order.json").read_text(encoding="utf-8"))
    o["cards"][6]["rules"] = []
    (bad / "order.json").write_text(json.dumps(o, ensure_ascii=False), encoding="utf-8")
    rc, out = run("check_progress.py", dir=bad)
    check("check_progress краснеет, если правило не попало ни в одну карточку",
          rc == 1 and "u3-D-04" in out and "ни в одну карточку" in out, out)

    # --- экран владельца и выкладка в открытый репозиторий
    rc, out = run("status.py")
    check("экран владельца: срезы, карточки в работе, ближайшие ворота и пройденные ворота с датой "
          "и дословными словами — в один экран",
          rc == 0 and len(out.strip().splitlines()) <= 26 and "В работе: карточка 4" in out
          and "В работе: карточка 5" in out and "Всего" in out and "Пройденные ворота" in out
          and f"владелец — Рашад, {TODAY}: «давай»" in out and "accept-0.md" in out
          and "Кодов" not in out, out)
    screen = box.root / "OWNER_SCREEN.md"
    screen.write_text("# Экран\n\n## Пройденные ворота\n\n<!-- gates-begin -->\nстарое\n"
                      "<!-- gates-end -->\n\nхвост\n", encoding="utf-8")
    rc, out = run("status.py", "--screen", str(screen))
    body = screen.read_text(encoding="utf-8")
    check("status.py --screen вписывает в файл экрана владельца пройденные ворота: дата и слова",
          rc == 0 and "старое" not in body and "хвост" in body and "«давай»" in body
          and f"| {TODAY} |" in body and "я не открывал" in body, out + body)
    pub = box.root / "public"
    rc, out = run("export_public.py", "--to", str(pub))
    blob = "".join(p.read_text(encoding="utf-8") for p in pub.rglob("*.json"))
    leak = [w for w in ("закрытое поле", "закрытый текст", "ШЕСТИ пунктов", "rules_text",
                        "section", "detail", "lishnee", "сеанс 1", "двух складах") if w in blob]
    check("выкладка в репозиторий: нет текста правил, карточек, записок и закрытых полей",
          rc == 0 and not leak and (pub / "check_progress.py").exists()
          and (pub / "ci_report.py").exists() and not (pub / "owner_codes.py").exists()
          and not (pub / "owner_codes.json").exists()
          and not (pub / "rules_text").exists() and not (box.dir / L.STATE_MOVED).exists(),
          out + str(leak))
    env_run = dict(dir=pub)
    rc, out = run("status.py", **env_run)
    rc2, out2 = run("check_progress.py", "--branch", "erp/5-vat", **env_run)
    rc3, out3 = run("next_card.py", **env_run)
    check("в выкладке без закрытой папки проверка и экран владельца работают, состояние то же; "
          "карточку без текста правил не выдают",
          rc == 0 and rc2 == 0 and "В работе: карточка 4" in out and rc3 == 1
          and "нет закрытой папки" in out3, out + out2 + out3)
    inrepo = box.repo / "scripts" / "erp"
    run("export_public.py", "--to", str(inrepo))
    rc, out = run("next_card.py")
    rc2, out2 = run("mark.py", "step", "4", "1")
    check("после выкладки в scripts/erp закрытая копия состояния помечена «устарела»: по ней "
          "карточку не выдают и отметок не ставят",
          rc == 1 and "устарела" in out and rc2 == 1 and "устарела" in out2, out + out2)
    if (box.repo / ".git").exists() and box.git("add", "-A") and box.git("commit", "-q", "-m", "erp"):
        # PR ворот по файлам: в main ворота 3 ещё без записи владельца, PR её добавляет
        owner_rec = box.prog(inrepo)["gates"]["3"]["confirmations"][1]
        box.edit_prog("3", lambda st: st["confirmations"].pop(), dir=inrepo)
        box.git("commit", "-q", "-am", "main: ворота 3 без владельца")
        box.edit_prog("3", lambda st: st["confirmations"].append(owner_rec), dir=inrepo)
        box.git("commit", "-q", "-am", "erp 3: запись о воротах")
        rcg, outg = run("check_progress.py", "--branch", "erp/3-accept-0", "--base-ref", "HEAD~1",
                        dir=inrepo, git=True, extra=("--busy", "erp/4-money"))
        (box.repo / "src" / "zaodno.ts").write_text("// заодно с воротами\n", encoding="utf-8")
        box.git("add", "-A"); box.git("commit", "-q", "-m", "заодно")
        rcg2, outg2 = run("check_progress.py", "--branch", "erp/3-accept-0", "--base-ref", "HEAD~2",
                          dir=inrepo, git=True, extra=("--busy", "erp/4-money"))
        check("как в GitHub (--base-ref): PR ворот, где изменён только файл этих ворот, — зелёный; "
              "тот же PR с посторонним файлом — красный «смешано с другой работой»",
              rcg == 0 and rcg2 == 1 and "смешано с другой работой" in outg2
              and "src/zaodno.ts" in outg2, outg + outg2)
        rc, out = run("check_progress.py", "--branch", "erp/5-vat", "--base-ref", "HEAD",
                      dir=inrepo, git=True, extra=("--busy", "erp/4-money"))
        box.edit_reg(lambda by, _: by["u3-D-03"].update(
            status="done", done={"hash": by["u3-D-03"]["text_hash"], "card": "6"}), dir=inrepo)
        rc2, out2 = run("check_progress.py", "--branch", "erp/5-vat", "--base-ref", "HEAD",
                        dir=inrepo, git=True, extra=("--busy", "erp/4-money"))
        rc3, out3 = run("check_progress.py", "--branch", "erp/5-vat", "--base-ref", "f" * 40,
                        dir=inrepo, git=True, extra=("--busy", "erp/4-money"))
        check("как в GitHub (--base-ref): без новых чужих отметок зелёный, с чужой отметкой красный, "
              "с нечитаемой базой — отказ",
              rc == 0 and rc2 == 1 and "u3-D-03" in out2 and "вне карточки 5" in out2
              and rc3 == 1 and "не читается" in out3, out + out2 + out3)
    else:
        check("настоящий git недоступен — сравнение с main через --base-ref НЕ ВЫПОЛНЕНО", False)
    pubreg = json.loads((pub / "registry.json").read_text(encoding="utf-8"))
    pubreg["rules"][0]["text_hash"] = "0" * 64  # как будто документ поменяли и выложили заново
    (pub / "registry.json").write_text(json.dumps(pubreg, ensure_ascii=False), encoding="utf-8")
    rc, out = run("mark.py", "sync", **env_run)
    check("в репозитории без текста правил сброс работает по хэшу",
          "СБРОШЕНО: u1-A-01" in out and box.rule("u1-A-01", dir=pub)["status"] == "not_started", out)


RULES2 = [
    ("D-9.1", "u4-D-9.1", "as_1c", 0, "Проба загрузки файла у клиента", False, []),
    ("А-01", "u1-A-01", "as_1c", 0, "Способ оценки запасов: поле с историей", False, []),
    ("А-02", "u1-A-02", "as_1c", 0, "Меню настроек", False, []),
    ("B-02", "u2-B-02", "as_1c", 0, "Печать листа перемещения", False, []),
    ("B-04", "u2-B-04", "to_look", 0, "Состав листа. До просмотра лист не кодируется", True, []),
    ("B-05", "u2-B-05", "to_look", 0, "Отказ при минусе. До просмотра: отказ с сообщением", True, []),
    ("Д-01", "u3-D-01", "as_1c", 1, "Оплата долга", False, []),
    ("Д-09", "u3-D-09", "as_1c", 6, "Выгрузка в 1С", False, []),
]


def build_real(box: Box):
    """Порядок в том виде, в каком его пишет сборщик карточек: срезы, номера 001…,
    шаги списком с «@имя», carry, held, evidence_rules, outline, ворота без who."""
    build(box, RULES2, with_order=False)
    steps = ["@start", "Экран настроек. @screen_hint", "@tests|Отдельно — тест на настоящей базе.",
             "@merge", "@registry"]
    order = {
        "meta": {"schema": 1},
        "common": {"start": "Старт. Прочитать карточку целиком.", "tests": "Тесты. На каждое правило — тест.",
                   "merge": "Проверки GitHub и мерж.", "registry": "Запись в реестр.",
                   "screen_hint": "закрытая памятка про меню"},
        "slices": [
            {"slice": 0, "title": "Готовность", "cards": [
                {"number": "001", "slug": "client-sample", "title": "Проба файла у клиента",
                 "kind": "work", "rules": ["D-9.1"], "rule_slugs": ["u4-D-9.1"], "after": [],
                 "parallel_ok": True, "detail": "full", "evidence_rules": ["D-9.1"],
                 "steps": ["@start", "Отправить файл клиенту", "@registry"]},
                {"number": "002", "slug": "settings", "title": "Настройки", "kind": "work",
                 "rules": ["А-01", "А-02"], "after": ["001"], "parallel_ok": False,
                 "detail": "full", "steps": steps, "handoff": {"done": "", "stopped_at": ""}},
                {"number": "003", "slug": "stock", "title": "Склад", "kind": "work",
                 "rules": ["B-02"], "after": ["002"], "parallel_ok": False, "detail": "full",
                 "steps": ["@start", "@registry"],
                 "held": [{"rule": "B-02", "waits_for": ["B-04"], "note": "закрытое пояснение"}]},
                {"number": "004", "slug": "gate-slice-0", "title": "Ворота среза 0", "kind": "gate",
                 "rules": [], "after": ["003"], "parallel_ok": False, "detail": "full",
                 "decision_gate": True, "client_does": ["Отвечает на анкету."],
                 "owner_confirms": ["Одно слово: «ФИФО» или «средняя».", "«Давай» на срез 1."],
                 "steps": ["Собрать владельцу один экран"]}]},
            {"slice": 1, "title": "Деньги", "cards": [
                {"number": "005", "slug": "money", "title": "Оплата долга", "kind": "work",
                 "rules": ["Д-01"], "after": ["004"], "parallel_ok": False, "detail": "outline",
                 "summary": "закрытое описание будущей карточки"}]}],
        "carry": [{"rule": "А-01", "slug": "u1-A-01", "home": "002", "parts": ["002", "003"],
                   "what": "002 — поле с историей; 003 — закрытое описание второй части"}],
    }
    (box.dir / "order.json").write_text(json.dumps(order, ensure_ascii=False, indent=1),
                                        encoding="utf-8")
    (box.dir / "cards" / "002-settings.md").write_text(
        "# 002 · Настройки\n\n## Правила (2)\n\nдословный текст — закрытая часть\n\n"
        "## Шаги по порядку\n\n" + "".join(f"- [ ] {i}. шаг {i}\n" for i in range(1, 6))
        + "\n## Записка следующей сессии\n\n<!-- handoff-begin -->\n- Сделано:\n"
        "<!-- handoff-end -->\n", encoding="utf-8")
    box.tests("erp-real.test.ts", [
        'it("u1-A-01: способ оценки без метки карточки", () => {})',
        'it("u1-A-01#002: поле с историей", () => {})',
        'it("u1-A-01#003: работает выбранный способ", () => {})',
        'it("u1-A-02: меню настроек", () => {})',
        'it("u2-B-02: печать листа", () => {})',
        'it("u2-B-05#pre: отказ с сообщением", () => {})'])


def scenario_real(box: Box):
    run = box.run
    plain, p002, p003 = ("u1-A-01: способ оценки без метки карточки", "u1-A-01#002: поле с историей",
                         "u1-A-01#003: работает выбранный способ")
    a02, b02, b05p = "u1-A-02: меню настроек", "u2-B-02: печать листа", "u2-B-05#pre: отказ с сообщением"
    names = [plain, p002, a02, b02, b05p]
    # документ, по которому собран реестр: его хэш записан в закрытом реестре
    doc = box.home / "reports" / "v6" / "arch.md"
    doc.parent.mkdir(parents=True)
    doc.write_text("# Архитектура\n\nправила\n", encoding="utf-8")
    box.edit_reg(lambda _, data: data["meta"].update(
        source={"arch": "reports/v6/arch.md", "arch_sha256": sha(doc.read_text(encoding="utf-8"))}))

    rc, out = run("next_card.py")
    check("настоящий формат (срезы, номера 001…): выдаётся карточка 001, шаги «@имя» развёрнуты",
          rc == 0 and "КАРТОЧКА 001 " in out and "Старт. Прочитать карточку" in out
          and "erp/001-client-sample" in out and "свидетельством" in out, out)
    rc, out = run("check_progress.py")
    check("«досмотреть» вне карточек и неразложенный срез 6 — не ошибка порядка",
          rc == 0 and "срез 6 ещё не разложен" in out, out)

    # --- документ изменили, а реестр не пересобрали
    doc.write_text("# Архитектура\n\nправила, одно переписано\n", encoding="utf-8")
    rc, out = run("next_card.py")
    rc2, out2 = run("next_card.py", "--take", "erp/001-client-sample")
    rc3, out3 = run("status.py")
    rc4, out4 = run("export_public.py", "--to", str(box.root / "early"), "--dry-run")
    check("документ изменился после сборки реестра: карточку не выдают и не дают взять, названа "
          "цепочка пересборки; экран владельца предупреждает; выкладка отказывает",
          rc == 1 and "документ изменился" in out and "build_registry.py → сверка order.json → build_cards.py --reviewed" in out
          and "export_public.py" in out and rc2 == 1 and rc3 == 0 and "изменился после сборки" in out3
          and rc4 == 1, out + out2 + out3 + out4)
    box.edit_reg(lambda _, data: data["meta"]["source"].update(
        arch_sha256=sha(doc.read_text(encoding="utf-8"))))  # как сделает build_registry.py
    (box.dir / "tools").mkdir()
    (box.dir / "tools" / "build_cards.py").write_text(
        "import sys\nprint('УСТАРЕЛ: reports/exec/cards/002-settings.md — запустить build_cards.py')\n"
        "sys.exit(1)\n", encoding="utf-8")
    rc, out = run("next_card.py")
    check("реестр пересобран, а карточки нет (build_cards.py --check красный): карточку не выдают — "
          "в файле мог остаться прежний текст правила",
          rc == 1 and "файлы карточек устарели" in out, out)
    shutil.rmtree(box.dir / "tools")
    rc, out = run("next_card.py")
    check("реестр и карточки пересобраны — работа продолжается", rc == 0 and "КАРТОЧКА 001 " in out, out)

    run("next_card.py", "--take", "erp/001-client-sample")
    for n in ("1", "2", "3"):
        run("mark.py", "step", "1", n)  # «1» вместо «001» тоже понимается
    ev = box.root / "answer.txt"
    ev.write_text("снимок окна загрузки получен\n", encoding="utf-8")
    rc, out = run("mark.py", "rule", "u4-D-9.1", "--evidence", str(ev), "--words", "принимаю")
    rc2, out2 = run("mark.py", "rule", "u4-D-9.1", "--evidence", str(ev), "--by", "Рашад")
    rc3, out3 = run("mark.py", "rule", "u4-D-9.1", "--evidence", str(ev), "--by", "Рашад",
                    "--words", "файл загрузился, принимаю")
    check("правило из evidence_rules закрывается свидетельством — только с именем принявшего и его "
          "дословными словами",
          rc == 1 and rc2 == 1 and "дословные слова" in out2 and rc3 == 0
          and box.rule("u4-D-9.1")["done"]["kind"] == "evidence"
          and box.rule("u4-D-9.1")["done"]["words"] == "файл загрузился, принимаю", out + out2 + out3)
    base_ev = box.copy("base_ev")
    bad = box.copy("badev")
    box.edit_reg(lambda by, _: by["u4-D-9.1"]["done"].pop("words"), dir=bad)
    rc, out = run("check_progress.py", dir=bad)
    bad = box.copy("badev2")
    box.edit_reg(lambda by, _: by["u4-D-9.1"]["done"].update(by="Другой человек"), dir=bad)
    rc2, out2 = run("check_progress.py", "--base-dir", str(base_ev), dir=bad)
    bad = box.copy("badev3")
    box.edit_reg(lambda by, _: (by["u4-D-9.1"].pop("done"), by["u4-D-9.1"].update(status="in_progress")),
                 dir=bad)
    rc3, out3 = run("check_progress.py", "--base-dir", str(base_ev), dir=bad)
    check("check_progress краснеет на свидетельстве без слов владельца, а свидетельство, попавшее в "
          "main, нельзя ни изменить, ни стереть",
          rc == 1 and "без слов владельца" in out and rc2 == 1 and "свидетельство из main" in out2
          and rc3 == 1 and "свидетельство из main" in out3, out + out2 + out3)

    # --- лазейка перепроверки: стереть свидетельство из main, прикрывшись вопросом или новым хэшем
    def wipe(by):
        by["u4-D-9.1"].pop("done")
        by["u4-D-9.1"]["status"] = "not_started"

    bad = box.copy("badev4")
    box.edit_reg(lambda by, _: (wipe(by), by["u4-D-9.1"].update(problem={
        "kind": "no_data", "hash": by["u4-D-9.1"]["text_hash"], "date": TODAY, "card": "001"})), dir=bad)
    rc, out = run("check_progress.py", "--base-dir", str(base_ev), dir=bad)
    check("свидетельство из main стёрто, а по правилу руками вписан вопрос — красный: вопрос записи "
          "владельца не отменяет", rc == 1 and "свидетельство из main" in out, out)
    bad = box.copy("badev5")
    box.edit_reg(lambda by, _: (wipe(by), by["u4-D-9.1"].update(text_hash="0" * 64)), dir=bad)
    rc, out = run("check_progress.py", "--base-dir", str(base_ev), dir=bad)
    rc2, out2 = run("check_progress.py", "--base-dir", str(base_ev), "--branch", "erp-docs/2026-10-09",
                    dir=bad)
    check("свидетельство из main стёрто, а хэш правила подменён — красный: вне ветки erp-docs/… хэш "
          "не меняется, а и в ней свидетельство обязано остаться в журнале",
          rc == 1 and "свидетельство из main" in out and "вне ветки erp-docs/" in out
          and rc2 == 1 and "свидетельство из main" in out2 and "вне ветки erp-docs/" not in out2,
          out + out2)
    # законный путь: вопрос по правилу со свидетельством — отметка уходит, запись владельца остаётся
    rc, out = run("mark.py", "problem", "u4-D-9.1", "--kind", "no_data", "--text",
                  "Клиент прислал второй файл: какой из двух считать пробой — нужен ответ владельца.")
    r = box.rule("u4-D-9.1")
    rc2, out2 = run("check_progress.py", "--base-dir", str(base_ev))
    check("вопрос по правилу со свидетельством (mark.py problem): отметка снята, запись владельца "
          "перенесена в журнал evidence_log — сравнение с main зелёное",
          rc == 0 and "done" not in r and r["status"] == "not_started" and rc2 == 0
          and [k["words"] for k in r.get("evidence_log") or []] == ["файл загрузился, принимаю"],
          out + out2)
    run("mark.py", "problem", "u4-D-9.1", "--clear", "--by", "Рашад", "--words", "считать первый файл")
    rc, out = run("mark.py", "rule", "u4-D-9.1", "--evidence", str(ev), "--by", "Рашад",
                  "--words", "первый файл, принимаю")
    r = box.rule("u4-D-9.1")
    rc2, out2 = run("check_progress.py", "--base-dir", str(base_ev))
    check("ответ владельца записан, свидетельство принято заново: новое — в отметке, прежнее — в "
          "журнале; сравнение с main зелёное",
          rc == 0 and r["done"]["words"] == "первый файл, принимаю" and len(r["evidence_log"]) == 1
          and r["problem_cleared"]["words"] == "считать первый файл" and rc2 == 0, out + out2)
    # документ изменили: сброс по новому хэшу записей владельца не стирает
    base_ev2 = box.copy("base_ev2")
    docs = box.copy("docev")
    box.edit_reg(lambda by, _: by["u4-D-9.1"].update(text_hash="0" * 64), dir=docs)
    rc, out = run("mark.py", "sync", dir=docs)
    r = box.rule("u4-D-9.1", dir=docs)
    rc2, out2 = run("check_progress.py", "--base-dir", str(base_ev2), "--branch",
                    "erp-docs/2026-10-09", dir=docs)
    rc3, out3 = run("check_progress.py", "--base-dir", str(base_ev2), "--branch",
                    "erp/001-client-sample", dir=docs)
    check("текст правила со свидетельством изменился (mark.py sync): отметка и ответ на вопрос "
          "сброшены, обе записи владельца целы в журналах; в ветке erp-docs/… сравнение с main "
          "зелёное, в любой другой ветке новый хэш — красный",
          "СБРОШЕНО: u4-D-9.1" in out and "done" not in r and "problem_cleared" not in r
          and len(r.get("evidence_log") or []) == 2 and len(r.get("problem_cleared_log") or []) == 1
          and rc2 == 0 and rc3 == 1 and "вне ветки erp-docs/" in out3, out + out2 + out3)
    run("mark.py", "note", "001", "--text", "сделано: файл отправлен, ответ получен; мешает: ничего")
    b2 = "erp/002-settings"
    rc, out = run("next_card.py", "--take", b2)
    check("карточка 001 закрыта, берётся 002", rc == 0 and "ВЗЯТА: карточка 002" in out, out)
    green = box.ci(b2, green=names)
    rc, out = run("mark.py", "rule", "u1-A-02", "--evidence", str(ev), "--by", "Рашад", "--words", "принимаю")
    check("обычное правило свидетельством не закрывается", rc == 1 and "evidence_rules" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", box.ci(b2, green=[plain]))
    check("правило с продолжением: тест без метки карточки часть не закрывает",
          rc == 1 and "u1-A-01#002" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", green)
    check("правило с продолжением: отмечена часть карточки 002, «сделано» ещё нет",
          rc == 0 and "ОТМЕЧЕНА ЧАСТЬ" in out and box.rule("u1-A-01")["status"] != "done"
          and "002" in box.rule("u1-A-01")["parts_done"], out)
    run("mark.py", "rule", "u1-A-02", "--run", green)
    rc, out = run("mark.py", "prelook", "u2-B-05", "--run", green, "--card", "002")
    check("«досмотреть» вне карточек: поведение «до просмотра» отмечается в своей карточке",
          rc == 0 and box.rule("u2-B-05")["status"] == "blocked_to_look", out)
    rc, out = run("mark.py", "rule", "u2-B-04", "--run", green)
    check("«досмотреть» вне карточек отметить сделанным нельзя", rc == 1 and "досмотреть" in out, out)
    for n in range(1, 6):
        run("mark.py", "step", "002", str(n))
    rc, out = run("mark.py", "note", "002", "--text", "сделано: настройки; остановился на: —; мешает: —")
    card_md = (box.dir / "cards" / "002-settings.md").read_text(encoding="utf-8")
    check("карточка 002 закрыта с частью правила; галочки и записка попали в файл карточки",
          "КАРТОЧКА 002 ЗАКРЫТА" in out and card_md.count("- [x]") == 5
          and "сделано: настройки" in card_md
          and card_md.index("сделано: настройки") < card_md.index("<!-- handoff-end -->"), out)
    rc, out = run("check_progress.py", "--branch", b2)
    rc2, out2 = run("check_progress.py", "--branch", b2, "--tests-report",
                    box.report("real_ok.json", green=[p002, a02, b05p]))
    rc3, out3 = run("check_progress.py", "--branch", b2, "--tests-report",
                    box.report("real_bad.json", green=[plain, a02, b05p]))
    check("check_progress: часть правила подтверждена тестом с меткой карточки — в дереве и в отчёте "
          "прогона; тест без метки часть не подтверждает",
          rc == 0 and rc2 == 0 and rc3 == 1 and "u1-A-01#002" in out3, out + out2 + out3)
    b3 = "erp/003-stock"
    run("next_card.py", "--take", b3)
    # сессия оборвалась посреди карточки: записка — единственное, что получит следующая
    run("mark.py", "step", "003", "1")
    run("mark.py", "note", "003", "--text", "сделано: старт; остановился на: шаг 2, печать листа; "
        "мешает: красная проверка GitHub", "--blocked", "ci", "--blocked-rules", "u2-B-02")
    rc, out = run("next_card.py", branch=b3)
    shutil.copytree(box.home / "reports", box.root / "alt" / "reports",
                    ignore=shutil.ignore_patterns("notes"))
    bare = box.root / "alt" / "reports" / "exec"       # закрытая папка без записок
    rc2, out2 = run("next_card.py", branch=b3, private=bare)
    check("оборванная сессия: следующая получает ту же карточку, сводку записки из состояния "
          "(шаги, правила, что мешает) и полный текст из закрытой папки; нет текста — "
          "команда говорит об этом, а не молчит",
          rc == 0 and "КАРТОЧКА 003 " in out and "продолжение" in out
          and "шаги сделаны: 1; следующий шаг: 2" in out and "мешает: ci (u2-B-02)" in out
          and "остановился на: шаг 2, печать листа" in out
          and rc2 == 0 and "записка отмечена, а её текста" in out2, out + out2)
    rc, out = run("mark.py", "rule", "u2-B-02", "--run", box.ci(b3, green=names))
    check("правило из held ждёт просмотра другого правила — отметить нельзя",
          rc == 1 and "ждёт просмотра" in out, out)
    rc, out = run("mark.py", "rule", "u1-A-01", "--run", box.ci(b3, green=[p003]))
    check("последняя часть отмечена — правило с продолжением стало «сделано»",
          rc == 0 and "СДЕЛАНО: u1-A-01" in out and box.rule("u1-A-01")["status"] == "done", out)
    rc0, out0 = run("mark.py", "step", "003", "2")
    rc, out = run("mark.py", "note", "003", "--text", "сделано: склад; B-02 ждёт просмотра B-04")
    check("записка с середины карточки её не закрывает: после последнего шага нужна итоговая; "
          "карточка 003 закрывается, правило из held остаётся открытым",
          "пока открыта" in out0 and "итоговая записка" in out0
          and "КАРТОЧКА 003 ЗАКРЫТА" in out and "u2-B-02" in out, out0 + out)
    rc, out = run("next_card.py")
    check("ворота без поля who: подтверждают клиент и владелец (client_does, owner_confirms)",
          rc == 2 and "клиент, владелец" in out and "u2-B-02" in out, out)
    run("mark.py", "gate", "004", "--role", "client", "--by", "Клиент: главбух", "--date", TODAY,
        "--words", "ответил на анкету; ответы — client/answers/anketa.md")
    rc, out = run("mark.py", "gate", "004", "--role", "owner", "--by", "Рашад", "--date", TODAY)
    rc2, out2 = run("mark.py", "gate", "004", "--role", "owner", "--by", "Рашад", "--date", TODAY,
                    "--words", "средняя; давай")
    check("ворота-решение не закрываются без слов решения владельца",
          rc == 1 and rc2 == 0 and "ВОРОТА 004 ЗАКРЫТЫ" in out2 and "«средняя; давай»" in out2,
          out + out2)
    rc, out = run("next_card.py")
    rc2, out2 = run("next_card.py", "--take", "erp/005-money")
    check("следующая карточка только намечена (outline): её не выдают и взять нельзя",
          rc == 5 and "НЕ РАСПИСАНА" in out and rc2 == 1, out + out2)
    h = box.text("u1-A-01", "А-01", "Способ оценки запасов: ДВА поля с историей", "как в 1С")
    box.edit_reg(lambda by, _: by["u1-A-01"].update(text_hash=h))
    rc, out = run("mark.py", "sync")
    rc2, out2 = run("next_card.py")
    check("текст правила с продолжением изменился: сброшены все части, открыты обе карточки, "
          "выдаётся первая из них",
          "часть карточки 002" in out and "часть карточки 003" in out
          and "КАРТОЧКА 002 СНОВА ОТКРЫТА" in out and "КАРТОЧКА 003 СНОВА ОТКРЫТА" in out
          and rc2 == 0 and "КАРТОЧКА 002 " in out2, out + out2)
    # правило вышло из «досмотреть»: документ исправили, пометка сменилась, правило вписали в карточку
    h4 = box.text("u2-B-04", "B-04", "Состав листа: шапка, таблица, подписи", "как в 1С")
    box.edit_reg(lambda by, _: by["u2-B-04"].update(  # как сделает build_registry.py
        text_hash=h4, mark="as_1c", pre_look_behavior=False, status="not_started"))
    rc, out = run("check_progress.py")
    rc2, out2 = run("next_card.py")
    o = json.loads((box.dir / "order.json").read_text(encoding="utf-8"))
    o["slices"][0]["cards"][2]["rules"].append("B-04")
    (box.dir / "order.json").write_text(json.dumps(o, ensure_ascii=False, indent=1), encoding="utf-8")
    rc3, out3 = run("check_progress.py")
    rc4, out4 = run("next_card.py")
    check("правило вышло из «досмотреть»: пока его не вписали в карточку, проверка красная "
          "(забыть его нельзя); вписали в карточку 003 — порядок цел, карточка с ним открыта",
          rc == 1 and "u2-B-04" in out and "ни в одну карточку" in out and rc3 == 0 and rc4 == 0
          and not box.prog()["cards"]["003"].get("closed"), out + out2 + out3 + out4)
    pub = box.root / "public"
    rc, out = run("export_public.py", "--to", str(pub))
    blob = "".join(p.read_text(encoding="utf-8") for p in pub.rglob("*.json"))
    leak = [w for w in ("закрыт", "Старт. Прочитать", "common", "handoff", "client_does",
                        "owner_confirms", "второй части", "сделано: настройки", "arch.md") if w in blob]
    rc2, out2 = run("next_card.py", dir=pub, private=box.dir)
    rc3, out3 = run("next_card.py", dir=pub)
    check("выкладка настоящего формата: плоский порядок без шагов, пояснений и записок; команды в "
          "репозитории читают его вместе с закрытой папкой, без неё карточку не выдают",
          rc == 0 and not leak and rc2 == 0 and "КАРТОЧКА 002 " in out2
          and rc3 == 1 and "нет закрытой папки" in out3, out + str(leak) + out2 + out3)
    # выкладка документа: правило со свидетельством получило новый текст, другое ушло из документа
    rec = {"hash": "a" * 64, "date": TODAY, "by": "Рашад", "words": "принимаю как есть"}
    box.edit_reg(lambda _, data: data["rules"].append({
        "id": "X-1", "slug": "u9-X-1", "title": "правило, которого больше нет", "mark": "as_1c",
        "slice": 0, "text_hash": "a" * 64, "status": "done",
        "done": dict(rec, kind="evidence", card="001", evidence_sha="b" * 64),
        "problem_cleared": dict(rec, words="оставить как было")}), dir=pub)
    base_gone = box.root / "base_gone"
    shutil.copytree(pub, base_gone)
    h9 = box.text("u4-D-9.1", "D-9.1", "Проба загрузки ДВУХ файлов у клиента", "как в 1С")
    box.edit_reg(lambda by, _: by["u4-D-9.1"].update(text_hash=h9))
    rc, out = run("export_public.py", "--to", str(pub))
    preg, r = box.reg(pub), box.rule("u4-D-9.1", dir=pub)
    gone = (preg.get("retired") or {}).get("u9-X-1") or {}
    rc2, out2 = run("check_progress.py", "--base-dir", str(base_gone), "--branch",
                    "erp-docs/2026-10-09", dir=pub)
    bad = box.root / "bad_gone"
    shutil.copytree(pub, bad)
    box.edit_reg(lambda _, data: data.pop("retired"), dir=bad)
    rc3, out3 = run("check_progress.py", "--base-dir", str(base_gone), "--branch",
                    "erp-docs/2026-10-09", dir=bad)
    check("выкладка документа (export_public): у правила с новым текстом свидетельства и ответ "
          "владельца ушли в журналы; у правила, ушедшего из документа, — в раздел retired; "
          "сравнение с main зелёное, а стёртый retired — красный",
          rc == 0 and "done" not in r and len(r.get("evidence_log") or []) == 2
          and len(r.get("problem_cleared_log") or []) == 1
          and [k["words"] for k in gone.get("evidence_log") or []] == ["принимаю как есть"]
          and [k["words"] for k in gone.get("problem_cleared_log") or []] == ["оставить как было"]
          and rc2 == 0 and rc3 == 1 and "u9-X-1: свидетельство из main" in out3
          and "u9-X-1: запись о снятом вопросе из main" in out3, out + out2 + out3)
    box.edit_reg(lambda by, _: by["u1-A-02"].update(text_hash="f" * 64))
    rc, out = run("next_card.py", dir=pub, private=box.dir)
    check("закрытый реестр пересобран, а в репозиторий не выложен: карточку не выдают",
          rc == 1 and "открытый нет" in out and "export_public.py" in out, out)


def scenario_git(box: Box):
    """Состояние в репозитории (как после карточки 001), настоящий origin и две рабочие копии:
    отставшее дерево, взятие без пуша, одна карточка у двух сессий, прогон не той ветки."""
    run = box.run
    origin, a, b = box.root / "origin.git", box.repo, box.root / "repo-b"
    state = a / "scripts" / "erp"
    if not (shutil.which("git") and git_at(box.root, "init", "-q", "--bare", str(origin))):
        check("настоящий git недоступен — проверки с origin НЕ ВЫПОЛНЕНЫ", False)
        return
    rc, out = run("export_public.py", "--to", str(state))
    box.git("init", "-q")
    box.git("add", "-A")
    box.git("commit", "-q", "-m", "erp: состояние в репозитории")
    box.git("branch", "-M", "main")
    box.git("remote", "add", "origin", str(origin))
    ok = box.git("push", "-q", "-u", "origin", "main")
    git_at(box.root, "clone", "-q", str(origin), str(b))
    check("подготовка: состояние выложено в scripts/erp, запушено, вторая рабочая копия склонирована",
          rc == 0 and ok and (b / "scripts" / "erp" / "registry.json").exists(), out)

    def in_a(tool, *args, **kw):
        kw.setdefault("dir", state)
        return run(tool, *args, repo=a, private=box.dir, git=True, **kw)

    def in_b(tool, *args, **kw):
        return run(tool, *args, dir=b / "scripts" / "erp", repo=b, private=box.dir, git=True, **kw)

    b1 = "erp/1-setup"
    git_at(b, "switch", "-q", "-c", b1, "origin/main")       # сессия Б создала ветку заранее
    box.git("switch", "-q", "-c", b1, "origin/main")
    rc, out = in_a("next_card.py")
    check("из свежей ветки от origin/main карточка выдаётся", rc == 0 and "КАРТОЧКА 1 " in out, out)
    # main ушёл вперёд (чужой PR смержен), а дерево сессии А осталось прежним
    git_at(b, "switch", "-q", "main")
    (b / "README.md").write_text("чужой PR\n", encoding="utf-8")
    git_at(b, "add", "-A"); git_at(b, "commit", "-q", "-m", "чужой PR"); git_at(b, "push", "-q", "origin", "main")
    rc, out = in_a("next_card.py")
    rc2, out2 = in_a("next_card.py", "--take", b1)
    rc3, out3 = in_a("status.py")
    check("дерево отстало от origin/main: команда сама делает fetch и карточку не выдаёт и не даёт взять; "
          "экран владельца предупреждает",
          rc == 1 and "отстало от origin/main" in out and rc2 == 1 and rc3 == 0 and "отстало" in out3,
          out + out2 + out3)
    box.git("merge", "-q", "--no-edit", "origin/main")
    box.git("switch", "-q", "main"); box.git("merge", "-q", "--ff-only", "origin/main")
    rc, out = in_a("next_card.py", "--take", b1)
    box.git("switch", "-q", b1)
    check("взять карточку можно только стоя в её ветке", rc == 1 and "берётся из её ветки" in out, out)
    rc, out = in_a("next_card.py", "--take", b1)
    rc2, out2 = in_a("mark.py", "step", "1", "1")
    check("карточка взята, но не запушена: команда велит пушить сейчас же, а отметок не принимает",
          rc == 0 and "СЕЙЧАС ЖЕ" in out and "git push -u origin erp/1-setup" in out
          and rc2 == 1 and "взятие не на GitHub" in out2, out + out2)
    box.git("add", "-A"); box.git("commit", "-q", "-m", "erp 1: взята")
    ok = box.git("push", "-q", "-u", "origin", b1)
    rc, out = in_a("mark.py", "step", "1", "1")
    check("взятие запушено — отметки принимаются", ok and rc == 0 and "ОТМЕЧЕН шаг 1" in out, out)
    # сессия Б: у неё местная ветка той же карточки, созданная до пуша сессии А
    git_at(b, "switch", "-q", b1); git_at(b, "merge", "-q", "--no-edit", "origin/main")
    rc, out = in_b("next_card.py", "--take", b1)
    git_at(b, "switch", "-q", "main"); git_at(b, "merge", "-q", "--ff-only", "origin/main")
    rc2, out2 = in_b("next_card.py")
    check("вторая сессия в другой рабочей копии ту же карточку не получает: ветка уже на GitHub",
          rc == 1 and "уже есть на GitHub" in out and rc2 == 3 and "занята веткой erp/1-setup" in out2
          and not (b / "scripts" / "erp" / "progress").exists(), out + out2)
    rc, out = in_a("next_card.py", dir=box.dir)
    check("по старой копии состояния в закрытой папке карточку уже не выдают",
          rc == 1 and "устарела" in out, out)
    # прогон должен быть этой ветки и по коммиту, который в ней есть; тест после прогона не менять
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(a), capture_output=True, text=True).stdout.strip()
    rc, out = in_a("mark.py", "rule", "u1-A-01", "--run", box.ci(b1, green=ALL, head="a" * 40))
    rc2, out2 = in_a("mark.py", "rule", "u1-A-01", "--run", box.ci(b1, green=ALL, head=head))
    check("прогон по коммиту, которого нет в ветке, отметку не даёт; по своему коммиту — даёт",
          rc == 1 and "нет в этой ветке" in out and rc2 == 0, out + out2)
    box.tests("erp-setup.test.ts", [ln.replace("порядок настройки", "порядок настройки, правка") for ln in SETUP_ON])
    rc, out = in_a("mark.py", "rule", "u1-A-02", "--run", box.ci(b1, green=ALL, head=head))
    check("тест правила изменили после прогона — нужен новый прогон",
          rc == 1 and "менялся после прогона" in out, out)
    rc, out = in_a("check_progress.py", "--branch", b1, "--base-ref", "origin/main")
    check("check_progress как в GitHub: ветка карточки, база — origin/main", rc == 0, out)

    # --- ветка, влитая в main без удаления, переоткрытую карточку не держит
    box.git("add", "-A"); box.git("commit", "-q", "-m", "erp 1: тест правила А-02")
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(a), capture_output=True, text=True).stdout.strip()
    in_a("mark.py", "rule", "u1-A-02", "--run", box.ci(b1, green=ALL, head=head))
    in_a("mark.py", "step", "1", "2")
    rc, out = in_a("mark.py", "note", "1", "--text", "сделано: настройки; остановился на: —; мешает: —")
    box.git("add", "-A"); box.git("commit", "-q", "-m", "erp 1: закрыта"); box.git("push", "-q", "origin", b1)
    box.git("switch", "-q", "main"); box.git("merge", "-q", "--ff-only", "origin/main")
    ok = box.git("merge", "-q", "--no-ff", "--no-edit", b1) and box.git("push", "-q", "origin", "main")
    box.git("switch", "-q", "--detach", "origin/main")
    rc2, out2 = in_a("next_card.py")
    check("карточка 1 закрыта и влита в main (ветка на GitHub осталась): очередь идёт дальше, к карточке 2",
          "КАРТОЧКА 1 ЗАКРЫТА" in out and ok and rc2 == 0 and "КАРТОЧКА 2 " in out2, out + out2)
    # --- чужой PR, открытый ДО того, как карточку 1 смержили: base.sha в событии GitHub — старый
    #     main, а проверяется коммит слияния его ветки с нынешним main (как refs/pull/N/merge)
    old_main = subprocess.run(["git", "rev-parse", "main"], cwd=str(b), capture_output=True,
                              text=True).stdout.strip()
    wf_ok = box.root / "pr-checks-foreign.yml"
    wf_ok.write_text(WORKFLOW_OK, encoding="utf-8")
    git_at(b, "fetch", "-q", "origin")
    git_at(b, "switch", "-q", "-c", "claude/foreign", old_main)
    (b / "NOTES.md").write_text("чужая правка, scripts/erp не тронут\n", encoding="utf-8")
    git_at(b, "add", "NOTES.md"); git_at(b, "commit", "-q", "-m", "чужой PR: правка вне scripts/erp")
    git_at(b, "switch", "-q", "--detach", "origin/main")
    merged = git_at(b, "merge", "-q", "--no-ff", "--no-edit", "claude/foreign")
    ci = {"GITHUB_ACTIONS": "true"}
    rc, out = in_b("check_progress.py", "--branch", "claude/foreign", "--base-ref", old_main,
                   "--workflow", str(wf_ok), env=ci)
    check("чужой PR со старым base.sha (открыт до мержа карточки 1): отметки, пришедшие из main, ему "
          "в вину не ставятся — зелёный",
          merged and old_main and rc == 0 and "в порядке" in out, out)
    # тот же чужой PR сам ставит отметку — красный: сравнение с main не ослеплено
    git_at(b, "switch", "-q", "claude/foreign")
    git_at(b, "merge", "-q", "--no-edit", "origin/main")
    fstate = b / "scripts" / "erp"
    h10 = box.rule("u2-B-1.10", fstate)["text_hash"]
    box.edit_reg(lambda by, _: by["u2-B-1.10"].update(
        status="done", done={"hash": h10, "date": TODAY, "kind": "tests", "card": "2"}), dir=fstate)
    git_at(b, "commit", "-q", "-am", "чужой PR: отметка руками")
    git_at(b, "switch", "-q", "--detach", "origin/main")
    merged = git_at(b, "merge", "-q", "--no-ff", "--no-edit", "claude/foreign")
    rc, out = in_b("check_progress.py", "--branch", "claude/foreign", "--base-ref", old_main,
                   "--workflow", str(wf_ok), env=ci)
    check("…а отметка, поставленная самим чужим PR, по-прежнему красная",
          merged and rc == 1 and "u2-B-1.10: новая отметка поставлена вне" in out
          and "u1-A-01: новая отметка" not in out, out)
    # --- состояние в main оказалось неисправным (здесь: хэш отметки А-01 не тот). Чужой PR,
    #     который scripts/erp не менял, за это не отвечает; ветка карточки и PR, менявший
    #     scripts/erp, — отвечают
    def rev(name):
        return subprocess.run(["git", "rev-parse", name], cwd=str(b), capture_output=True,
                              text=True).stdout.strip()

    def pr_merge(base, name, path, body):
        """Коммит слияния, как refs/pull/N/merge: первый родитель — base, второй — ветка PR."""
        git_at(b, "switch", "-q", "-c", name, old_main)
        (b / path).parent.mkdir(parents=True, exist_ok=True)
        (b / path).write_text(body, encoding="utf-8")
        git_at(b, "add", path); git_at(b, "commit", "-q", "-m", f"{name}: правка")
        git_at(b, "switch", "-q", "--detach", base)
        return git_at(b, "merge", "-q", "--no-ff", "--no-edit", name)

    git_at(b, "switch", "-q", "--detach", "origin/main")
    box.edit_reg(lambda by, _: by["u1-A-01"]["done"].update(hash="0" * 64), dir=fstate)
    git_at(b, "commit", "-q", "-am", "main: состояние неисправно")
    broken = rev("HEAD")
    ok1 = pr_merge(broken, "claude/other", "OTHER.md", "чужая правка\n")
    rc, out = in_b("check_progress.py", "--branch", "claude/other", "--base-ref", broken,
                   "--workflow", str(wf_ok), env=ci)
    rc2, out2 = in_b("check_progress.py", "--branch", "erp/2-stock", "--base-ref", broken,
                     "--workflow", str(wf_ok), env=ci)
    rc3, out3 = in_b("check_progress.py", "--base-ref", broken, "--workflow", str(wf_ok), env=ci)
    check("состояние в main неисправно: чужой PR, не менявший scripts/erp, не задержан (код 0, "
          "предупреждение с причиной); ветка карточки и запуск без имени ветки — красные",
          ok1 and rc == 0 and "не задержан" in out and "::warning" in out and "u1-A-01" in out
          and rc2 == 1 and "ОШИБКА: правило u1-A-01" in out2 and rc3 == 1, out + out2 + out3)
    rep_ok = box.report("r_foreign_ok.json", green=ALL)
    rep_red = box.report("r_foreign_red.json", green=[A01], red=[A02])
    rc, out = in_b("check_progress.py", "--branch", "claude/other", "--tests-report", rep_ok,
                   "--workflow", str(wf_ok))
    rc2, out2 = in_b("check_progress.py", "--branch", "claude/other", "--tests-report", rep_red,
                     "--workflow", str(wf_ok))
    rc3, out3 = in_b("check_progress.py", "--branch", "erp/2-stock", "--tests-report", rep_ok,
                     "--workflow", str(wf_ok))
    rc4, out4 = in_b("check_progress.py", "--branch", "claude/other", "--tests-report",
                     str(box.root / "no-such-report.json"), "--workflow", str(wf_ok))
    check("шаг static-checks у чужой ветки: неисправное состояние main не задерживает, а красный "
          "тест сделанного правила и отсутствие отчёта — задерживают; ветка карточки — строго",
          rc == 0 and "pr-scope" in out and rc2 == 1 and "u1-A-02" in out2 and "красный" in out2
          and rc3 == 1 and rc4 == 1 and "нет отчёта" in out4, out + out2 + out3 + out4)
    ok2 = pr_merge(broken, "claude/touch", "scripts/erp/NOTE.txt", "правка внутри scripts/erp\n")
    rc, out = in_b("check_progress.py", "--branch", "claude/touch", "--base-ref", broken,
                   "--workflow", str(wf_ok), env=ci)
    check("…а чужой PR, менявший scripts/erp, проверяется строго — красный",
          ok2 and rc == 1 and "ОШИБКА: правило u1-A-01" in out and "не задержан" not in out, out)
    # состояние не читается вовсе (registry.json — не JSON): чужой PR всё равно не задержан
    git_at(b, "switch", "-q", "--detach", broken)
    (fstate / "registry.json").write_text("{ это не JSON", encoding="utf-8")
    git_at(b, "commit", "-q", "-am", "main: реестр не читается")
    unread = rev("HEAD")
    ok3 = pr_merge(unread, "claude/third", "THIRD.md", "чужая правка\n")
    rc, out = in_b("check_progress.py", "--branch", "claude/third", "--base-ref", unread,
                   "--workflow", str(wf_ok), env=ci)
    rc2, out2 = in_b("check_progress.py", "--branch", "erp/2-stock", "--base-ref", unread,
                     "--workflow", str(wf_ok), env=ci)
    check("реестр в main не читается: чужой PR не задержан, ветка карточки падает — проверка не "
          "зелёная на собственном сбое",
          ok3 and rc == 0 and "не задержан" in out and rc2 != 0, out + out2)
    git_at(b, "switch", "-q", "main")
    # документ изменили: текст правила А-01 другой, реестр пересобран и выложен в main
    h = box.text("u1-A-01", "А-01", "Меню настроек учёта состоит из СЕМИ пунктов", "как в 1С")
    box.edit_reg(lambda by, _: by["u1-A-01"].update(text_hash=h))
    box.edit_reg(lambda by, _: by["u1-A-01"].update(text_hash=h), dir=state)
    box.git("switch", "-q", "main"); box.git("merge", "-q", "--ff-only", "origin/main")
    box.edit_reg(lambda by, _: by["u1-A-01"].update(text_hash=h), dir=state)
    box.git("commit", "-q", "-am", "erp-docs: текст А-01"); box.git("push", "-q", "origin", "main")
    box.git("switch", "-q", "--detach", "origin/main")
    rc, out = in_a("next_card.py")
    rc2, out2 = in_a("status.py")
    check("документ изменили — карточка 1 открыта снова; её прежняя ветка влита в origin/main и "
          "занятостью не считается: карточку выдают и велят удалить влитую ветку; экран называет её",
          rc == 0 and "КАРТОЧКА 1 " in out and "занята" not in out.split("Шаги")[0]
          and "уже влита в origin/main" in out and "git push origin --delete erp/1-setup" in out
          and rc2 == 0 and "ветка erp/1-setup влита в origin/main" in out2, out + out2)
    box.git("push", "-q", "origin", "--delete", b1); box.git("branch", "-q", "-D", b1)
    box.git("switch", "-q", "-c", b1, "origin/main")
    rc, out = in_a("next_card.py", "--take", b1)
    check("влитую ветку удалили, карточку 1 взяли заново той же веткой от свежего main",
          rc == 0 and "КАРТОЧКА 1 СНОВА ОТКРЫТА" in out and "ВЗЯТА: карточка 1" in out, out)
    # невлитая ветка по-прежнему держит карточку
    git_at(b, "fetch", "-q", "origin", "--prune"); git_at(b, "switch", "-q", "--detach", "origin/main")
    box.git("add", "-A"); box.git("commit", "-q", "-m", "erp 1: взята снова"); box.git("push", "-q", "-u", "origin", b1)
    git_at(b, "branch", "-q", "-D", b1)
    rc, out = in_b("next_card.py")
    check("та же ветка с новой, ещё не влитой работой снова держит карточку: вторая сессия её не получает",
          rc == 3 and "занята веткой erp/1-setup" in out, out)


def scenario_tools(root: Path):
    """Вспомогательные команды: пометка отчёта в GitHub, перенос закрытой папки."""
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", ERP_TODAY=TODAY)
    ws = root / "ws"
    (ws / "src" / "__tests__").mkdir(parents=True)
    rep_path = ws / "erp-tests.json"
    e = dict(env, GITHUB_WORKSPACE=str(ws), GITHUB_SHA="m" * 40, HEAD_SHA="h" * 40, GITHUB_RUN_ID="77")

    def ci_report():
        r = subprocess.run([sys.executable, str(TOOLS / "ci_report.py"), str(rep_path)],
                           capture_output=True, text=True, env=e)
        return r.returncode, r.stdout + r.stderr

    rc, out = ci_report()
    stub = json.loads(rep_path.read_text(encoding="utf-8")) if rep_path.exists() else {}
    check("ci_report: тестов правил ещё нет — пишется пустой помеченный отчёт",
          rc == 0 and stub.get("testResults") == [] and stub.get("erp", {}).get("head_sha") == "h" * 40, out)
    rep_path.unlink()
    (ws / "src" / "__tests__" / "erp-a.test.ts").write_text("it('u1-A-01: x', () => {})\n", encoding="utf-8")
    (ws / "src" / "__tests__" / "erp-b.test.ts").write_text("it('u1-A-02: x', () => {})\n", encoding="utf-8")
    rc, out = ci_report()
    rep_path.write_text(json.dumps({"testResults": [{"name": str(ws / "src/__tests__/erp-a.test.ts"),
                                                     "assertionResults": [{"fullName": "u1-A-01: x", "status": "passed"}]}]}),
                        encoding="utf-8")
    rc2, out2 = ci_report()
    check("ci_report: тесты есть, а отчёта нет или в него попали не все файлы — ошибка, а не «зелёный»",
          rc == 1 and "отчёта" in out and rc2 == 1 and "erp-b.test.ts" in out2, out + out2)

    box = Box(root / "t")
    build(box)
    left = [n for n in ("owner_codes.py",) if (TOOLS / n).exists()] + \
           [n for n in ("erp_lib.py", "mark.py", "check_progress.py", "next_card.py", "status.py",
                        "export_public.py")
            if "owner_code" in (TOOLS / n).read_text(encoding="utf-8")]
    check("кодов владельца в командах больше нет: ни файла owner_codes.py, ни проверки кода", not left,
          str(left))

    # перенос закрытой папки: команда работает с той папкой, где лежит сама
    if not (TOOLS / "setup_private.py").exists():
        print("     —  setup_private.py в этой папке нет (она живёт в закрытой папке): перенос здесь "
              "не проверялся и в счёт не идёт")
        return
    src = root / "worktree"
    shutil.copytree(box.home / "reports", src / "reports")
    (src / "research_notes").mkdir()
    (src / "research_notes" / "26.md").write_text("заметка опыта\n", encoding="utf-8")
    shutil.copytree(TOOLS, src / "reports" / "exec" / "tools", ignore=shutil.ignore_patterns("__pycache__"))
    git_at(src, "init", "-q")
    target = root / "erp-private"
    tool = src / "reports" / "exec" / "tools" / "setup_private.py"
    r = subprocess.run([sys.executable, str(tool), "--to", str(src / "inside")], capture_output=True, text=True, env=env)
    r2 = subprocess.run([sys.executable, str(tool), "--to", str(target)], capture_output=True, text=True, env=env)
    new_exec = target / "reports" / "exec"
    log = subprocess.run(["git", "log", "--oneline"], cwd=str(target), capture_output=True, text=True).stdout
    r3 = subprocess.run([sys.executable, str(tool), "--to", str(target)], capture_output=True, text=True, env=env)
    check("setup_private: внутрь рабочей копии не переносит; переносит reports/ и research_notes/ в одно "
          "место под своим git; старую папку помечает «устарела»; второй раз не запускается",
          r.returncode == 1 and "внутри рабочей копии" in r.stdout and L.is_private(new_exec)
          and (target / "research_notes" / "26.md").exists() and len(log.splitlines()) == 1
          and (src / "reports" / "exec" / L.STATE_MOVED).exists() and r3.returncode == 1,
          r.stdout + r2.stdout + r2.stderr + r3.stdout)
    e2 = dict(env, ERP_PRIVATE=str(src / "reports" / "exec"))
    r = subprocess.run([sys.executable, str(TOOLS / "next_card.py"), "--dir", str(src / "reports" / "exec"),
                        "--repo", str(src), "--no-git"], capture_output=True, text=True, env=e2)
    (new_exec / "tools" / "build_cards.py").unlink()  # выдуманный порядок сборщик карточек не читает
    e3 = dict(env, ERP_PRIVATE=str(new_exec))
    r2 = subprocess.run([sys.executable, str(TOOLS / "next_card.py"), "--dir", str(new_exec),
                         "--repo", str(src), "--no-git", "--take", "erp/1-setup"],
                        capture_output=True, text=True, env=e3)
    check("после переноса: по старой папке карточку не выдают, по новой — выдают и дают взять",
          r.returncode == 1 and "устарела" in r.stdout and r2.returncode == 0 and "ВЗЯТА: карточка 1" in r2.stdout,
          r.stdout + r2.stdout + r2.stderr)


def main():
    root = Path(tempfile.mkdtemp(prefix="erp-selftest-"))
    try:
        box = Box(root / "a")
        build(box)
        scenario(box)
        box = Box(root / "b")
        build_real(box)
        scenario_real(box)
        box = Box(root / "c")
        build(box)
        scenario_git(box)
        scenario_tools(root / "d")
    finally:
        shutil.rmtree(root, ignore_errors=True)
    ok = sum(1 for _, good in results if good)
    print(f"selftest: прошло {ok} из {len(results)} проверок"
          + ("" if ok == len(results) else " — ЕСТЬ ОШИБКИ"))
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
