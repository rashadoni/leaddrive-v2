#!/usr/bin/env python3
"""mark — единственная команда, которая ставит отметки. Сама тесты не запускает.

  mark.py step <карточка> <номер шага>
        Шаг карточки. Только по порядку: шаг 3 нельзя отметить раньше шага 2.
  mark.py rule <правило> --run <номер прогона GitHub>
        «Сделано». Команда сама скачивает отчёт тестов этого прогона (gh run download
        <номер> -n erp-tests) и ставит отметку, только если в нём есть тест с номером
        правила в названии со статусом passed (пропущенный не считается) и нет красного,
        прогон — ветки этой карточки и по коммиту этой ветки, тест правила с того коммита
        не менялся, текст правила не менялся (хэш), правило не «досмотреть», не ждёт
        просмотра другого правила и по нему нет открытого вопроса. Файл итогов, набранный
        руками, подать нельзя: такого ключа нет.
        Правило с продолжением (блок carry в order.json): отмечается часть текущей
        карточки — нужен тест с меткой карточки, например u2-B-404#015; «сделано»
        правило получает само, когда отмечены все его части.
  mark.py rule <правило> --evidence <файл> --by "<имя>" --words "<слова владельца>"
        Только для правил, названных в карточке в evidence_rules (проба у клиента без
        кода продукта): вместо теста — файл свидетельства, имя принявшего и его дословные
        слова из сообщения в разговоре.
  mark.py prelook <правило> --run <номер прогона> [--card <карточка>]
        Только для «досмотреть» с оговоркой «до просмотра …»: поведение до просмотра
        закодировано, тест несёт метку #pre (u2-B-313#pre). Правило остаётся «досмотреть».
  mark.py problem <правило> --kind wrong|no_data --text "…"
        Правило оказалось неверным или не хватает данных. Ставит на правило вопрос:
        отметить его сделанным нельзя, ворота впереди не закроются. Текст — в закрытую
        папку, в репозиторий он не попадает.
  mark.py problem <правило> --clear --by "<имя владельца>" --words "<его ответ дословно>"
        Владелец ответил: вопрос снят (если документ исправили — вопрос снимется сам).
  mark.py note <карточка> --text "сделано: …; остановился на: …; мешает: …"
                          [--blocked none|owner|client|look_1c|ci|data|other]
                          [--blocked-rules <правило>,<правило>]
        Записка следующей сессии. Полный текст — в закрытую папку (и в её git); в открытую
        часть команда сама пишет короткую сводку из номеров шагов и правил. Без записки
        карточка не закрывается. Карточку, закрытую в этой же ветке и ещё не смерженную,
        новая записка дополняет (замечания к PR), закрытие остаётся прежним.
  mark.py gate <ворота> --role owner|client --by "<имя>" --date ГГГГ-ММ-ДД --words "…"
        Запись о воротах: роль, кто, дата и ДОСЛОВНЫЕ слова из сообщения владельца (для
        клиента — что он сделал и где лежит свидетельство). Без слов — отказ. Только в
        ветке ворот erp/<номер>-<slug>, отдельным PR, в котором нет ничего другого.
        Запись, попавшую в main, изменить или стереть нельзя: GitHub сравнивает с main.
        Сессия по своей инициативе ворота не закрывает и по памяти слова не записывает.
  mark.py release <карточка> --by "<имя владельца>" --words "<его слова дословно>"
        Снять занятость с брошенной карточки (отметки шагов и правил остаются).
Имя и дословные слова (--by, --words) у ворот, свидетельства, снятого вопроса и снятой
занятости в открытый репозиторий не попадают: команда кладёт их в закрытую папку
(records/<хэш>.json), а в состояние пишет только роль, дату и хэш этой записи.
  mark.py sync
        Сверить отметки с текстом правил: где хэш изменился — «сделано» сбрасывается.
        Эта сверка выполняется и перед каждой другой командой.
Общие ключи (--dir, --private, --repo) пишутся ДО слова команды.

Перед любой отметкой (кроме sync) команда проверяет: закрытая папка — одна на сервере и
под своим git (иначе записка потеряется); дерево содержит origin/main; взятие карточки
запушено; документ не менялся после сборки реестра. После отметки закрытая папка
коммитится в свой git.

Карточка закрывается сама, как только отмечены все шаги, есть записка и каждое правило
либо сделано (у правила с продолжением — сделана часть этой карточки), либо законно
ждёт: просмотра 1С или ответа владельца.

Номер правила в названии теста — латинская запись из реестра: u3-D-28a, целым словом, в
названии it/test или внешнего describe. Файл теста — src/__tests__/erp-*.test.ts.

Код возврата: 0 — отметка поставлена; 1 — отказ (причина одной строкой).
Только стандартная библиотека.
"""
import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_lib as L  # noqa: E402


