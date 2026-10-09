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
  4. у каждой записи о воротах, свидетельства, снятого вопроса и снятой занятости есть
     роль, имя человека, дата и дословные слова; у одной ветки не две карточки; записка
     в открытой части — только номера. Что слова сказал владелец, машина НЕ проверяет
     (учётная запись GitHub у него и у сессий одна): защита — пункты 8–9 и его экран;
  5. в workflow стоят строки, без которых эта проверка молча исчезает.
Если дан отчёт прогона (--tests-report erp-tests.json):
  6. у каждого «сделано», части и «до просмотра» тест с номером имеет в отчёте статус
     passed (пропущенный — ошибка: он не выполнялся) и нет красного.
Если ветка называется erp/<номер>-<slug> (имя — из --branch или GITHUB_HEAD_REF):
  7. такая карточка есть, записана за этой веткой, и это именно та карточка, которую
     выдал бы next_card.py: все «после» закрыты, ворота перед ней закрыты, карточки с
     меньшим номером закрыты или заняты другими ветками при разрешённой параллели.
Если дано, с чем сравнивать (--base-ref <коммит main> или --base-dir <папка>; в GitHub
база — первый родитель коммита слияния PR, а не отставший base.sha из события):
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
     main, не стёрты и не изменены. Свидетельство и снятый вопрос обязаны остаться в
     реестре при любом хэше и любом состоянии правила: на месте или в журнале
     (evidence_log, problem_cleared_log; у правила, ушедшего из документа, — retired).

  python3 check_progress.py [--branch erp/003-slug] [--base-ref <sha>] [--tests-report erp-tests.json]
Только стандартная библиотека.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_lib as L  # noqa: E402


STATE_KEYS = ("status", "done", "parts_done", "prelook", "problem", "problem_cleared",
              "problem_cleared_log", "evidence_log", "text_hash", "mark")


def changed_files(ctx, base_ref):
    """Файлы, которые меняет этот PR, или None, если git спросить нельзя. В GitHub HEAD —
    коммит слияния ветки с main: тогда PR — это разница с его первым родителем."""
    if not base_ref or not ctx.use_git:
        return None
    parents = (ctx.git("rev-list", "--parents", "-n", "1", "HEAD") or "").split()[1:]
    start = None
    if len(parents) == 2 and ctx.git_ok("merge-base", "--is-ancestor", base_ref, parents[0]):
        start = parents[0]
    else:
        start = (ctx.git("merge-base", base_ref, "HEAD") or "").strip() or None
    if not start:
        return None
    out = ctx.git("diff", "--name-only", start, "HEAD")
    return None if out is None else [ln.strip() for ln in out.splitlines() if ln.strip()]


def effective_base(ctx, base_ref):
    """С каким коммитом main сравнивать. В GitHub HEAD — коммит слияния ветки PR с main, а
    base.sha из события PR — это main на день открытия PR: у PR, открытого неделю назад, он
    отстал на неделю. Сравни отметки с ним — и всё, что другие карточки за эту неделю
    смержили в main, покажется «новой отметкой вне своей ветки» у ЧУЖОГО PR, который
    scripts/erp не трогал. Поэтому база — первый родитель коммита слияния (тот main, с
    которым GitHub ветку слил), если он лежит в истории origin/main и содержит base.sha.
    Иначе — то, что дали."""
    if not base_ref or not ctx.use_git:
        return base_ref
    parents = (ctx.git("rev-list", "--parents", "-n", "1", "HEAD") or "").split()[1:]
    if len(parents) == 2 and ctx.git_ok("merge-base", "--is-ancestor", base_ref, parents[0]) \
            and ctx.git_ok("merge-base", "--is-ancestor", parents[0], "refs/remotes/origin/main"):
        return parents[0]
    return base_ref


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
    if args.base_ref and not ctx.git_ok("cat-file", "-e", f"{args.base_ref}^{{commit}}"):
        raise L.Fail(f"база для сравнения {args.base_ref} не читается: нужен checkout с "
                     f"fetch-depth: 0 и коммит main из события PR")
    if args.base_ref:
        args.base_ref = effective_base(ctx, args.base_ref)
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


def workflow_errors(ctx, args, in_ci):
    """Строки workflow, без которых проверка отметок молча исчезает."""
    path = Path(args.workflow) if args.workflow else ctx.repo / L.WORKFLOW
    if not path.is_file():
        return [f"нет файла {L.WORKFLOW}: проверка отметок нигде не запускается"] if in_ci else []
    live = [ln for ln in path.read_text(encoding="utf-8").splitlines()
            if not ln.lstrip().startswith("#")]
    return [f"в {path.name} нет строки «{must}» — без неё проверка отметок не работает "
            f"(дословный текст шагов — в карточке 001 и в README команд)"
            for must in L.WORKFLOW_MUST if not any(must in ln for ln in live)]


