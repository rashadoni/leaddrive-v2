#!/usr/bin/env python3
"""export_public — собирает то, что можно положить в открытый репозиторий.

Из закрытой папки (reports/exec) в папку репозитория (--to, например scripts/erp) пишет:
  registry.json — по правилу только: id, slug, title, mark, slice, pre_look_behavior,
                  blocked_by, text_hash и состояние (status, done, prelook, problem, reset,
                  журналы записей владельца evidence_log и problem_cleared_log; записи владельца
                  по правилам, ушедшим из документа, — в разделе retired);
  order.json    — плоский список cards; по карточке только: number, slice, slug, title, kind,
                  rules (номера), after, parallel_ok, who, steps (ЧИСЛО шагов), признаки
                  outline / prep / decision_gate, evidence_rules, held (номера), и блок
                  carry (номер правила и карточки его частей) — без текста карточек;
  progress/     — если его там ещё нет: состояние карточек и ворот из закрытой папки,
                  по файлу на карточку (номера, ветки, даты; у записей человека — роль, дата
                  и хэш: имя и дословные слова остаются в закрытой папке, records/);
  команды       — erp_lib.py, next_card.py, mark.py, check_progress.py, status.py, selftest.py,
                  ci_report.py, export_public.py (нужна самопроверке).
Больше в репозиторий эта команда ничего не кладёт.
Выкладка — последнее звено цепочки «документ изменили»: команда откажет, если документ
изменился после сборки реестра или файлы карточек собраны не из нынешнего реестра. При
первой выкладке в scripts/erp закрытая копия состояния помечается «переехало»: дальше
правда о «сделано» — в репозитории, команды запускаются оттуда.
Текст правил, карточки, записки, источники и разделы документа туда не попадают: команда
сама проверяет результат и откажет, если нашла лишнее поле или длинную строку.

Состояние (что сделано) берётся из папки назначения, если реестр там уже есть: после
первой выкладки правда о «сделано» живёт в репозитории. Номера, названия, срезы и хэши
берутся из закрытого реестра. Если хэш правила изменился — отметка «сделано» сбрасывается.

  python3 export_public.py --to <папка> [--dry-run]
Только стандартная библиотека.
"""
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_lib as L  # noqa: E402

RULE_PUBLIC = ["id", "slug", "title", "mark", "slice", "pre_look_behavior", "blocked_by", "text_hash"]
RULE_STATE = ["status", "done", "parts_done", "prelook", "problem", "problem_cleared",
              "problem_cleared_log", "evidence_log", "reset"]
CARD_PUBLIC = ["number", "slice", "slug", "title", "kind", "after", "parallel_ok", "prep",
               "decision_gate"]
TOOLS = ["erp_lib.py", "next_card.py", "mark.py", "check_progress.py", "status.py", "selftest.py",
         "ci_report.py", "export_public.py"]
MAX_STRING = 200


