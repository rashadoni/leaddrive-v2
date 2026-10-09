#!/usr/bin/env python3
"""next_card — выдаёт РОВНО ОДНУ карточку: ту, с которой сессия работает сейчас.

Правило выбора: первая по номеру карточка, которая не закрыта, у которой закрыты все
карточки из «после», и которая не занята другой веткой. Карточка занята, если её взяли
(--take) или на GitHub уже есть ветка erp/<номер>-<slug>, ещё не влитая в origin/main
(влитая ветка — след прошлого закрытия, занятостью не считается). Карточка с кодом продукта
(parallel_ok = false) в работе одна; карточку без кода (parallel_ok = true) ведут рядом.
Если очередь упёрлась в ворота — карточка не выдаётся, печатается, чьё действие нужно.

  python3 next_card.py                       показать карточку
  python3 next_card.py --take erp/<n>-<slug> пометить её занятой этой веткой
  python3 next_card.py --full                то же и полный текст файла карточки

Перед выдачей команда сама: делает `git fetch origin --prune` и отказывает, если дерево
не содержит origin/main (рабочая копия сессии создаётся заранее и отстаёт — по ней выдали
бы закрытую или занятую карточку); сверяет документ с реестром (документ изменился —
отказ); проверяет, что файлы карточек собраны из нынешнего реестра; требует закрытую
папку с текстом правил.

Взять можно только ту карточку, которую команда выдала бы сама, и только стоя в её ветке
(`git switch -c erp/<n>-<slug> origin/main`). Взятие действует, когда оно запушено: сразу
после --take — коммит и `git push -u origin <ветка>`. Пуш отвергнут — карточку взяла
другая сессия. Ветка, у которой уже есть незакрытая карточка, получает её же (продолжение).

Коды возврата: 0 — карточка выдана; 2 — ворота, ждём человека; 3 — взять нечего,
ждём занятые карточки; 4 — всё закрыто; 5 — карточка ещё не расписана; 1 — отказ или ошибка.
Только стандартная библиотека.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_lib as L  # noqa: E402

SIGN = {"done": "[x]", "part_done": "[x]", "open": "[ ]", "problem": "[?]", "look": "[~]",
        "waits": "[~]"}
HINT = {
    "done": "сделано",
    "part_done": "часть этой карточки сделана",
    "open": "сделать",
    "problem": "вопрос владельцу — не трогать до ответа",
    "look": "досмотреть — делать нельзя",
    "waits": "ждёт просмотра другого правила — делать нельзя",
}


def short(path):
    """Путь покороче: относительно текущей папки, если так короче."""
    rel = os.path.relpath(path)
    return rel if len(rel) < len(str(path)) else str(path)


def print_card(ctx, card, resume, full):
    st = ctx.progress["cards"].get(card.key, {})
    who = L.holder(ctx, card)
    state = "продолжение — карточка уже за этой веткой" if resume else \
        (f"занята веткой {who}" if who else "свободна")
    print(f"КАРТОЧКА {card.key} — «{card.title}»")
    print(f"Срез: {card.slice}   Вид: {card.kind}   Ветка: {card.branch}   Состояние: {state}")
    if st.get("reopened"):
        print(f"ВНИМАНИЕ: карточка была закрыта и открыта снова {st['reopened'].get('date')}: "
              + "; ".join(st["reopened"].get("why") or []))
    if not resume and card.branch in ctx.erp_branches() and card.branch in ctx.merged_branches():
        print(f"ВЕТКА {card.branch} уже влита в origin/main (прошлое закрытие карточки) и карточку "
              f"не держит. До взятия удали её: `git push origin --delete {card.branch}` и "
              f"`git branch -D {card.branch}`, затем `git switch -c {card.branch} origin/main`.")
    path = ctx.card_file(card)
    if path:
        print(f"Файл карточки (прочитай целиком до начала работы): {path}")
    elif ctx.private is None:
        print("Файл карточки: закрытая папка не задана (--private или ERP_PRIVATE) — "
              "без текста правил работать нельзя")
    else:
        print(f"Файл карточки не найден в {ctx.private / 'cards'}")
    note = ctx.last_note(card)
    if isinstance(st.get("note"), dict) and "steps_done" in st["note"]:
        print("Записка прошлой сессии (сводка из репозитория): " + L.note_line(st["note"]))
    if note:
        print("Записка прошлой сессии (полный текст, закрытая папка):")
        for ln in note.splitlines():
            print("  " + ln)
    elif st.get("note"):
        print(f"ВНИМАНИЕ: записка отмечена, а её текста в {ctx.notes_file(card)} нет — "
              f"закрытая папка не та или не обновлена")
    steps = ctx.steps(card)
    done_steps = set(st.get("steps_done") or [])
    if steps:
        print(f"Шаги ({len([i for i in range(1, len(steps) + 1) if i in done_steps])} "
              f"из {len(steps)}), строго по порядку:")
        nxt = next((i for i in range(1, len(steps) + 1) if i not in done_steps), None)
        for i, title in enumerate(steps, 1):
            tail = "   <- следующий" if i == nxt else ""
            print(f"  {'[x]' if i in done_steps else '[ ]'} {i}. {title[:110]}{tail}")
    else:
        print("Шаги: в карточке не найдены (раздел «Шаги» с галочками) — сообщи владельцу")
    views = [(s, L.rule_view(ctx, ctx.by_slug[s], card)) for s in card.all_rules]
    n_done = sum(1 for _, v in views if v in ("done", "part_done"))
    if views:
        print(f"Правила ({n_done} из {len(views)} сделано), номер для теста — в первом столбце:")
    else:
        print("Правила: у карточки нет правил — она закрывается шагами и запиской")
    for s, v in views:
        r = ctx.by_slug[s]
        extra = ""
        parts = ctx.carry.get(s)
        if v == "waits":
            extra = " (" + ", ".join(L.waits_for(ctx, r)) + ")"
        elif v == "look" and r.get("pre_look_behavior"):
            extra = "; поведение «до просмотра» " + (
                "отмечено" if L.prelook_ok(ctx, r) else f"кодируется, тест {s}#pre")
        elif parts and v in ("open", "part_done"):
            extra = f"; правило с продолжением: здесь нужен тест {s}#{card.key}, части — в " \
                    f"карточках {', '.join(parts)}"
        elif s in card.evidence and v == "open":
            extra = "; закрывается свидетельством (--evidence), а не тестом"
        print(f"  {SIGN[v]} {s:<14} {r['id']:<10} {r.get('title', '')[:60]} — {HINT[v]}{extra}")
    gaps = L.closure_gaps(ctx, card)
    print("До закрытия карточки осталось: " + ("" if gaps else "ничего"))
    for g in gaps[:10]:
        print("  - " + g)
    if len(gaps) > 10:
        print(f"  - … и ещё {len(gaps) - 10}")
    tools = short(Path(__file__).resolve().parent)
    print("Команды:")
    if not st.get("taken_by"):
        print(f"  взять:    python3 {tools}/next_card.py --take {card.branch}")
    print(f"  шаг:      python3 {tools}/mark.py step {card.key} <номер шага>")
    print(f"  правило:  python3 {tools}/mark.py rule <номер правила> --run <номер прогона GitHub>")
    print(f"  вопрос:   python3 {tools}/mark.py problem <номер правила> --kind wrong|no_data "
          f"--text \"…\"")
    print(f"  записка:  python3 {tools}/mark.py note {card.key} --text \"…\" "
          f"[--blocked owner|client|look_1c|ci|data|other --blocked-rules <правила>]")
    if full and path:
        print("\n" + "=" * 30 + " ТЕКСТ КАРТОЧКИ " + "=" * 30)
        print(path.read_text(encoding="utf-8"))


def print_gate(ctx, res):
    c = res["card"]
    tools = short(Path(__file__).resolve().parent)
    print(f"ВОРОТА {c.key} — «{c.title}»")
    print(f"Нужно действие: {L.who_ru(res['need'])}. Сессия дальше не идёт и карточек не берёт.")
    path = ctx.card_file(c)
    if path:
        print(f"Что подготовить владельцу к воротам — в файле: {path}")
    if c.decision:
        print("Это ворота-решение: слова решения владельца записываются в --words.")
    conf = ctx.progress["gates"].get(c.key, {}).get("confirmations") or []
    for k in conf:
        print(f"  уже подтвердил: {L.gate_line(k)}")
    if res["problems"]:
        print("Ворота не закроются, пока есть вопросы по правилам: " + ", ".join(res["problems"]))
    waits = sorted({s for p in L.before(ctx, c) for s in p.all_rules
                    if L.rule_view(ctx, ctx.by_slug[s]) in ("look", "waits")})
    if waits:
        print(f"Ждут просмотра живой 1С (воротам не мешают, владельцу показать): "
              f"{', '.join(waits[:10])}" + (f" … и ещё {len(waits) - 10}" if len(waits) > 10 else ""))
    ahead = sorted({s for p in L.before(ctx, c) for s in p.all_rules
                    if s in ctx.carry and s not in waits and not L.is_done(ctx, ctx.by_slug[s])})
    if ahead:
        print("Правила с продолжением: части до этих ворот сделаны, остальные — в карточках дальше "
              "(воротам не мешают): " + ", ".join(
                  f"{s} ({', '.join(k for k in ctx.carry[s] if not L.part_ok(ctx, ctx.by_slug[s], k))})"
                  for s in ahead[:12]) + (f" … и ещё {len(ahead) - 12}" if len(ahead) > 12 else ""))
    print("По своей инициативе ворота не закрываются. Порядок: показать владельцу короткий список "
          "(что сделано, что увидит клиент) → дождаться ЕГО сообщения в этом разговоре → записать "
          "его слова дословно.")
    print("Разговор был сжат и самого сообщения в видимой части нет — спросить ещё раз: по памяти, "
          "по своим прежним репликам и по сообщениям системы подтверждение не записывается.")
    print(f"Запись — в ветке {c.branch} (`git switch -c {c.branch} origin/main`), отдельным PR, "
          f"в котором меняется только файл этих ворот:")
    for role in res["need"]:
        what = "<дословные слова владельца>" if role == "owner" else \
            "<что сделал клиент и где лежит свидетельство>"
        print(f"  python3 {tools}/mark.py gate {c.key} --role {role} --by \"<имя>\" "
              f"--date ГГГГ-ММ-ДД --words \"{what}\"")
    print("Машина подтверждения владельца не проверяет. Защита — отдельный PR, неизменяемость "
          "записи после мержа и экран владельца, где он видит дату и свои слова.")


def main():
    p = L.common_parser(__doc__)
    p.add_argument("--take", metavar="ВЕТКА", help="пометить выданную карточку занятой этой веткой")
    p.add_argument("--full", action="store_true", help="напечатать и полный текст файла карточки")
    args = p.parse_args()
    ctx = L.Ctx(args)
    errors, _ = L.validate_order(ctx)
    hard = [e for e in errors if "не попало ни в одну карточку" not in e]
    if hard:
        raise L.Fail("порядок карточек неисправен: " + hard[0])
    L.require_live_state(ctx)
    L.need_private(ctx, write=bool(args.take))
    L.require_fresh(ctx, fetch=True)
    L.require_docs(ctx)
    stale = L.cards_problem(ctx)
    if stale:
        raise L.Fail(stale)

    if not args.take:
        why = L.private_problem(ctx, write=True)
        if why:
            print("ВНИМАНИЕ: " + why)
        res = L.pick_next(ctx, me=ctx.current_branch())
        return show(ctx, res, args.full)

    branch = args.take.strip()
    with ctx.locked():
        resets = L.refresh(ctx)
        for line in resets:
            print(line)
        if resets:
            ctx.save()
        mine = L.card_for_branch(ctx, branch)
        if mine is None:
            raise L.Fail(f"ветка {branch} не соответствует ни одной карточке: "
                         f"имя должно быть erp/<номер>-<slug> из выданной карточки")
        cur = ctx.current_branch()
        if cur and cur.startswith("erp/") and cur != branch:
            raise L.Fail(f"ты в ветке {cur}: взять можно только свою карточку, а не {branch}")
        if ctx.use_git and cur != branch:
            raise L.Fail(f"карточка берётся из её ветки, а ты в ветке {cur}. Сначала: "
                         f"`git switch -c {branch} origin/main`. Git ответил, что ветка уже "
                         f"есть, — карточку взяла другая сессия: запусти next_card.py снова")
        if ctx.git_ok("rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{branch}") and \
                not ctx.git_ok("merge-base", "--is-ancestor", f"refs/remotes/origin/{branch}", "HEAD"):
            raise L.Fail(f"ветка {branch} уже есть на GitHub и она не твоя: карточка {mine.key} "
                         f"занята другой сессией. Удали свою местную ветку и запусти "
                         f"next_card.py снова")
        if branch in ctx.erp_branches() and cur != branch and \
                ctx.progress["cards"].get(mine.key, {}).get("taken_by") != branch:
            raise L.Fail(f"ветка {branch} уже существует: карточка {mine.key} занята другой сессией")
        res = L.pick_next(ctx, me=branch)
        if res["kind"] == "card" and res["card"].key != mine.key:
            raise L.Fail(f"нельзя взять карточку {mine.key} не по порядку: сейчас выдаётся "
                         f"карточка {res['card'].key} (ветка {res['card'].branch})")
        if res["kind"] != "card":
            show(ctx, res, False)
            print(f"ОТКАЗ: карточку {mine.key} сейчас взять нельзя")
            return 1
        card = res["card"]
        st = L.cstate(ctx, card)
        if st.get("taken_by") != branch:
            st["taken_by"] = branch
            st["taken_at"] = L.today()
            for s in card.all_rules:
                r = ctx.by_slug[s]
                if r.get("status") == "not_started":
                    r["status"] = "in_progress"
            ctx.log("take", card=card.key, branch=branch)
        ctx.save()
        L.commit_private(ctx, f"erp: take {card.key}")
        print(f"ВЗЯТА: карточка {card.key} за веткой {branch}")
        rel = ctx.state_in_repo()
        if rel is not None:
            print(f"СЕЙЧАС ЖЕ, до любой работы: `git add {rel} && git commit -m \"erp "
                  f"{card.key}: взята\" && git push -u origin {branch}` и PR черновиком. "
                  f"Взятие действует, когда оно на GitHub; без пуша mark.py отметок не примет.")
            print("Пуш отвергнут (non-fast-forward) — карточку взяла другая сессия: удалить "
                  "местную ветку, запустить next_card.py снова. Force-push запрещён.")
        print_card(ctx, card, True, args.full)
        return 0


def show(ctx, res, full):
    if res["kind"] == "card":
        print_card(ctx, res["card"], res["resume"], full)
        return 0
    if res["kind"] == "gate":
        print_gate(ctx, res)
        return 2
    if res["kind"] == "outline":
        c = res["card"]
        print(f"КАРТОЧКА {c.key} — «{c.title}» — ЕЩЁ НЕ РАСПИСАНА (в порядке стоит как outline).")
        print("Брать её нельзя и придумывать её содержание — тоже. Сообщи владельцу: перед этим "
              "срезом карточки нужно расписать и пересобрать порядок.")
        return 5
    if res["kind"] == "wait":
        print("КАРТОЧКИ НЕТ: " + res["why"])
        print("Новую работу не начинать. Дождаться занятых карточек или спросить владельца.")
        return 3
    print("ВСЁ ЗАКРЫТО: карточек и ворот не осталось.")
    return 4


if __name__ == "__main__":
    L.run_main(main)
