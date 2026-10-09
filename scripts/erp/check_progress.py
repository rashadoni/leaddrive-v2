#!/usr/bin/env python3
"""check_progress — проверка для GitHub: отметки честные, карточка взята по порядку.

Ничего не меняет. Любая ошибка — код возврата 1 и строка «ОШИБКА: …». В GitHub стоит
в двух местах workflow pr-checks.yml (обе строки дословно — в tools/README.md и в карточке 001):
  джоба pr-scope, на каждом PR, в том числе на черновике:
      python3 scripts/erp/check_progress.py --branch "$GITHUB_HEAD_REF" --base-ref "$BASE_SHA" --repo "$GITHUB_WORKSPACE"
  джоба static-checks, после шага тестов правил (он пишет erp-tests.json):
      python3 scripts/erp/check_progress.py --tests-report erp-tests.json --branch "$GITHUB_HEAD_REF" --repo "$GITHUB_WORKSPACE"
В GitHub без базы для сравнения и без отчёта тестов проверка не проходит: молча пропустить
сравнение нельзя.

Что проверяет всегда:
  1. порядок карточек цел: номера не повторяются, «после» указывает на существующие
     карточки с меньшим номером, каждое правило реестра стоит хотя бы в одной карточке
     (кроме «досмотреть», среза later и срезов, которые ещё не разложены по карточкам);
  2. ни одно правило «досмотреть» не отмечено сделанным;
  3. у каждого «сделано»: хэш текста тот же, что был при отметке (иначе текст меняли и
     отметку надо сбросить: mark.py sync); в файлах src/__tests__/erp-*.test.ts есть
     невыключенный тест с номером правила в названии (it.skip, it.todo, describe.skip,
     закомментированный тест, файл *.spec.ts и номер только в имени файла не считаются);
     этот тест не числится красным в test-baseline.json; правило входит в карточку,
     которая взята или закрыта. У правила с продолжением — тест каждой части
     (u2-B-404#015); у правила из evidence_rules — имя принявшего и его слова;
  4. у каждой записи о воротах, свидетельства, снятого вопроса и снятой занятости в
     открытой части есть роль, дата и хэш записи — и нет ни имени, ни слов: они лежат в
     закрытой папке (records/<хэш>.json). Когда закрытая папка доступна (на сервере), хэш
     сверяется с ней: запись есть, не изменена, в ней имя человека и дословные слова; в
     GitHub закрытой папки нет, и там сверяется только открытая часть. У одной ветки не
     две карточки; записка в открытой части — только номера. Что слова сказал владелец,
     машина НЕ проверяет (учётная запись GitHub у него и у сессий одна): защита — пункты
     8–10 и его экран;
  5. в workflow стоят строки, без которых эта проверка молча исчезает.
Если дан отчёт прогона (--tests-report erp-tests.json):
  6. у каждого «сделано», части и «до просмотра» тест с номером имеет в отчёте статус
     passed (пропущенный — ошибка: он не выполнялся) и нет красного.
Если ветка называется erp/<номер>-<slug> (имя — из --branch или GITHUB_HEAD_REF):
  7. такая карточка есть, записана за этой веткой, и это именно та карточка, которую
     выдал бы next_card.py: все «после» закрыты, ворота перед ней закрыты, карточки с
     меньшим номером закрыты или заняты другими ветками при разрешённой параллели.
Если дано, с чем сравнивать (--base-ref <коммит main> или --base-dir <папка>). База: если
HEAD — коммит слияния с двумя родителями и первый родитель лежит в origin/main (так GitHub
собирает refs/pull/N/merge), базой служит он, что бы ни стояло в base.sha события: base.sha
отстаёт у старого PR, а у PR, открытого поверх чужой ветки, вообще не коммит main. Иначе
база — --base-ref, если это коммит из истории origin/main. Иначе надёжной базы нет: ветка
erp/… и erp-docs/… красная, чужая ветка не задерживается (см. «Чужие PR»):
  8. новые отметки «сделано», «временное поведение», закрытие карточки и ворот
     появились только у карточки этой ветки (в ветке с другим именем новых отметок
     быть не должно вовсе); вопрос по правилу и занятость карточки сняты записью с
     именем и словами владельца; хэш текста, пометка и состав правил меняются только
     в ветке выкладки документа erp-docs/<дата>;
  9. ЗАКРЫТИЕ ВОРОТ — ОТДЕЛЬНЫЙ PR: если в PR появилась запись о воротах, в нём не
     меняется больше ничего — ни отметки правил, ни другие карточки, ни порядок, ни
     один файл вне записи этих ворот;
     сама запись появляется только когда все карточки до этих ворот закрыты и по их
     правилам нет неснятого вопроса владельцу — иначе ошибка (то же, в чём отказывает
     mark.py gate; запись, вписанная в файл руками, не проходит);
 10. запись о воротах, свидетельство, снятый вопрос и снятая занятость, попавшие в
     main, не стёрты и не изменены (сравниваются роль, дата и хэш записи). Свидетельство
     и снятый вопрос обязаны остаться в реестре при любом хэше и любом состоянии правила:
     на месте или в журнале (evidence_log, problem_cleared_log; у правила, ушедшего из
     документа, — retired).

Чужие PR (ветка не erp/<номер>-<slug> и не erp-docs/<дата>). Проверка сторожит отметки, а
отметки попадают в main только через PR, который их меняет. Поэтому:
  - джоба pr-scope: строго, как ветка карточки, проверяется только PR, менявший
    scripts/erp/ или src/__tests__/erp-*. PR, который их не менял, эта проверка за состояние
    не задерживает никогда: всё, что она нашла, уже лежит в main и чинится веткой erp/…, —
    печатается предупреждением, код 0. Если такой PR менял pr-checks.yml, красным остаётся
    одно: пропажа обязательных строк шага из workflow; если менял test-baseline.json — одно:
    тест сделанного правила записан в известные красные. Список файлов PR определить нельзя
    (надёжной базы нет) — чужая ветка не задерживается: предупреждение, код 0;
  - джоба static-checks (сравнивать не с чем, история там не скачана): у чужой ветки
    красным считается только отчёт тестов — тест сделанного правила в этом прогоне красный,
    пропущен или не выполнялся. Состояние в том же прогоне судит pr-scope.
Ветка erp/… и erp-docs/… падает при любой ошибке, в том числе при сбое самой проверки.

  python3 check_progress.py [--branch erp/003-slug] [--base-ref <sha>] [--tests-report erp-tests.json]
Только стандартная библиотека.
"""
import json
import os
import re
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_lib as L  # noqa: E402