def person(name, what):
    name = (name or "").strip()
    if len(name) < 2 or name.lower() in L.NOT_A_PERSON:
        raise L.Fail(f"{what}: нужно имя человека, который подтвердил (--by). "
                     f"Сессия ИИ подтвердить за человека не может")
    return name


def working_card(ctx, rule, explicit=None):
    """Карточка в работе, в которую входит правило (explicit — номер карточки для правила
    «досмотреть», которое в карточках не записано)."""
    cards = L.cards_of_rule(ctx, rule["slug"])
    if not cards and explicit:
        return taken_card(ctx, explicit)
    if not cards:
        raise L.Fail(f"правило {rule['slug']} не входит ни в одну карточку")
    taken = [c for c in cards if ctx.progress["cards"].get(c.key, {}).get("taken_by")
             and not L.is_closed(ctx, c)]
    if not taken:
        raise L.Fail(f"правило {rule['slug']} входит в карточку {cards[0].key}, а она не взята: "
                     f"отметки ставятся только в карточке, выданной next_card.py --take")
    card = taken[0]
    guard_branch(ctx, card)
    return card


def guard_branch(ctx, card):
    owner = ctx.progress["cards"].get(card.key, {}).get("taken_by")
    cur = ctx.current_branch()
    if cur and cur.startswith("erp/") and owner and cur != owner:
        raise L.Fail(f"ты в ветке {cur}, а карточка {card.key} занята веткой {owner}")
    if ctx.use_git and owner and cur != owner:
        raise L.Fail(f"отметки карточки {card.key} ставятся только в её ветке {owner}, "
                     f"а ты в ветке {cur}")
    L.require_pushed(ctx, card)


def taken_card(ctx, key):
    card = L.find_card(ctx, key)
    if card.gate:
        raise L.Fail(f"{card.key} — ворота, а не карточка: используй mark.py gate")
    st = ctx.progress["cards"].get(card.key, {})
    if not st.get("taken_by") or L.is_closed(ctx, card):
        raise L.Fail(f"карточка {card.key} не взята: сначала next_card.py --take {card.branch}")
    guard_branch(ctx, card)
    return card


def check_text(ctx, rule):
    fh = ctx.file_hash(rule)
    if fh is not None and fh != rule.get("text_hash"):
        raise L.Fail(f"текст правила {rule['slug']} не совпадает с реестром: документ менялся. "
                     f"Пересобери реестр (build_registry.py) и прочитай правило заново")