def long_strings(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from long_strings(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from long_strings(v, f"{path}[{i}]")
    elif isinstance(node, str) and len(node) > MAX_STRING:
        yield path


def main():
    p = L.common_parser(__doc__)
    p.add_argument("--to", required=True, help="папка в репозитории, куда писать")
    p.add_argument("--dry-run", action="store_true", help="только показать, что изменится")
    args = p.parse_args()
    ctx = L.Ctx(args)
    errors, _ = L.validate_order(ctx)
    if errors:
        raise L.Fail("порядок карточек неисправен, выкладывать нельзя: " + errors[0])
    target = Path(args.to).resolve()
    if target == ctx.dir:
        raise L.Fail("--to указывает на саму закрытую папку")
    drift = [d for d in L.docs_drift(ctx) if "открытый нет" not in d]
    if drift:
        raise L.Fail(f"выкладывать рано: {drift[0]}. Порядок: {L.DOC_CHAIN}")
    stale = L.cards_problem(ctx)
    if stale:
        raise L.Fail("выкладывать рано: " + stale)

    state, retired = {}, dict(ctx.registry.get("retired") or {})  # первая выкладка: из закрытого реестра
    if (target / "registry.json").exists():
        old = json.loads((target / "registry.json").read_text(encoding="utf-8"))
        state = {r["slug"]: r for r in old.get("rules") or []}
        retired = dict(old.get("retired") or {})
    rules, reset, added = [], [], []
    for r in ctx.rules:
        out = {k: r.get(k) for k in RULE_PUBLIC}
        src = state.get(r["slug"])
        if src is None:
            added.append(r["slug"])
            src = r if not state else {}
        for k in RULE_STATE:
            if src.get(k) is not None:
                out[k] = src[k]
        out.setdefault("status", L.default_status(r))
        if out.get("status") == "done" and ((out.get("done") or {}).get("hash") != out["text_hash"]
                                            or out["mark"] == "to_look"):
            out["reset"] = {"reason": "текст или пометка правила изменились", "date": L.today(),
                            "old_status": "done", "old_hash": (out.get("done") or {}).get("hash")}
            L.shelve_evidence(out)  # свидетельство владельца остаётся в журнале
            out.pop("done", None)
            out["status"] = L.default_status(r)
            reset.append(r["slug"])
        for k in ("prelook", "problem"):
            if out.get(k) and out[k].get("hash") != out["text_hash"]:
                out.pop(k)
        if (out.get("problem_cleared") or {}).get("hash") not in (None, out["text_hash"]):
            L.shelve_cleared(out)  # ответ владельца к прежнему тексту — в журнал
        parts = {k: v for k, v in (out.get("parts_done") or {}).items()
                 if v.get("hash") == out["text_hash"]}
        if parts:
            out["parts_done"] = parts
        else:
            out.pop("parts_done", None)
        if out["mark"] == "to_look":
            out["status"] = "blocked_to_look"
        elif out["status"] == "blocked_to_look":
            out["status"] = "not_started"
        rules.append(out)
    removed = sorted(set(state) - {r["slug"] for r in ctx.rules})
    for s in removed:
        # правило ушло из документа, а записи владельца по нему остаются: registry["retired"]
        ev, cl = L.owner_records(state[s], retired.get(s))
        if ev or cl:
            retired[s] = {"evidence_log": [k for i, k in enumerate(ev) if k not in ev[:i]],
                          "problem_cleared_log": [k for i, k in enumerate(cl) if k not in cl[:i]]}
    meta_src = ctx.registry.get("meta") or {}
    registry = {
        "meta": {
            "schema": 1,
            "what": "Реестр правил модулей «Склад» и «Бухгалтерия»: номера, названия, срезы, "
                    "состояния. Текст правил хранится вне репозитория.",
            "hash_rule": "text_hash — sha256 дословного текста правила; изменился текст — "
                         "изменился хэш, отметка «сделано» сбрасывается",
            "marks": meta_src.get("marks") or L.MARK_RU,
            "statuses": meta_src.get("statuses") or ["not_started", "in_progress", "done",
                                                     "blocked_to_look"],
            "exported": L.today(),
        },
        "rules": rules,
    }
    if retired:
        registry["retired"] = retired
    cards = []
    for c in ctx.cards:
        out = {k: c.raw.get(k) for k in CARD_PUBLIC if k in c.raw}
        out["slug"] = c.slug
        out["rules"] = list(c.rules)
        if c.gate:
            out["who"] = c.who
        else:
            out["steps"] = len(ctx.steps(c))
        if c.outline:
            out["detail"] = "outline"
        if c.evidence:
            out["evidence_rules"] = sorted(c.evidence)
        if c.held:
            out["held"] = [{"rule": s, "waits_for": w} for s, w in c.held.items()]
        cards.append(out)
    order = {"cards": cards}
    if ctx.carry:
        order["carry"] = [{"slug": s, "parts": parts} for s, parts in sorted(ctx.carry.items())]
    if isinstance(ctx.order_raw, dict) and ctx.order_raw.get("tests_roots"):
        order["tests_roots"] = ctx.order_raw["tests_roots"]

    bad = list(long_strings(registry)) + list(long_strings(order))
    if bad:
        raise L.Fail(f"в выкладке строка длиннее {MAX_STRING} знаков ({bad[0]}): похоже на текст "
                     f"правила или карточки — в открытый репозиторий не пишу")
    named = L.secret_fields({"registry": {"rules": rules, "retired": retired},
                             "progress": {k: ctx.progress[k] for k in ("cards", "gates")}})
    if named:
        raise L.Fail(f"в выкладке есть имя или слова человека ({named[0]}): в открытый репозиторий "
                     f"идут только роль, дата и хэш записи — имя и слова остаются в закрытой "
                     f"папке ({L.RECORDS}/)")

    print(f"Правил: {len(rules)} (новых {len(added) if state else 0}, сброшено {len(reset)}, "
          f"исчезло из документа {len(removed)}); карточек и ворот: {len(cards)}")
    for s in reset:
        print(f"  СБРОШЕНО: {s} — текст правила изменился")
    for s in removed:
        print(f"  ВНИМАНИЕ: правила {s} больше нет в документе — из реестра убрано")
    if args.dry_run:
        print("Проба: ничего не записано")
        return 0
    target.mkdir(parents=True, exist_ok=True)
    L._write_json(target / "registry.json", registry)
    L._write_json(target / "order.json", order)
    if not (target / "progress").exists():
        # первая выкладка: карточки и ворота переезжают вместе с отметками правил
        (target / "progress").mkdir()
        for bucket, kind in (("cards", "card"), ("gates", "gate")):
            for key, st in ctx.progress[bucket].items():
                if st:
                    L._write_json(target / "progress" / f"{key}.json",
                                  {"key": key, "kind": kind, "state": st})
        if target.as_posix().endswith("scripts/erp"):
            # с этой минуты закрытая копия состояния — старая: команды её не примут
            L._write_json(ctx.dir / L.STATE_MOVED, {
                "to": "scripts/erp в репозитории", "date": L.today(),
                "why": "состояние работы выложено в открытый репозиторий (карточка 001)"})
    for name in TOOLS:
        src = L.HERE / name
        if src.exists() and src.resolve() != (target / name).resolve():
            old = (target / name).read_bytes() if (target / name).is_file() else None
            if old is not None and old != src.read_bytes():
                # правка, сделанная только в папке назначения, здесь пропадает — пусть это видно
                print(f"ВНИМАНИЕ: команда {name} в {target} отличалась и заменена версией из {L.HERE}")
            shutil.copyfile(src, target / name)
    print(f"Записано в {target}: registry.json, order.json, progress/ и команды")
    return 0


if __name__ == "__main__":
    L.run_main(main)