STATE_KEYS = ("status", "done", "parts_done", "prelook", "problem", "problem_cleared",
              "problem_cleared_log", "evidence_log", "text_hash", "mark")


class ReportFail(L.Fail):
    """Отчёт тестов не читается: это ошибка прогона, она красная для любой ветки."""


class NoBase(L.Fail):
    """Сравнивать не с чем: базу нельзя определить надёжно."""


ERP_FILE = re.compile(r"^(?:scripts/erp/|src/__tests__/erp-)")
# Файлы вне scripts/erp, которыми чужой PR может сломать проверку, и что тогда судится строго.
ERP_ALSO = {L.WORKFLOW: "workflow", "test-baseline.json": "baseline"}
MAIN = "refs/remotes/origin/main"


def is_foreign(branch: str) -> bool:
    """Ветка чужого PR: не карточка, не ворота и не выкладка документа."""
    return bool(branch) and not branch.startswith(("erp/", L.DOCS_BRANCH))


def touches_erp(files) -> bool:
    """PR меняет то, на чём держатся отметки: состояние и команды или тесты правил."""
    return any(ERP_FILE.match(f) for f in files)


def also_touched(files) -> tuple:
    """Что из остального судится строго: «workflow» — PR менял pr-checks.yml, «baseline» —
    менял список известных красных тестов."""
    return tuple(sorted({ERP_ALSO[f] for f in files if f in ERP_ALSO}))


def compare_base(git, base_ref):
    """(коммит, с которым сравнивать этот PR; это первый родитель коммита слияния?) или None,
    если надёжной базы нет. git — функция: строка вывода или None при ошибке.

    В GitHub HEAD — коммит слияния ветки PR с main (refs/pull/N/merge), а base.sha из события
    — main на день открытия PR. У PR, открытого неделю назад, он отстал на неделю; у PR,
    открытого поверх чужой ветки (стековый), это голова той ветки, а не коммит main. Сравни с
    ним — и всё, что main получил мимо него (весь scripts/erp, отметки других карточек),
    покажется работой ЧУЖОГО PR. Поэтому: HEAD с двумя родителями, первый лежит в origin/main
    — база он, безусловно. Иначе годится только --base-ref из истории origin/main. В
    репозитории без origin/main (местная проба) верим тому, что дали."""
    def ok(*a):
        return git(*a) is not None

    has_main = ok("rev-parse", "--verify", "--quiet", MAIN)
    parents = (git("rev-list", "--parents", "-n", "1", "HEAD") or "").split()[1:]
    if len(parents) == 2:
        if has_main and ok("merge-base", "--is-ancestor", parents[0], MAIN):
            return parents[0], True
        if not has_main and base_ref and ok("merge-base", "--is-ancestor", base_ref, parents[0]):
            return parents[0], True
    if not base_ref or not ok("cat-file", "-e", f"{base_ref}^{{commit}}"):
        return None
    if has_main and not ok("merge-base", "--is-ancestor", base_ref, MAIN):
        return None
    return base_ref, False