def proof(ctx, rule, card, run_id, want=None):
    """Доказательство из отчёта прогона GitHub: {"tests": [...], "run_id", "sha"}.
    want: None — обычный тест, 'pre' — «до просмотра», номер карточки — часть правила."""
    slug = rule["slug"]
    name = slug if want is None else f"{slug}#{want}"
    if not run_id:
        raise L.Fail(f"правило {slug}: без номера прогона GitHub (--run) отметку поставить нельзя")
    if not ctx.tests_roots():
        raise L.Fail("не найдено дерево тестов (src/__tests__): запусти из репозитория "
                     "или укажи --repo")
    tests = L.live_tests(ctx, slug, want)
    if not tests:
        raise L.Fail(f"правило {slug}: в дереве тестов нет включённого теста с номером "
                     f"{name} в названии. Считаются только файлы src/__tests__/erp-*.test.ts; "
                     f"it.skip, it.todo, describe.skip и закомментированный тест не считаются")
    branch = ctx.progress["cards"].get(card.key, {}).get("taken_by")
    report = L.fetch_run(ctx, run_id, branch)
    green, red, skipped = L.green_for(report["results"], slug, want)
    if red:
        raise L.Fail(f"правило {slug}: в прогоне {report['run_id']} красный тест с его номером: "
                     f"{red[0][:120]}")
    if not green:
        why = (f"тест с номером {name} пропущен (skipped): он не выполнялся — у теста на "
               f"настоящей базе проверь, что шаг GitHub задаёт ERP_TEST_DATABASE_URL"
               if skipped else f"теста с номером {name} в названии нет")
        raise L.Fail(f"правило {slug}: в отчёте прогона {report['run_id']} нет зелёного теста — {why}")
    if ctx.use_git:
        files = sorted({t["file"] for t in tests})
        if ctx.git("diff", "--quiet", report["sha"], "--", *files) is None:
            raise L.Fail(f"правило {slug}: тест ({files[0]}) менялся после прогона "
                         f"{report['run_id']} — нужен прогон по нынешнему коммиту")
    return {"tests": [g[:200] for g in green[:5]], "run_id": report["run_id"],
            "sha": report["sha"]}


def try_close(ctx, card):
    st = L.cstate(ctx, card)
    old = st.get("note")
    if isinstance(old, dict):  # сводка в открытой части идёт за отметками, а не отстаёт от них
        st["note"] = dict(L.public_note(ctx, card, old.get("blocked", "none"),
                                        old.get("blocked_rules") or [], old.get("steps_at_note")),
                          date=old.get("date"), branch=old.get("branch"))
    gaps = L.closure_gaps(ctx, card)
    if gaps:
        print(f"Карточка {card.key} пока открыта: " + "; ".join(gaps[:6])
              + (f"; и ещё {len(gaps) - 6}" if len(gaps) > 6 else ""))
        return
    st["closed"] = {"date": L.today(), "branch": st.get("taken_by")}
    st.pop("reopened", None)
    ctx.log("close", card=card.key, branch=st.get("taken_by"))
    hang = [s for s in card.all_rules if L.rule_view(ctx, ctx.by_slug[s]) != "done"]
    print(f"КАРТОЧКА {card.key} ЗАКРЫТА." + (f" Ждут человека или 1С: {', '.join(hang)}"
                                              if hang else ""))


def cmd_step(ctx, a):
    card = taken_card(ctx, a.card)
    total = len(ctx.steps(card))
    n = a.number
    if n < 1 or n > total:
        raise L.Fail(f"в карточке {card.key} шагов: {total}; шага {n} нет")
    st = L.cstate(ctx, card)
    done = set(st.get("steps_done") or [])
    if n in done:
        print(f"Шаг {n} карточки {card.key} уже отмечен")
        return
    missing = [i for i in range(1, n) if i not in done]
    if missing:
        raise L.Fail(f"шаги идут по порядку: сначала шаг {missing[0]}")
    st["steps_done"] = sorted(done | {n})
    ctx.log("step", card=card.key, step=n)
    tick_card_file(ctx, card, n)
    print(f"ОТМЕЧЕН шаг {n} из {total} карточки {card.key}")
    try_close(ctx, card)


