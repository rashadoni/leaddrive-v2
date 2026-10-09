#!/usr/bin/env python3
"""status — экран владельца: где работа сейчас. Ничего не меняет.

По срезам: карточек всего / сделано / в работе; правил сделано / всего / заблокировано
(заблокировано = ждут просмотра живой 1С или ответа владельца). Ниже — карточки в работе,
что будет выдано следующим, ближайшие ворота, ПРОЙДЕННЫЕ ВОРОТА с датой и дословными
словами (владелец сам видит ворота, которых не открывал) и то, что требует человека.

  python3 status.py
  python3 status.py --screen <OWNER_SCREEN.md>   обновить в файле экрана владельца раздел
        «Пройденные ворота» (между метками <!-- gates-begin --> и <!-- gates-end -->)
Только стандартная библиотека.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_lib as L  # noqa: E402


GATES_BEGIN, GATES_END = "<!-- gates-begin -->", "<!-- gates-end -->"


def gates_md(ctx) -> str:
    """Раздел экрана владельца: каждые ворота с записью — дата и дословные слова."""
    rows = L.passed_gates(ctx)
    if not rows:
        return "Пока ни одни ворота не пройдены."
    out = ["| Ворота | Кто | Дата | Слова дословно |", "| --- | --- | --- | --- |"]
    for c, conf in rows:
        for k in conf:
            words = str(k.get("words") or "слов нет").replace("|", "/")
            out.append(f"| {c.key} · {c.title} | {L.ROLE_RU.get(k.get('role'), k.get('role'))}: "
                       f"{k.get('by')} | {k.get('date')} | «{words}» |")
    out += ["", "Видите здесь ворота, которых не открывали, или не свои слова — напишите в чат "
                "«ворота NNN я не открывал»: это остановка работы."]
    return "\n".join(out)


def write_screen(ctx, path: Path) -> int:
    if not path.is_file():
        raise L.Fail(f"нет файла экрана владельца: {path}")
    body = path.read_text(encoding="utf-8")
    if GATES_BEGIN not in body or GATES_END not in body:
        raise L.Fail(f"в {path.name} нет меток {GATES_BEGIN} и {GATES_END}")
    head, rest = body.split(GATES_BEGIN, 1)
    tail = rest.split(GATES_END, 1)[1]
    new = head + GATES_BEGIN + "\n" + gates_md(ctx) + "\n" + GATES_END + tail
    if new != body:
        path.write_text(new, encoding="utf-8")
    print(f"Экран владельца: раздел «Пройденные ворота» в {path} "
          + ("обновлён" if new != body else "без изменений"))
    return 0


def main():
    p = L.common_parser(__doc__)
    p.add_argument("--screen", metavar="ФАЙЛ", help="обновить раздел «Пройденные ворота» в файле")
    args = p.parse_args()
    ctx = L.Ctx(args)
    if args.screen:
        return write_screen(ctx, Path(args.screen))
    order_errors, _ = L.validate_order(ctx)
    alarms = [w for w in (L.moved_problem(ctx), L.origin_problem(ctx),
                          L.private_problem(ctx, write=True)) if w] + L.docs_drift(ctx)

    work = [c for c in ctx.cards if not c.gate]
    gates = [c for c in ctx.cards if c.gate]
    in_work = [c for c in work if L.holder(ctx, c)]
    views = {r["slug"]: L.rule_view(ctx, r) for r in ctx.rules}
    slices = []
    for r in ctx.rules:
        if str(r.get("slice")) not in slices:
            slices.append(str(r.get("slice")))
    for c in work:
        if str(c.slice) not in slices:
            slices.append(str(c.slice))
    slices.sort(key=lambda s: (not s.isdigit(), L.natural(s)))

    print(f"ERP «Склад и Бухгалтерия» — состояние на {L.today()}")
    print(f"{'Срез':<7}| карточки: {'всего':>5} {'сделано':>7} {'в работе':>8} "
          f"| правила: {'сделано':>7} {'всего':>5} {'заблокировано':>13}")
    tot = [0] * 6
    line = "{:<7}|           {:>5} {:>7} {:>8} |          {:>7} {:>5} {:>13}"
    for s in slices:
        cs = [c for c in work if str(c.slice) == s]
        rs = [r for r in ctx.rules if str(r.get("slice")) == s]
        row = [len(cs), sum(1 for c in cs if L.is_closed(ctx, c)),
               sum(1 for c in cs if c in in_work),
               sum(1 for r in rs if views[r["slug"]] == "done"), len(rs),
               sum(1 for r in rs if views[r["slug"]] in ("look", "waits", "problem"))]
        tot = [a + b for a, b in zip(tot, row)]
        print(line.format(s, *row))
    print(line.format("Всего", *tot))

    if in_work:
        for c in in_work[:4]:
            st = ctx.progress["cards"].get(c.key, {})
            steps = len(ctx.steps(c))
            done = sum(1 for s in c.all_rules
                       if L.rule_view(ctx, ctx.by_slug[s], c) in ("done", "part_done"))
            print(f"В работе: карточка {c.key} «{c.title[:36]}» — ветка {L.holder(ctx, c)} "
                  f"с {st.get('taken_at', '?')}, шаги {len(st.get('steps_done') or [])} из {steps}, "
                  f"правила {done} из {len(c.all_rules)}")
    else:
        print("В работе: ни одной карточки")
    res = L.pick_next(ctx)
    if res["kind"] == "card":
        c = res["card"]
        print(f"Следующей будет выдана: карточка {c.key} «{c.title[:60]}» (срез {c.slice})")
    elif res["kind"] == "gate":
        print(f"Следующей карточки нет: работа стоит на воротах {res['card'].key}")
    elif res["kind"] == "outline":
        print(f"Следующая карточка {res['card'].key} «{res['card'].title[:50]}» ещё не расписана: "
              f"нужно расписать карточки этого среза")
    elif res["kind"] == "wait":
        print(f"Следующей карточки пока нет: {res['why']}")
    else:
        print("Все карточки и ворота закрыты")

    gate = next((g for g in gates if not L.is_closed(ctx, g)), None)
    if gate:
        left = [c for c in L.before(ctx, gate) if not c.gate and not L.is_closed(ctx, c)]
        need = L.who_ru(L.gate_missing(ctx, gate))
        when = "ЖДУТ ВАС СЕЙЧАС" if not left and res["kind"] == "gate" else \
            f"до них открытых карточек: {len(left)}"
        print(f"Ближайшие ворота: {gate.key} «{gate.title[:40]}» — подтверждает: {need}; {when}")
    else:
        print("Ближайшие ворота: все ворота пройдены" if gates else "Ближайшие ворота: в порядке нет ворот")
    passed = L.passed_gates(ctx)
    if passed:
        print("Пройденные ворота (дата и слова дословно; не открывали — напишите в чат):")
        for c, conf in passed[-6:]:
            state = "" if L.is_closed(ctx, c) else " [ещё не закрыты]"
            for k in conf:
                print(f"  {c.key}{state}: {L.gate_line(k)}")
    else:
        print("Пройденные ворота: пока нет")

    probs = [r["slug"] for r in ctx.rules if r.get("problem")]
    if probs:
        print(f"Вопросы к вам по правилам ({len(probs)}): " + ", ".join(probs[:8])
              + (" …" if len(probs) > 8 else ""))
    resets = [f"{r['slug']} ({r['reset'].get('date') or 'при пересборке реестра'})"
              for r in ctx.rules if r.get("reset") and not L.is_done(ctx, r)][:4]
    resets += [f"карточка {k} открыта снова ({st['reopened'].get('date')})"
               for k, st in ctx.progress["cards"].items() if st.get("reopened")][:3]
    stale = [r["slug"] for r in ctx.rules if r.get("status") == "done" and not L.is_done(ctx, r)]
    if stale:
        print(f"Текст изменился, отметка недействительна ({len(stale)}): " + ", ".join(stale[:8]))
    if resets:
        print("Сброшено из-за изменения текста: " + "; ".join(resets))
    if order_errors:
        print(f"Порядок карточек неисправен ({len(order_errors)}): {order_errors[0]}")
    for c in work:
        if not L.is_closed(ctx, c) and c.branch in ctx.erp_branches() and c.branch in ctx.merged_branches():
            print(f"ВНИМАНИЕ: карточка {c.key} открыта, а её ветка {c.branch} влита в origin/main и осталась "
                  f"на GitHub — удалить: git push origin --delete {c.branch}")
    for w in alarms[:3]:
        print("ВНИМАНИЕ: " + w[:230])
    return 0


if __name__ == "__main__":
    L.run_main(main)