def pr_files(repo, base_ref):
    """Файлы, которые меняет этот PR, или None, если узнать нельзя. Состояние не читается:
    ответ нужен и тогда, когда оно не читается вовсе."""
    if not base_ref or repo is None:
        return None

    def git(*a):
        return L._git_at(Path(repo), *a)

    base = compare_base(git, base_ref)
    if base is None:
        return None
    start = base[0] if base[1] else (git("merge-base", base[0], "HEAD") or "").strip() or None
    if not start:
        return None
    out = git("diff", "--name-only", start, "HEAD")
    return None if out is None else [ln.strip() for ln in out.splitlines() if ln.strip()]


def changed_files(ctx, base_ref):
    """То же по уже прочитанному состоянию; None, если git спросить нельзя."""
    if not base_ref or not ctx.use_git:
        return None
    return pr_files(ctx.repo, base_ref)


def load_base(ctx, args):
    """(registry, progress, order) из main — или None, если сравнивать не с чем."""
    def read(name):
        if args.base_dir:
            p = Path(args.base_dir) / name
            return p.read_text(encoding="utf-8") if p.exists() else None
        rel = ctx.state_in_repo()
        return ctx.git("show", f"{args.base_ref}:{rel}/{name}") if rel is not None else None

    if not (args.base_dir or args.base_ref):
        return None
    if args.base_ref:
        base = compare_base(ctx.git, args.base_ref)
        if base is None and not ctx.git_ok("cat-file", "-e", f"{args.base_ref}^{{commit}}"):
            raise L.Fail(f"база для сравнения {args.base_ref} не читается: нужен checkout с "
                         f"fetch-depth: 0 и коммит main из события PR")
        if base is None:
            raise NoBase(f"надёжной базы для сравнения нет: {args.base_ref[:12]} не лежит в истории "
                         f"origin/main, а HEAD — не коммит слияния ветки с origin/main. Ветка "
                         f"карточки создаётся от origin/main, PR открывается в main")
        args.base_ref = base[0]
    reg = read("registry.json")
    files = {}
    if args.base_dir:
        folder = Path(args.base_dir) / "progress"
        if folder.is_dir():
            files = {p.name: p.read_text(encoding="utf-8") for p in folder.glob("*.json")}
    else:
        rel = ctx.state_in_repo()
        listing = ctx.git("ls-tree", "--name-only", args.base_ref, rel + "/progress/") \
            if rel is not None else None
        for path in (listing or "").splitlines():
            if path.endswith(".json"):
                text = ctx.git("show", f"{args.base_ref}:{path}")
                if text:
                    files[Path(path).name] = text
    order = read("order.json")
    return (json.loads(reg) if reg else {"rules": []}, L.progress_from_files(files),
            json.loads(order) if order else None)


def gate_open(ctx, gate):
    """(незакрытые карточки до ворот, правила этих карточек с неснятым вопросом владельцу)."""
    cards = L.before(ctx, gate)
    return [x.key for x in cards if not L.is_closed(ctx, x)], L.open_problems(ctx, cards)


def workflow_errors(repo, args, in_ci):
    """Строки workflow, без которых проверка отметок молча исчезает."""
    path = Path(args.workflow) if args.workflow else Path(repo) / L.WORKFLOW
    if not path.is_file():
        return [f"нет файла {L.WORKFLOW}: проверка отметок нигде не запускается"] if in_ci else []
    live = [ln for ln in path.read_text(encoding="utf-8").splitlines()
            if not ln.lstrip().startswith("#")]
    return [f"в {path.name} нет строки «{must}» — без неё проверка отметок не работает "
            f"(дословный текст шагов — в карточке 001 и в README команд)"
            for must in L.WORKFLOW_MUST if not any(must in ln for ln in live)]