def cmd_rule(ctx, a):
    rule = L.find_rule(ctx, a.rule)
    slug = rule["slug"]
    if rule.get("mark") == "to_look":
        raise L.Fail(f"правило {slug} помечено «досмотреть»: по догадке не делается. Сначала "
                     f"просмотр в живой 1С и правка текста правила")
    card = working_card(ctx, rule)
    waits = L.waits_for(ctx, rule)
    if waits:
        raise L.Fail(f"правило {slug} ждёт просмотра правила {', '.join(waits)} — сделать нельзя")
    if rule.get("problem"):
        raise L.Fail(f"по правилу {slug} открыт вопрос владельцу — сделать нельзя до ответа")
    check_text(ctx, rule)
    branch = ctx.progress["cards"][card.key].get("taken_by")
    stamp = {"hash": rule["text_hash"], "date": L.today(), "card": card.key, "branch": branch}
    parts = ctx.carry.get(slug)
    if a.evidence:
        if slug not in card.evidence:
            raise L.Fail(f"правило {slug} закрывается тестом, а не свидетельством: в карточке "
                         f"{card.key} оно не названо в evidence_rules")
        who = person(a.by, f"свидетельство по правилу {slug}")
        path = Path(a.evidence)
        if not path.is_file() or path.stat().st_size == 0:
            raise L.Fail(f"файл свидетельства не найден или пуст: {path}")
        words = L.confirm_words(a.words, f"свидетельство по правилу {slug}")
        import hashlib
        L.shelve_evidence(rule)  # прежнее свидетельство не затирается новым
        rule["status"] = "done"
        rule["done"] = dict(stamp, kind="evidence",
                            evidence_sha=hashlib.sha256(path.read_bytes()).hexdigest(),
                            **L.write_record(ctx, "evidence", slug, "owner", who, stamp["date"], words))
        print(f"СДЕЛАНО: {slug} ({rule['id']}) — по свидетельству, принял {who}")
    elif parts:
        got = proof(ctx, rule, card, a.run, card.key)
        rule.setdefault("parts_done", {})[card.key] = dict(stamp, **got)
        left = [p for p in parts if not L.part_ok(ctx, rule, p)]
        if left:
            ctx.log("part", rule=slug, card=card.key)
            print(f"ОТМЕЧЕНА ЧАСТЬ: {slug} ({rule['id']}) в карточке {card.key}. Правило станет "
                  f"«сделано», когда будут части карточек: {', '.join(left)}")
            try_close(ctx, card)
            return
        L.shelve_evidence(rule)
        rule["status"] = "done"
        rule["done"] = dict(stamp, kind="parts", parts=list(parts))
        print(f"СДЕЛАНО: {slug} ({rule['id']}) — отмечены все части: {', '.join(parts)}")
    else:
        got = proof(ctx, rule, card, a.run, None)
        L.shelve_evidence(rule)
        rule["status"] = "done"
        rule["done"] = dict(stamp, kind="tests", **got)
        print(f"СДЕЛАНО: {slug} ({rule['id']}) — зелёных тестов с номером в прогоне "
              f"{got['run_id']}: {len(got['tests'])}")
    rule.pop("reset", None)
    ctx.log("done", rule=slug, card=card.key)
    try_close(ctx, card)


def cmd_prelook(ctx, a):
    rule = L.find_rule(ctx, a.rule)
    slug = rule["slug"]
    if rule.get("mark") != "to_look" or not rule.get("pre_look_behavior"):
        raise L.Fail(f"правило {slug} не «досмотреть» с оговоркой «до просмотра»: prelook не нужен")
    card = working_card(ctx, rule, a.card)
    check_text(ctx, rule)
    got = proof(ctx, rule, card, a.run, L.PRE)
    rule["prelook"] = dict({"hash": rule["text_hash"], "date": L.today(), "card": card.key,
                            "kind": "tests"}, **got)
    ctx.log("prelook", rule=slug, card=card.key)
    print(f"ОТМЕЧЕНО поведение «до просмотра»: {slug} ({rule['id']}). "
          f"Правило остаётся «досмотреть»")
    try_close(ctx, card)


def tick_card_file(ctx, card, n):
    """Поставить галочку шага и в файле карточки — чтобы человек видел то же, что команда."""
    path = ctx.card_file(card)
    if path is None:
        return
    import re
    body = path.read_text(encoding="utf-8")
    new, count = re.subn(rf"(?m)^(\s{{0,3}}[-*+]\s*)\[ \](\s*{n}[.)])", r"\1[x]\2", body, count=1)
    if count:
        path.write_text(new, encoding="utf-8")


