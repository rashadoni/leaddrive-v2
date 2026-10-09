#!/usr/bin/env python3
"""ci_report — помечает отчёт тестов правил, который только что написал шаг GitHub.

Шаг перед этим:  npx vitest run src/__tests__/erp- --reporter=json --outputFile=erp-tests.json
Команда дописывает в отчёт блок "erp": коммит ветки, номер прогона, ветку и признак того,
что тестам была дана настоящая база (ERP_TEST_DATABASE_URL). По этому блоку mark.py и
check_progress.py узнают, какого коммита отчёт.

Отчёта нет:
  - тестов правил в дереве ещё нет (ни одного src/__tests__/erp-*.test.ts) — пишется
    пустой отчёт, это нормальное начало;
  - тесты есть, а отчёта нет — ошибка (код 1): неизвестное состояние зелёным не считается.

  python3 scripts/erp/ci_report.py erp-tests.json
Только стандартная библиотека.
"""
import json
import os
import re
import sys
from pathlib import Path

TEST_FILE = re.compile(r"^erp-[A-Za-z0-9._-]+\.test\.ts$")


def main():
    if len(sys.argv) < 2:
        print("ОТКАЗ: укажи файл отчёта: ci_report.py erp-tests.json")
        return 1
    path = Path(sys.argv[1])
    root = Path(os.environ.get("GITHUB_WORKSPACE") or ".") / "src" / "__tests__"
    have = sorted(p.name for p in root.glob("erp-*.test.ts") if TEST_FILE.match(p.name)) \
        if root.is_dir() else []
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except json.JSONDecodeError as e:
            print(f"ОТКАЗ: {path} не читается как JSON: {e}")
            return 1
        if not isinstance(data, dict) or not isinstance(data.get("testResults"), list):
            print(f"ОТКАЗ: {path} — не отчёт vitest (нет списка testResults)")
            return 1
    elif have:
        print(f"ОТКАЗ: тесты правил есть ({len(have)} файлов), а отчёта {path} нет — "
              f"шаг vitest не дошёл до конца")
        return 1
    else:
        data = {"testResults": [], "numTotalTests": 0}
    ran = {os.path.basename(str(f.get("name", ""))) for f in data["testResults"]}
    lost = [n for n in have if n not in ran]
    if lost:
        print(f"ОТКАЗ: в отчёт не попали файлы тестов правил: {', '.join(lost[:8])}")
        return 1
    data["erp"] = {
        "head_sha": os.environ.get("HEAD_SHA") or os.environ.get("GITHUB_SHA") or "",
        "merge_sha": os.environ.get("GITHUB_SHA") or "",
        "run_id": os.environ.get("GITHUB_RUN_ID") or "",
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT") or "",
        "branch": os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME") or "",
        "db": bool(os.environ.get("ERP_TEST_DATABASE_URL")),
    }
    count = {"passed": 0, "failed": 0, "other": 0}
    for f in data["testResults"]:
        for a in f.get("assertionResults") or []:
            st = str(a.get("status")).lower()
            count[st if st in count else "other"] += 1
    path.write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"ci_report: файлов {len(ran)}, тестов зелёных {count['passed']}, красных "
          f"{count['failed']}, пропущенных {count['other']}; коммит {data['erp']['head_sha'][:10]}, "
          f"прогон {data['erp']['run_id']}, настоящая база: {'да' if data['erp']['db'] else 'НЕТ'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