def run(args, branch, soft):
    """Сама проверка. Возвращает код: 0 — в порядке, 1 — есть ошибки. soft — почему ошибки
    состояния этот PR не задерживают (чужой PR; см. not_mine), или None."""
    ctx = L.Ctx(args)
    errors, warns = L.validate_order(ctx)
    report_errors = []  # отчёт тестов этого прогона: красные для любой ветки
    # то, что чужой PR может сломать, не трогая scripts/erp: строки workflow и список красных
    kept = {"workflow": [], "baseline": []}
    in_ci = bool(os.environ.get("GITHUB_ACTIONS"))
    if in_ci and not (args.base_ref or args.base_dir or args.tests_report):
        errors.append("нет базы для сравнения: в GitHub проверка запускается с --base-ref "
                      "\"$BASE_SHA\" (джоба pr-scope) или с --tests-report (джоба static-checks)")
    wf = workflow_errors(ctx.repo, args, in_ci)
    if in_ci or ctx.state_in_repo() is not None or args.workflow:
        kept["workflow"] += wf
    elif wf:  # состояние ещё в закрытой папке: строки в workflow ставит карточка 001
        warns.append(f"в {L.WORKFLOW} пока нет строк проверки отметок ({len(wf)}): их ставит "
                     f"карточка 001")

    report = None
    if args.tests_report:
        try:
            report = L.load_report(args.tests_report)
        except L.Fail as e:
            raise ReportFail(str(e))
        want_sha = os.environ.get("HEAD_SHA") or ""
        if in_ci and not report["meta"].get("head_sha"):
            report_errors.append("отчёт тестов не помечен ci_report.py: неизвестно, какого он коммита")
        elif want_sha and report["meta"].get("head_sha") != want_sha:
            report_errors.append(f"отчёт тестов собран по коммиту {str(report['meta'].get('head_sha'))[:10]}, "
                                 f"а проверяется {want_sha[:10]}")

    known_red = set()
    bl = Path(args.baseline) if args.baseline else ctx.repo / "test-baseline.json"
    if bl.is_file():
        try:
            known_red = set(json.loads(bl.read_text(encoding="utf-8")).get("knownFailingFiles") or [])
        except (json.JSONDecodeError, AttributeError):
            kept["baseline"].append(f"{bl.name} не читается")
    roots = ctx.tests_roots()
    no_tree_said = False
    n_done = 0

    def need_test(r, want, name):
        """Отметка должна опираться на тест: в дереве он есть и не выключен, а если дан отчёт
        прогона — он в нём зелёный (passed). Возвращает False при ошибке."""
        nonlocal no_tree_said
        slug = r["slug"]
        label = slug if want is None else f"{slug}#{want}"
        if not roots:
            if not no_tree_said:
                errors.append("не найдено дерево тестов (src/__tests__) — нечем подтвердить отметки")
                no_tree_said = True
            return False
        tests = L.live_tests(ctx, slug, want)
        if not tests:
            errors.append(f"правило {slug} ({r['id']}) отмечено «{name}», но включённого теста "
                          f"с номером {label} в названии в файлах src/__tests__/erp-*.test.ts нет "
                          f"(выключенный, закомментированный и *.spec.ts не считаются)")
            return False
        if all(t["file"] in known_red for t in tests):
            kept["baseline"].append(f"правило {slug}: его тест ({tests[0]['file']}) числится "
                                    f"красным в {bl.name}")
            return False
        if report is not None:
            green, red, skipped = L.green_for(report["results"], slug, want)
            if red:
                report_errors.append(f"правило {slug} отмечено «{name}», а его тест в этом прогоне "
                                     f"красный: {red[0][:100]}")
                return False
            if not green:
                why = "пропущен (skipped) — он не выполнялся" if skipped else "не выполнялся вовсе"
                report_errors.append(f"правило {slug} отмечено «{name}», а тест с номером {label} в "
                                     f"этом прогоне {why}")
                return False
        return True

    def fresh(r, f, name):
        if f.get("hash") != r.get("text_hash") or not L.text_matches(ctx, r):
            errors.append(f"правило {r['slug']} ({r['id']}): текст изменился после отметки "
                          f"«{name}» — отметку надо сбросить (mark.py sync)")
            return False
        return True

    for r in ctx.rules:
        slug = r["slug"]
        if r.get("status") == "done" and r.get("mark") == "to_look":
            errors.append(f"правило {slug} ({r['id']}) «досмотреть» отмечено сделанным — "
                          f"по догадке не делается")
            continue
        parts = ctx.carry.get(slug) or []
        for key, pd in (r.get("parts_done") or {}).items():
            if key not in parts:
                errors.append(f"правило {slug}: отмечена часть карточки {key}, которой у правила нет")
            elif fresh(r, pd, f"часть карточки {key}"):
                need_test(r, key, f"часть карточки {key}")
        pre = r.get("prelook")
        if pre and fresh(r, pre, "до просмотра"):
            need_test(r, L.PRE, "до просмотра")
        if r.get("status") != "done":
            continue
        d = r.get("done") or {}
        if not d.get("hash"):
            errors.append(f"правило {slug} ({r['id']}) отмечено сделанным без доказательства "
                          f"(нет записи done): отметку ставит только mark.py rule")
            continue
        n_done += 1
        if not fresh(r, d, "сделано"):
            continue
        cards = L.cards_of_rule(ctx, slug)
        if d.get("kind") == "evidence":
            if not any(slug in c.evidence for c in cards):
                errors.append(f"правило {slug} закрыто свидетельством, но ни одна карточка не "
                              f"называет его в evidence_rules — нужен тест")
            elif not d.get("evidence_sha"):
                errors.append(f"правило {slug}: свидетельство без файла")
            elif L.record_problem(ctx, d, "evidence", slug):
                errors.append(f"правило {slug}: свидетельство без записи владельца — "
                              + L.record_problem(ctx, d, "evidence", slug))
        elif parts:
            missing = [k for k in parts if not L.part_ok(ctx, r, k)]
            if missing:
                errors.append(f"правило {slug} с продолжением отмечено сделанным, а части карточек "
                              f"{', '.join(missing)} не отмечены")
        else:
            need_test(r, None, "сделано")
        if not any(ctx.progress["cards"].get(c.key, {}).get(k) for c in cards
                   for k in ("taken_by", "closed", "reopened")):
            # reopened: карточку открыл снова изменённый документ — прежние отметки её правил законны
            errors.append(f"правило {slug} отмечено сделанным вне карточки: его карточка "
                          f"не взята и не закрыта")

    owners = {}
    stale_gates = {}  # закрытые ворота, до которых есть открытая карточка или вопрос владельцу
    for c in ctx.cards:
        st = ctx.progress["cards"].get(c.key, {})
        if c.gate:
            for k in ctx.progress["gates"].get(c.key, {}).get("confirmations") or []:
                role = k.get("role") if isinstance(k, dict) else None
                why = L.record_problem(ctx, k, "gate", c.key)
                if why:
                    errors.append(f"ворота {c.key}: подтверждение ({role}) — {why}")
                if role not in c.who:
                    errors.append(f"ворота {c.key}: подтверждение с ролью {role}, которой "
                                  f"у этих ворот нет")
            if L.is_closed(ctx, c):
                late, probs = gate_open(ctx, c)
                if late or probs:
                    stale_gates[c.key] = (late, probs)
            continue
        if st.get("note") is not None:
            errors += L.note_errors(ctx, c.key, st["note"])
        for k in st.get("released") or []:
            why = L.record_problem(ctx, k, "release", c.key)
            if why:
                errors.append(f"карточка {c.key}: занятость снята без записи владельца — {why}")
        if st.get("closed") and L.closure_gaps(ctx, c):
            warns.append(f"карточка {c.key} была закрыта, но снова открыта: "
                         f"{L.closure_gaps(ctx, c)[0]}")
        if st.get("taken_by") and not st.get("closed"):
            owners.setdefault(st["taken_by"], []).append(c.key)
    for b, keys in owners.items():
        if len(keys) > 1:
            errors.append(f"за веткой {b} записаны сразу карточки {', '.join(keys)}: "
                          f"одна ветка — одна карточка")

    logs = [(r["slug"], r) for r in ctx.rules] + sorted((ctx.registry.get("retired") or {}).items())
    for slug, r in logs:
        for k in [r.get("problem_cleared")] + list(r.get("problem_cleared_log") or []):
            why = L.record_problem(ctx, k, "problem_cleared", slug) if k else None
            if why:
                errors.append(f"правило {slug}: вопрос снят без записи владельца — {why}")
        for k in r.get("evidence_log") or []:
            why = L.record_problem(ctx, k, "evidence", slug)
            if why:
                errors.append(f"правило {slug}: в журнале свидетельств запись без записи "
                              f"владельца — {why}")
    leaks = L.secret_fields({"registry": {"rules": ctx.rules,
                                          "retired": ctx.registry.get("retired") or {}},
                             "progress": {k: ctx.progress[k] for k in ("cards", "gates")}})
    if leaks:
        errors.append(f"в открытом состоянии записаны имя или слова человека ({', '.join(leaks[:4])}"
                      + (f" и ещё {len(leaks) - 4}" if len(leaks) > 4 else "")
                      + "): репозиторий открытый — там остаются роль, дата и хэш, имя и слова "
                        "лежат в закрытой папке")

    mine = None
    if branch.startswith("erp/"):
        mine = L.card_for_branch(ctx, branch)
        if mine is None:
            errors.append(f"ветка {branch} не соответствует ни одной карточке order.json")
        else:
            st = ctx.progress["cards"].get(mine.key, {})
            if not mine.gate and st.get("taken_by") != branch and \
                    (st.get("closed") or {}).get("branch") != branch:
                errors.append(f"карточка {mine.key} не записана за веткой {branch}: её надо было "
                              f"взять командой next_card.py --take {branch}")
            res = L.pick_next(ctx, me=None, ignore=mine.key)
            if res["kind"] == "outline" and res["card"].key == mine.key:
                errors.append(f"карточка {mine.key} ещё не расписана (outline) — брать её нельзя")
            elif res["kind"] in ("card", "gate", "outline") and res["card"].key != mine.key:
                what = "ворота" if res["kind"] == "gate" else "карточка"
                errors.append(f"карточка {mine.key} взята не по порядку: сейчас очередь — "
                              f"{what} {res['card'].key} «{res['card'].title}»")
            elif res["kind"] == "wait":
                errors.append(f"карточка {mine.key} взята не по порядку: {res['why']}")
            elif res["kind"] == "done":
                errors.append(f"карточка {mine.key}: по записям всё уже закрыто")

    try:
        base = load_base(ctx, args)
    except NoBase as e:
        errors.append(str(e))
        base = None
    if base is not None:
        breg, bprog, border = base
        old = {r.get("slug"): r for r in breg.get("rules") or []}
        allowed = set(mine.all_rules) if mine is not None and not mine.gate else set()
        where = f"карточки {mine.key}" if mine is not None else "ветки с именем erp/<номер>-<slug>"
        for r in ctx.rules:
            o = old.get(r["slug"], {})
            new_done = r.get("status") == "done" and (
                o.get("status") != "done" or (o.get("done") or {}).get("hash") !=
                (r.get("done") or {}).get("hash"))
            new_pre = r.get("prelook") and r.get("prelook") != o.get("prelook")
            if (new_done or new_pre) and r["slug"] not in allowed:
                errors.append(f"правило {r['slug']}: новая отметка поставлена вне {where}")
            for key, pd in (r.get("parts_done") or {}).items():
                if pd != (o.get("parts_done") or {}).get(key) and \
                        (mine is None or mine.gate or key != mine.key):
                    errors.append(f"правило {r['slug']}: часть карточки {key} отмечена вне "
                                  f"ветки этой карточки")
            if o.get("problem") and not r.get("problem") and \
                    o["problem"].get("hash") == r.get("text_hash") and \
                    (r.get("problem_cleared") or {}).get("hash") != r.get("text_hash"):
                errors.append(f"правило {r['slug']}: вопрос владельцу исчез без его ответа — "
                              f"снимает его только mark.py problem --clear с именем и словами "
                              f"владельца")
        # --- текст, пометку и состав правил меняет только выкладка документа (ветка erp-docs/…)
        cur = {r["slug"]: r for r in ctx.rules}
        if old and not branch.startswith(L.DOCS_BRANCH):
            moved = sorted(sl for sl in set(old) | set(cur)
                           if sl not in old or sl not in cur
                           or old[sl].get("text_hash") != cur[sl].get("text_hash")
                           or old[sl].get("mark") != cur[sl].get("mark"))
            if moved:
                errors.append(f"хэш текста, пометка или состав правил изменены вне ветки "
                              f"{L.DOCS_BRANCH}<дата> ({', '.join(moved[:5])}"
                              + (f" и ещё {len(moved) - 5}" if len(moved) > 5 else "")
                              + "): их меняет только выкладка документа (export_public.py)")
        # --- неизменяемость: свидетельство и снятый вопрос из main остаются в реестре всегда —
        #     на своём месте или в журнале (evidence_log, problem_cleared_log, retired); от
        #     хэша текста и от вопроса по правилу это не зависит: и то и другое пишет сам PR
        bret, nret = breg.get("retired") or {}, ctx.registry.get("retired") or {}
        for sl in sorted(set(old) | set(bret)):
            was_ev, was_cl = L.owner_records(old.get(sl), bret.get(sl))
            now_ev, now_cl = L.owner_records(cur.get(sl), nret.get(sl))
            if [k for k in was_ev if k not in now_ev]:
                errors.append(f"правило {sl}: свидетельство из main стёрто или изменено — принятое "
                              f"свидетельство не переписывается (при сбросе оно уходит в журнал "
                              f"evidence_log, а не исчезает)")
            if [k for k in was_cl if k not in now_cl]:
                errors.append(f"правило {sl}: запись о снятом вопросе из main стёрта или изменена — "
                              f"ответ владельца не переписывается")
        new_gates = []
        for key, bg in (bprog.get("gates") or {}).items():
            if key not in ctx.by_key and bg.get("confirmations"):
                errors.append(f"ворота {key}: в main у них есть запись, а здесь этих ворот нет")
        for c in ctx.cards:
            if c.gate:
                now = ctx.progress["gates"].get(c.key, {}).get("confirmations") or []
                was = (bprog.get("gates") or {}).get(c.key, {}).get("confirmations") or []
                for k in was:
                    if k not in now:
                        errors.append(f"ворота {c.key}: запись из main ({k.get('role')}, "
                                      f"{k.get('date')}, запись {str(k.get('record'))[:12]}) стёрта "
                                      f"или изменена — запись о воротах не переписывается")
                if [k for k in now if k not in was]:
                    new_gates.append(c)
                    # запись появилась в этом PR: то же, в чём отказывает mark.py gate, — на случай
                    # записи, вписанной в файл руками
                    stale_gates.pop(c.key, None)
                    late, probs = gate_open(ctx, c)
                    if late:
                        errors.append(f"ворота {c.key}: запись о воротах появилась, а карточки "
                                      f"{', '.join(late)} до них не закрыты — ворота закрывает "
                                      f"mark.py gate после закрытия всех карточек")
                    if probs:
                        errors.append(f"ворота {c.key}: запись о воротах появилась, а по правилам "
                                      f"карточек до них есть неснятые вопросы владельцу: "
                                      f"{', '.join(probs)} — сначала ответ владельца "
                                      f"(mark.py problem --clear)")
                    if mine is None or mine.key != c.key:
                        errors.append(f"ворота {c.key}: подтверждение записано не в ветке этих "
                                      f"ворот ({c.branch})")
            else:
                st = ctx.progress["cards"].get(c.key, {})
                bst = (bprog.get("cards") or {}).get(c.key, {})
                now, was = st.get("closed"), bst.get("closed")
                if now and now != was and (mine is None or mine.key != c.key):
                    errors.append(f"карточка {c.key} закрыта не в своей ветке ({c.branch})")
                if bst.get("taken_by") and not was and st.get("taken_by") != bst["taken_by"] and \
                        not any(k.get("was") == bst["taken_by"] and k not in (bst.get("released") or [])
                                for k in st.get("released") or []):
                    errors.append(f"карточка {c.key}: в main она за веткой {bst['taken_by']}, а "
                                  f"здесь занятость снята или переписана без записи владельца "
                                  f"(mark.py release)")
                if [k for k in bst.get("released") or [] if k not in (st.get("released") or [])]:
                    errors.append(f"карточка {c.key}: запись о снятой занятости из main стёрта "
                                  f"или изменена")
        # --- закрытие ворот — отдельный PR: рядом с новой записью о воротах нет ничего другого
        if new_gates:
            g = new_gates[0]
            mixed = []

            def state_of(rule):
                return {k: rule.get(k) for k in STATE_KEYS if rule.get(k) is not None}

            now_rules = {r["slug"]: r for r in ctx.rules}
            diff = sorted(sl for sl in set(now_rules) | set(old)
                          if state_of(now_rules.get(sl) or {}) != state_of(old.get(sl) or {}))
            if diff:
                mixed.append("отметки и состояние правил (" + ", ".join(diff[:5])
                             + (" …" if len(diff) > 5 else "") + ")")
            cdiff = sorted(k for k in set(ctx.progress["cards"]) | set(bprog.get("cards") or {})
                           if (ctx.progress["cards"].get(k) or {}) != ((bprog.get("cards") or {}).get(k) or {}))
            if cdiff:
                mixed.append("состояние карточек " + ", ".join(cdiff[:8]))
            if border is not None and border != ctx.order_raw:
                mixed.append("порядок карточек (order.json)")
            rel = ctx.state_in_repo()
            files = changed_files(ctx, args.base_ref)
            if files is not None and rel is not None:
                own = {f"{rel}/progress/{x.key}.json" for x in new_gates} | \
                      {f"{rel}/registry.json", f"{rel}/order.json"}
                extra = [f for f in files if f not in own]
                if extra:
                    mixed.append("файлы " + ", ".join(extra[:5]) + (" …" if len(extra) > 5 else ""))
            if mixed:
                errors.append(f"ворота {g.key}: закрытие ворот смешано с другой работой — "
                              + "; ".join(mixed) + f". Запись о воротах идёт отдельным PR из ветки "
                              f"{g.branch}, в котором меняется только файл progress/{g.key}.json")

    # Запись о воротах уже в main (или сравнивать не с чем), а карточка до них открылась снова —
    # так бывает после выкладки изменённого документа: запись не переписывается, поэтому здесь
    # предупреждение. Новая запись при том же состоянии — ошибка, она названа выше.
    for key, (late, probs) in stale_gates.items():
        warns.append(f"ворота {key} закрыты записью из main, а до них "
                     + "; ".join(x for x in (
                         f"открыты карточки {', '.join(late)}" if late else "",
                         f"есть вопросы владельцу по правилам {', '.join(probs)}" if probs else "") if x)
                     + " (открылись после изменения документа?)")
    for w in warns[:20]:
        print("предупреждение: " + w)
    if len(warns) > 20:
        print(f"предупреждение: … и ещё {len(warns) - 20}")
    if soft:
        # чужой PR: показать и не задерживать (pr-scope — это состояние main, а не его правка;
        # static-checks — состояние в этом же прогоне судит pr-scope). Строго судится только
        # то, что этот PR сам мог сломать (soft["keep"]): строки workflow, список красных
        errors += [e for cat, found in kept.items() if cat not in soft["keep"] for e in found]
        for e in errors:
            print(f"{soft['tag']}: " + e)
        if errors:
            not_mine(soft, f"ошибок состояния {len(errors)}")
        errors = [e for cat in soft["keep"] for e in kept[cat]]
    else:
        errors = kept["workflow"] + errors + kept["baseline"]
    errors += report_errors
    for e in errors:
        print("ОШИБКА: " + e)
    if errors:
        print(f"check_progress: ошибок {len(errors)}")
        return 1
    closed = sum(1 for c in ctx.cards if L.is_closed(ctx, c))
    print(f"check_progress: в порядке — правил сделано {n_done} из {len(ctx.rules)}, "
          f"карточек и ворот закрыто {closed} из {len(ctx.cards)}"
          + (f", ветка {branch} — карточка {mine.key}" if mine is not None else "")
          + (f", отчёт прогона: тестов {len(report['results'])}" if report is not None else ""))
    return 0