def write_private(ctx, card, heading, text):
    """Текст записки или вопроса — только в закрытую папку: в файл карточки (перед меткой
    handoff-end или в конец) и в notes/<карточка>.md, который переживает пересборку карточек."""
    L.need_private(ctx, write=True)
    notes = ctx.notes_file(card)
    who = ctx.progress["cards"].get(card.key, {}).get("taken_by") or "-"
    block = f"### {L.today()} · {heading} · ветка {who}\n\n{text.strip()}\n\n"
    notes.parent.mkdir(parents=True, exist_ok=True)
    with open(notes, "a", encoding="utf-8") as f:
        f.write(block)
    path = ctx.card_file(card)
    if path is not None:
        body = path.read_text(encoding="utf-8")
        if L.HANDOFF_END in body:
            body = body.replace(L.HANDOFF_END, block + L.HANDOFF_END, 1)
        else:
            body = body.rstrip("\n") + "\n\n## Записка следующей сессии\n\n" + block
        path.write_text(body, encoding="utf-8")
    return path or notes


def cmd_problem(ctx, a):
    rule = L.find_rule(ctx, a.rule)
    slug = rule["slug"]
    if a.clear:
        if not rule.get("problem"):
            print(f"По правилу {slug} вопроса нет")
            return
        who = person(a.by, "снять вопрос")
        words = L.confirm_words(a.words, f"снять вопрос по правилу {slug}")
        rule.pop("problem")
        L.shelve_cleared(rule)  # прежний ответ владельца не затирается: запись из main неизменяема
        rule["problem_cleared"] = dict(
            {"hash": rule["text_hash"]},
            **L.write_record(ctx, "problem_cleared", slug, "owner", who, L.today(), words))
        ctx.log("problem_clear", rule=slug, role="owner")
        print(f"ВОПРОС СНЯТ: {slug} — {who}. Правило снова надо сделать")
        return
    card = working_card(ctx, rule)
    if a.kind not in ("wrong", "no_data"):
        raise L.Fail("укажи --kind wrong (правило неверно) или --kind no_data (не хватает данных)")
    if not (a.text or "").strip() or len(a.text.strip()) < 20:
        raise L.Fail("опиши вопрос словами (--text, не короче 20 знаков): что не так и что "
                     "нужно от владельца")
    path = write_private(ctx, card, f"ВОПРОС по {slug} ({a.kind})", a.text)
    if rule.get("status") == "done":
        L.reset_rule(ctx, rule, "по правилу поставлен вопрос")
    rule["problem"] = {"kind": a.kind, "hash": rule["text_hash"], "date": L.today(),
                       "card": card.key}
    ctx.log("problem", rule=slug, card=card.key, kind=a.kind)
    print(f"ВОПРОС ПОСТАВЛЕН: {slug} ({rule['id']}). Текст: {path}")
    print("Правило не трогать. Остальные правила карточки делать дальше; ворота впереди "
          "не закроются, пока владелец не ответит.")
    try_close(ctx, card)


def closed_here(ctx, key):
    """Карточка уже закрыта, но в этой же ветке, и ветка ещё не влита в origin/main: записку
    можно дополнить (например, после замечаний к PR). Иначе None."""
    card = L.find_card(ctx, key)
    st = ctx.progress["cards"].get(card.key, {})
    branch = (st.get("closed") or {}).get("branch")
    if card.gate or not branch or not L.is_closed(ctx, card) or st.get("taken_by") != branch:
        return None
    if ctx.use_git and (ctx.current_branch() != branch or branch in ctx.merged_branches()):
        return None
    return card