def main():
    p = L.common_parser(__doc__)
    p.add_argument("--branch", help="имя ветки PR (по умолчанию GITHUB_HEAD_REF)")
    p.add_argument("--base-ref", help="коммит main, с которым сравнить отметки")
    p.add_argument("--base-dir", help="папка с registry.json и progress/ из main")
    p.add_argument("--baseline", help="test-baseline.json (по умолчанию в корне репозитория)")
    p.add_argument("--tests-report", help="отчёт прогона тестов правил (erp-tests.json)")
    p.add_argument("--workflow", help="файл workflow (по умолчанию .github/workflows/pr-checks.yml)")
    args = p.parse_args()
    ctx = L.Ctx(args)
    errors, warns = L.validate_order(ctx)
    branch = args.branch or os.environ.get("GITHUB_HEAD_REF") or os.environ.get("ERP_BRANCH") or ""
    in_ci = bool(os.environ.get("GITHUB_ACTIONS"))
    if in_ci and not (args.base_ref or args.base_dir or args.tests_report):
        errors.append("нет базы для сравнения: в GitHub проверка запускается с --base-ref "
                      "\"$BASE_SHA\" (джоба pr-scope) или с --tests-report (джоба static-checks)")
    wf = workflow_errors(ctx, args, in_ci)
    if in_ci or ctx.state_in_repo() is not None or args.workflow:
        errors += wf
    elif wf:  # состояние ещё в закрытой папке: строки в workflow ставит карточка 001
        warns.append(f"в {L.WORKFLOW} пока нет строк проверки отметок ({len(wf)}): их ставит "
                     f"карточка 001")

    report = None
    if args.tests_report:
        report = L.load_report(args.tests_report)
        want_sha = os.environ.get("HEAD_SHA") or ""
        if in_ci and not report["meta"].get("head_sha"):
            errors.append("отчёт тестов не помечен ci_report.py: неизвестно, какого он коммита")
        elif want_sha and report["meta"].get("head_sha") != want_sha:
            errors.append(f"отчёт тестов собран по коммиту {str(report['meta'].get('head_sha'))[:10]}, "
                          f"а проверяется {want_sha[:10]}")

    known_red = set()
    bl = Path(args.baseline) if args.baseline else ctx.repo / "test-baseline.json"
    if bl.is_file():
        try:
            known_red = set(json.loads(bl.read_text(encoding="utf-8")).get("knownFailingFiles") or [])
        except (json.JSONDecodeError, AttributeError):
            errors.append(f"{bl.name} не читается")
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
            errors.append(f"правило {slug}: его тест ({tests[0]['file']}) числится красным "
                          f"в {bl.name}")
            return False
        if report is not None:
            green, red, skipped = L.green_for(report["results"], slug, want)
            if red:
                errors.append(f"правило {slug} отмечено «{name}», а его тест в этом прогоне "
                              f"красный: {red[0][:100]}")
                return False
            if not green:
                why = "пропущен (skipped) — он не выполнялся" if skipped else "не выполнялся вовсе"
                errors.append(f"правило {slug} отмечено «{name}», а тест с номером {label} в "
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
            elif not (d.get("by") or "").strip() or not d.get("evidence_sha"):
                errors.append(f"правило {slug}: свидетельство без имени принявшего или без файла")
            elif not str(d.get("words") or "").strip():
                errors.append(f"правило {slug}: свидетельство принято без слов владельца")
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
                if not (k.get("by") or "").strip() or not k.get("date") or \
                        k.get("by", "").strip().lower() in L.NOT_A_PERSON:
                    errors.append(f"ворота {c.key}: подтверждение без имени человека или без даты")
                if k.get("role") not in c.who:
                    errors.append(f"ворота {c.key}: подтверждение с ролью {k.get('role')}, которой "
                                  f"у этих ворот нет")
                if not str(k.get("words") or "").strip():
                    errors.append(f"ворота {c.key}: подтверждение ({k.get('role')}) без слов — "
                                  f"запись о воротах несёт дословные слова владельца или описание "
                                  f"действия клиента")
                elif len(str(k["words"])) > L.WORDS_MAX:
                    errors.append(f"ворота {c.key}: слова подтверждения длиннее {L.WORDS_MAX} знаков")
            if L.is_closed(ctx, c):
                late, probs = gate_open(ctx, c)
                if late or probs:
                    stale_gates[c.key] = (late, probs)
            continue
        if st.get("note") is not None:
            errors += L.note_errors(ctx, c.key, st["note"])
        for k in st.get("released") or []:
            if not str(k.get("words") or "").strip() or not (k.get("by") or "").strip():
                errors.append(f"карточка {c.key}: занятость снята без имени и слов владельца")
        if st.get("closed") and L.closure_gaps(ctx, c):
            warns.append(f"карточка {c.key} была закрыта, но снова открыта: "
                         f"{L.closure_gaps(ctx, c)[0]}")
        if st.get("taken_by") and not st.get("closed"):
            owners.setdefault(st["taken_by"], []).append(c.key)
    for b, keys in owners.items():
        if len(keys) > 1:
            errors.append(f"за веткой {b} записаны сразу карточки {', '.join(keys)}: "
                          f"одна ветка — одна карточка")

    for r in ctx.rules:
        for k in [r.get("problem_cleared")] + list(r.get("problem_cleared_log") or []):
            if k and (not str(k.get("by") or "").strip() or not str(k.get("words") or "").strip()):
                errors.append(f"правило {r['slug']}: вопрос снят без имени и слов владельца")
        for k in r.get("evidence_log") or []:
            if not str(k.get("by") or "").strip() or not str(k.get("words") or "").strip():
                errors.append(f"правило {r['slug']}: в журнале свидетельств запись без имени и "
                              f"слов владельца")

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

    base = load_base(ctx, args)
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
                                      f"{k.get('by')}, {k.get('date')}) стёрта или изменена — "
                                      f"запись о воротах не переписывается")
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


if __name__ == "__main__":
    L.run_main(main)