def not_mine(soft, what):
    """soft — {"tag": пометка строки, "why": причина, "other_step": состояние судит другой шаг
    этого прогона, "keep": что всё же судится строго}."""
    if soft["other_step"]:
        line = f"в состоянии scripts/erp есть ошибки ({what}); этот шаг их не судит: {soft['why']}."
    else:
        line = (f"scripts/erp в main неисправен ({what}), но этот PR не задержан: {soft['why']}. "
                f"Чинит ветка erp/<номер>-<slug>.")
    if os.environ.get("GITHUB_ACTIONS"):
        print("::warning title=ERP progress::" + line)
    print("check_progress: " + line)


def main():
    p = L.common_parser(__doc__)
    p.add_argument("--branch", help="имя ветки PR (по умолчанию GITHUB_HEAD_REF)")
    p.add_argument("--base-ref", help="коммит main, с которым сравнить отметки")
    p.add_argument("--base-dir", help="папка с registry.json и progress/ из main")
    p.add_argument("--baseline", help="test-baseline.json (по умолчанию в корне репозитория)")
    p.add_argument("--tests-report", help="отчёт прогона тестов правил (erp-tests.json)")
    p.add_argument("--workflow", help="файл workflow (по умолчанию .github/workflows/pr-checks.yml)")
    args = p.parse_args()
    branch = args.branch or os.environ.get("GITHUB_HEAD_REF") or os.environ.get("ERP_BRANCH") or ""
    # Чей это PR — решается до чтения состояния: ответ нужен и тогда, когда оно не читается.
    soft = None
    repo = args.repo or os.environ.get("ERP_REPO") or os.getcwd()
    if is_foreign(branch):
        files = None if args.no_git else pr_files(repo, args.base_ref)
        if files is not None and not touches_erp(files):
            keep = also_touched(files)
            names = {"workflow": "строки шага в pr-checks.yml", "baseline": "список известных "
                     "красных у сделанных правил"}
            soft = {"tag": "в main (не этот PR)", "other_step": False, "keep": keep,
                    "why": f"ветка {branch} не меняла scripts/erp/ и тесты правил"
                           + ("; строго проверено только то, что она могла сломать: "
                              + ", ".join(names[k] for k in keep) if keep else "")}
        elif args.tests_report and not (args.base_ref or args.base_dir):
            soft = {"tag": "состояние (судит pr-scope)", "other_step": True, "keep": (),
                    "why": f"у чужой ветки {branch} шаг static-checks судит только отчёт тестов, "
                           f"состояние в этом же прогоне судит pr-scope"}
        elif files is None and args.base_ref and not args.no_git:
            soft = {"tag": "база неизвестна (чужой PR)", "other_step": False, "keep": (),
                    "why": f"список файлов ветки {branch} определить нельзя: HEAD — не коммит "
                           f"слияния с origin/main, а база {args.base_ref[:12]} не лежит в его "
                           f"истории (PR открыт поверх другой ветки?)"}
    try:
        return run(args, branch, soft)
    except ReportFail:
        raise
    except L.Fail as e:
        if not soft:
            raise
        print(f"{soft['tag']}: ОТКАЗ: {e}")
        not_mine(soft, "состояние не читается")
    except Exception:  # noqa: BLE001 — сбой самой проверки: чужой PR за него не отвечает
        if not soft:
            raise
        traceback.print_exc()
        not_mine(soft, "проверка упала")
    # проверка не дошла до конца не по вине этого PR; но строки workflow он мог убрать сам —
    # они читаются без состояния
    if "workflow" in soft["keep"]:
        wf = workflow_errors(repo, args, bool(os.environ.get("GITHUB_ACTIONS")))
        for e in wf:
            print("ОШИБКА: " + e)
        if wf:
            print(f"check_progress: ошибок {len(wf)}")
            return 1
    return 0


if __name__ == "__main__":
    L.run_main(main)