def cmd_note(ctx, a):
    card = closed_here(ctx, a.card)
    if card is not None:
        L.require_pushed(ctx, card)
    else:
        card = taken_card(ctx, a.card)
    if not (a.text or "").strip() or len(a.text.strip()) < 20:
        raise L.Fail("записка пустая или короче 20 знаков: напиши, что сделано, что осталось "
                     "и что надо знать следующей сессии")
    blocked = (a.blocked or "none").strip().lower()
    if blocked not in L.NOTE_BLOCKED:
        raise L.Fail("--blocked — одно слово из списка: " + ", ".join(L.NOTE_BLOCKED))
    rules = [L.find_rule(ctx, x.strip())["slug"] for x in (a.blocked_rules or "").split(",")
             if x.strip()]
    was_closed = L.is_closed(ctx, card)
    path = write_private(ctx, card, "дополнение к записке" if was_closed
                         else "записка следующей сессии", a.text)
    st = L.cstate(ctx, card)
    st["note"] = L.public_note(ctx, card, blocked, rules)
    ctx.log("note", card=card.key)
    print(f"ЗАПИСКА СОХРАНЕНА: {path}")
    print("В открытую часть записана сводка: " + L.note_line(st["note"]))
    if was_closed:
        print(f"Карточка {card.key} уже закрыта в этой ветке: записка дополнена, закрытие прежнее")
        return
    try_close(ctx, card)


def cmd_gate(ctx, a):
    card = L.find_card(ctx, a.gate)
    if not card.gate:
        raise L.Fail(f"{card.key} — карточка, а не ворота")
    who = person(a.by, f"ворота {card.key}")
    if not a.date:
        raise L.Fail(f"ворота {card.key}: нужна дата подтверждения (--date ГГГГ-ММ-ДД)")
    try:
        day = datetime.date.fromisoformat(a.date)
    except ValueError:
        raise L.Fail(f"ворота {card.key}: дата «{a.date}» не в виде ГГГГ-ММ-ДД")
    if day.isoformat() > L.today():
        raise L.Fail(f"ворота {card.key}: дата {a.date} ещё не наступила")
    missing = L.gate_missing(ctx, card)
    if not missing:
        print(f"Ворота {card.key} уже закрыты")
        return
    role = (a.role or "").strip().lower()
    if not role:
        if len(card.who) != 1:
            raise L.Fail(f"ворота {card.key} подтверждают несколько человек "
                         f"({', '.join(card.who)}): укажи --role")
        role = card.who[0]
    if role not in card.who:
        raise L.Fail(f"ворота {card.key}: роли {role} здесь нет, нужны: {', '.join(card.who)}")
    words = L.confirm_words(a.words, f"ворота {card.key}, {L.ROLE_RU.get(role, role)}")
    if role not in missing:
        raise L.Fail(f"ворота {card.key}: подтверждение роли «{L.ROLE_RU.get(role, role)}» уже "
                     f"записано — запись не переписывается")
    cur = ctx.current_branch()
    if ctx.use_git and cur != card.branch:
        raise L.Fail(f"ворота {card.key} подтверждаются в своей ветке {card.branch} отдельным PR, "
                     f"а ты в ветке {cur}")
    not_closed = [c.key for c in L.before(ctx, card) if not L.is_closed(ctx, c)]
    if not_closed:
        raise L.Fail(f"ворота {card.key} рано закрывать: не закрыты карточки "
                     f"{', '.join(not_closed)}")
    probs = L.open_problems(ctx, L.before(ctx, card))
    if probs:
        raise L.Fail(f"ворота {card.key} не закрываются: по правилам есть вопросы владельцу: "
                     f"{', '.join(probs)}")
    g = ctx.progress["gates"].setdefault(card.key, {})
    conf = [c for c in g.get("confirmations") or [] if c.get("role") != role]
    conf.append(L.write_record(ctx, "gate", card.key, role, who, day.isoformat(), words))
    g["confirmations"] = conf
    ctx.log("gate", gate=card.key, role=role)
    left = L.gate_missing(ctx, card)
    if left:
        print(f"ЗАПИСАНО: ворота {card.key}, {L.ROLE_RU.get(role, role)} — {who}, "
              f"{day.isoformat()}: «{words}». Ещё нужно: {L.who_ru(left)}")
    else:
        print(f"ВОРОТА {card.key} ЗАКРЫТЫ: {L.ROLE_RU.get(role, role)} — {who}, {day.isoformat()}: "
              f"«{words}»")
    rel = ctx.state_in_repo()
    name = __import__("re").sub(r"[^A-Za-z0-9._-]+", "-", card.key) + ".json"
    print(f"В PR ворот идёт только этот файл: `git add {rel or '<папка состояния>'}/progress/{name}` "
          f"— коммит, пуш, PR. Другая работа в том же PR — красная проверка. В файле — роль, "
          f"дата и хэш записи; имя и слова остались в закрытой папке. После мержа запись не "
          f"меняется, владелец видит её на своём экране (status.py).")


def cmd_release(ctx, a):
    card = L.find_card(ctx, a.card)
    who = person(a.by, "снять занятость")
    st = ctx.progress["cards"].get(card.key, {})
    if not st.get("taken_by"):
        print(f"Карточка {card.key} не занята")
        return
    words = L.confirm_words(a.words, f"снять занятость карточки {card.key}")
    was = st.pop("taken_by")
    st.setdefault("released", []).append(dict(
        L.write_record(ctx, "release", card.key, "owner", who, L.today(), words), was=was))
    for s in card.all_rules:
        r = ctx.by_slug[s]
        if r.get("status") == "in_progress":
            r["status"] = "not_started"
    ctx.log("release", card=card.key, branch=was, role="owner")
    print(f"ЗАНЯТОСТЬ СНЯТА: карточка {card.key} (была за веткой {was}) — {who}. "
          f"Если ветка {was} ещё есть в git и не влита в main, удали её (`git push origin "
          f"--delete {was}`): иначе карточка считается занятой")


def main():
    p = L.common_parser(__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("step"); s.add_argument("card"); s.add_argument("number", type=int)
    s = sub.add_parser("rule"); s.add_argument("rule"); s.add_argument("--run")
    s.add_argument("--evidence"); s.add_argument("--by"); s.add_argument("--words")
    s = sub.add_parser("prelook"); s.add_argument("rule"); s.add_argument("--run")
    s.add_argument("--card")
    s = sub.add_parser("problem"); s.add_argument("rule"); s.add_argument("--kind")
    s.add_argument("--text"); s.add_argument("--clear", action="store_true"); s.add_argument("--by")
    s.add_argument("--words")
    s = sub.add_parser("note"); s.add_argument("card"); s.add_argument("--text")
    s.add_argument("--blocked"); s.add_argument("--blocked-rules")
    s = sub.add_parser("gate"); s.add_argument("gate"); s.add_argument("--by")
    s.add_argument("--date"); s.add_argument("--role"); s.add_argument("--words")
    s = sub.add_parser("release"); s.add_argument("card"); s.add_argument("--by")
    s.add_argument("--words")
    sub.add_parser("sync")
    a = p.parse_args()
    ctx = L.Ctx(a)
    L.require_live_state(ctx)
    if a.cmd != "sync":
        L.need_private(ctx, write=True)
        L.require_fresh(ctx)
        L.require_docs(ctx)
    with ctx.locked():
        resets = L.refresh(ctx)
        for line in resets:
            print(line)
        try:
            if a.cmd == "sync":
                print("Сверка с текстом правил выполнена")
            else:
                globals()["cmd_" + a.cmd](ctx, a)
        except L.Fail:
            if resets:
                ctx.save()  # сбросы из сверки сохраняются и при отказе; без них файлы не трогаем
            raise
        if resets or a.cmd != "sync":
            ctx.save()
            sha = L.commit_private(ctx, "erp: " + " ".join(
                str(x) for x in (a.cmd, getattr(a, "card", None) or getattr(a, "rule", None)
                                 or getattr(a, "gate", None), getattr(a, "number", None))
                if x is not None))
            if sha:
                print(f"Закрытая папка сохранена в её git: {sha}")
    return 0


if __name__ == "__main__":
    L.run_main(main)
