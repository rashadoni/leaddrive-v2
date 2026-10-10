#!/usr/bin/env python3
"""erp_lib — общая часть команд next_card / mark / check_progress / status / export_public.

Где что лежит (папка состояния — --dir, иначе ERP_DIR, иначе папка с registry.json
рядом с командами или на уровень выше):
  registry.json  — правила: номер, пометка, срез, хэш текста, статус и чем он доказан.
                   Собирает build_registry.py; команды здесь меняют только поля
                   status, done, parts_done, prelook, problem, reset.
  order.json     — порядок. Карточки читаются из "cards": [...] или из "slices": [{"cards": [...]}].
                   Поля карточки: number, slice, slug, title, kind, rules, after, parallel_ok,
                   detail и любые другие — лишние поля не мешают. Понимаются ещё:
                   steps (список шагов; «@имя» разворачивается из блока common),
                   detail = "outline" (карточка только намечена, брать нельзя),
                   evidence_rules (правило закрывается свидетельством, а не тестом),
                   held (правило ждёт просмотра другого правила), у ворот — who либо
                   client_does / owner_confirms, decision_gate; на верхнем уровне carry
                   (правило с продолжением: части в нескольких карточках). Только чтение.
  progress/      — по файлу на карточку и на ворота (<номер>.json): кто взял, какие шаги
                   отмечены, записка, закрытие, подтверждения ворот. Отдельные файлы — чтобы
                   ветки двух карточек не сталкивались при мерже. Пишут только
                   next_card.py --take и mark.py.
Подтверждение человека (ворота, свидетельство, снятый вопрос, снятая занятость) — запись:
роль, кто, дата и дословные слова. Репозиторий открытый, поэтому в состоянии (progress/,
registry.json) от записи остаются только роль, дата и хэш; имя и дословные слова лежат в
закрытой папке, records/<хэш>.json. Хэш считается и от случайной добавки (salt), которая
хранится только там: по открытому хэшу ни имя, ни слова не подобрать. Машина не проверяет,
что слова сказал владелец: у него и у сессий одна учётная запись. Защита — отдельный PR на
ворота, неизменяемость записи, попавшей в main (check_progress.py сравнивает хэши), и экран
владельца, где он видит дату и свои слова (status.py читает их из закрытой папки).
Закрытая часть (--private, иначе ERP_PRIVATE, иначе папка состояния, если в ней есть
rules_text/ и cards/, иначе PRIVATE_DEFAULT): rules_text/<slug>.md, cards/<номер>-<slug>.md,
notes/, records/, decisions/, client/. Это ОДНО место на сервере вне всех рабочих копий, под своим git:
его видит каждая сессия. В открытом репозитории её нет; проверка GitHub работает без неё.

Номер правила в тесте — латинская запись из реестра целым словом: u3-D-28a.
После номера может стоять метка: u2-B-404#015 — часть правила, сделанная в карточке 015;
u2-B-313#pre — поведение «до просмотра» у правила «досмотреть» (отметку «сделано» не даёт).
Тест правила — только в файле src/__tests__/erp-*.test.ts: такие файлы GitHub запускает
отдельным шагом и пишет отчёт erp-tests.json. Доказательство «сделано» — статус passed
в этом отчёте, а не строка в файле и не вывод, набранный руками.

Только стандартная библиотека.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BEGIN = "<!-- rule-text-begin -->"
END = "<!-- rule-text-end -->"
HANDOFF_END = "<!-- handoff-end -->"
ROLE_RU = {"owner": "владелец", "client": "клиент", "accountant": "главбух"}
MARK_RU = {"as_1c": "как в 1С", "addition": "добавление", "to_look": "досмотреть"}
NOT_A_PERSON = {"claude", "codex", "ai", "ии", "session", "сессия", "agent", "агент",
                "bot", "бот", "gpt", "assistant", "ассистент", "todo", "tbd", "?", "-"}
# Тесты правил: только такие файлы запускает шаг GitHub с отчётом (vitest берёт *.test.ts).
TEST_FILE = re.compile(r"^erp-[A-Za-z0-9._-]+\.test\.ts$")
CALL = re.compile(
    r"(?<![A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)((?:\.[A-Za-z]+)*)"
    r"(\((?:[^()]|\([^()]*\))*\))?\s*\(\s*([\"'`])")
PRE = "pre"
PRIVATE_DEFAULT = Path.home() / "projects" / "erp-private" / "reports" / "exec"
# Настройки собственного git закрытой папки (.git/config: в историю и в копию не попадают).
PRIVATE_MARK = "erp.private"         # «true»: этот git — собственный git закрытой папки
COPY_ADDR = "erp.copy"               # адрес закрытого репозитория-копии: его называет владелец
COPY_BRANCH = "erp.copyBranch"       # ветка копии; запоминается при первой отправке
COPY_SENT = "erp.copySent"           # «<коммит> <адрес>» последней удавшейся отправки
COPY_FAILED = "erp.copyFailed"       # «<время> <коммит> <адрес>» последней неудавшейся
PUSH_LOG = "erp-push.log"            # в .git закрытой папки: что git сказал при отказе
REPORT_NAME = "erp-tests"            # имя артефакта GitHub и файла <имя>.json
STATE_MOVED = "STATE_MOVED.json"     # в закрытой папке: состояние уже живёт в репозитории
WORDS_MAX = 200                      # дословные слова подтверждения: не длиннее (строка экрана владельца)
RECORDS = "records"                  # в закрытой папке: имя и слова каждой записи человека
RECORD_HASH = re.compile(r"^[0-9a-f]{64}$")
RECORD_KEYS = ("kind", "key", "role", "by", "date", "words", "salt")
RECORD_SECRET = ("by", "words", "salt")         # чего в открытой записи быть не должно
NOTE_BLOCKED = ("none", "owner", "client", "look_1c", "ci", "data", "other")
WORKFLOW = ".github/workflows/pr-checks.yml"
# Строки, которые обязаны стоять в workflow: без них проверка отметок молча исчезает.
WORKFLOW_MUST = (
    'check_progress.py --branch "$GITHUB_HEAD_REF" --base-ref "$BASE_SHA"',
    "--reporter=json --outputFile=erp-tests.json",
    "ERP_TEST_DATABASE_URL",
    "ci_report.py erp-tests.json",
    "check_progress.py --tests-report erp-tests.json",
    "name: erp-tests",
)
DOCS_BRANCH = "erp-docs/"            # ветка выкладки документа: только в ней меняются хэши правил
DOC_CHAIN = ("build_registry.py → сверка order.json → build_cards.py --reviewed → check_registry.py, check_order.py, "
             "check_fixtures.py → export_public.py --to scripts/erp → PR")


class Fail(Exception):
    """Понятный отказ: одна строка человеку, код возврата 1."""


def today() -> str:
    return os.environ.get("ERP_TODAY") or datetime.date.today().isoformat()


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def natural(key: str):
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", key)]


def common_parser(description: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=description,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dir", help="папка с registry.json, order.json и progress/")
    p.add_argument("--private", help="закрытая папка: rules_text/, cards/, notes/")
    p.add_argument("--repo", help="корень репозитория (дерево тестов, git)")
    # Два ключа ниже — только для selftest.py: в настоящей работе git спрашивается всегда.
    p.add_argument("--no-git", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--busy", action="append", default=[], metavar="ВЕТКА", help=argparse.SUPPRESS)
    p.add_argument("--merged", action="append", default=[], metavar="ВЕТКА", help=argparse.SUPPRESS)
    p.add_argument("--tests-root", action="append", default=[], metavar="ПАПКА",
                   help="где искать тесты (по умолчанию src/__tests__ в корне репозитория)")
    return p


def run_main(fn) -> None:
    """Запуск команды: Fail превращается в одну строку и код 1."""
    try:
        code = fn()
    except Fail as e:
        print(f"ОТКАЗ: {e}")
        sys.exit(1)
    sys.exit(code or 0)


# --------------------------------------------------------------------------- чтение

def _find_dir(arg):
    if arg:
        return Path(arg).resolve()
    if os.environ.get("ERP_DIR"):
        return Path(os.environ["ERP_DIR"]).resolve()
    for cand in (HERE, HERE.parent):
        if (cand / "registry.json").exists():
            return cand
    return HERE.parent


def is_private(path) -> bool:
    """Закрытая папка — та, где есть и текст правил, и карточки."""
    return bool(path) and (Path(path) / "rules_text").is_dir() and (Path(path) / "cards").is_dir()


def order_cards(order) -> list:
    """Карточки из order.json: плоский список cards или cards внутри slices."""
    if isinstance(order, list):
        return order
    if isinstance(order.get("cards"), list):
        return order["cards"]
    out = []
    for s in order.get("slices") or []:
        for c in (s.get("cards") or []) if isinstance(s, dict) else []:
            if "slice" not in c and "slice" in s:
                c = dict(c, slice=s["slice"])
            out.append(c)
    if not out:
        raise Fail("order.json: не найден список карточек (cards или slices[].cards)")
    return out


class Card:
    """Карточка из order.json в приведённом виде. raw — как записано в файле."""

    def __init__(self, raw: dict, ctx: "Ctx"):
        self.raw = raw
        key = str(raw.get("number", "")).strip()
        if not key:
            raise Fail(f"order.json: у карточки нет номера: {str(raw)[:80]}")
        self.key = key
        self.sort = natural(key)
        slug = re.sub(r"[^A-Za-z0-9._-]+", "-", str(raw.get("slug") or "card")).strip("-")
        self.slug = slug or "card"
        self.title = str(raw.get("title") or "")
        self.slice = raw.get("slice")
        self.kind = str(raw.get("kind") or "work")
        detail = raw.get("detail")
        kl = self.kind.lower()
        self.gate = raw.get("gate") is True or kl.startswith(("gate", "vorota", "ворота")) \
            or kl in ("acceptance", "stop", "go")
        self.outline = isinstance(detail, str) and detail.strip().lower() == "outline"
        self.decision = bool(raw.get("decision_gate"))
        self.after = [str(a).strip() for a in (raw.get("after") or [])]
        self.parallel_ok = bool(raw.get("parallel_ok"))
        self.branch = f"erp/{self.key}-{self.slug}"
        self.unknown_rules = []
        self.rules = self._resolve(raw.get("rules"), ctx)
        self.evidence = set(self._resolve(raw.get("evidence_rules"), ctx))
        self.all_rules = list(self.rules)  # плюс части правил с продолжением — дополняет Ctx
        self.held = {}
        for h in raw.get("held") or []:
            if isinstance(h, dict):
                for s in self._resolve([h.get("slug") or h.get("rule")], ctx):
                    self.held[s] = [str(w) for w in h.get("waits_for") or []]
        # кто подтверждает ворота
        who = raw.get("who")
        if who is None and isinstance(detail, dict):
            who = detail.get("who")
        if isinstance(who, str):
            who = [who]
        if not who:
            who = (["client"] if raw.get("client_does") else []) + \
                  (["owner"] if raw.get("owner_confirms") else [])
        self.who_given = bool(who)
        if not who:
            hay = (self.kind + " " + self.title).lower()
            who = [role for role, words in (("client", ("client", "клиент")),
                                            ("accountant", ("accountant", "главбух")),
                                            ("owner", ("owner", "владел", "давай")))
                   if any(w in hay for w in words)] or ["owner"]
        self.who = [str(w).strip().lower() for w in who]

    def _resolve(self, items, ctx) -> list:
        """Правила: номер («А-22»), латинская запись («u1-A-22») или объект с одним из них."""
        out = []
        for item in items or []:
            if isinstance(item, dict):
                item = item.get("slug") or item.get("id") or item.get("rule") or ""
            r = ctx.by_slug.get(str(item)) or ctx.by_id.get(str(item))
            if r is None:
                self.unknown_rules.append(str(item))
            elif r["slug"] not in out:
                out.append(r["slug"])
        return out


class Ctx:
    def __init__(self, args):
        self.dir = _find_dir(getattr(args, "dir", None))
        priv = getattr(args, "private", None) or os.environ.get("ERP_PRIVATE")
        self.private_asked = Path(priv).resolve() if priv else None
        self.private = next((c for c in ([self.private_asked] if priv else
                                         [self.dir, PRIVATE_DEFAULT]) if is_private(c)), None)
        self.use_git = not getattr(args, "no_git", False)
        self.extra_busy = set(getattr(args, "busy", None) or [])
        self.extra_merged = set(getattr(args, "merged", None) or [])
        self.repo = Path(args.repo).resolve() if getattr(args, "repo", None) else None
        if self.repo is None and os.environ.get("ERP_REPO"):
            self.repo = Path(os.environ["ERP_REPO"]).resolve()
        if self.repo is None and self.use_git:
            # репозиторий кода — тот, из которого запущена команда (до карточки 001 сама
            # команда лежит в закрытой папке, а запускают её из рабочей копии)
            top = _git_at(Path.cwd(), "rev-parse", "--show-toplevel") or \
                _git_at(self.dir, "rev-parse", "--show-toplevel")
            self.repo = Path(top.strip()) if top else None
        if self.repo is None:
            self.repo = Path.cwd()
        self.tests_roots_arg = list(getattr(args, "tests_root", None) or [])
        self.reg_path = self.dir / "registry.json"
        self.order_path = self.dir / "order.json"
        self.prog_dir = self.dir / "progress"
        self._tests = None
        self._branches = None
        self._merged = None
        self._hash_cache = {}
        self._steps_cache = {}
        self._private_reg = None
        self.load()
        if not self.use_git:
            print("РЕЖИМ САМОПРОВЕРКИ (--no-git): git не спрашивается. Для настоящей работы "
                  "так нельзя.")

    # ---- файлы
    def load(self):
        self._hash_cache.clear()
        self._steps_cache.clear()
        self._private_reg = None
        if not self.reg_path.exists():
            raise Fail(f"нет реестра правил: {self.reg_path}")
        self._reg_text = self.reg_path.read_text(encoding="utf-8")
        self.registry = json.loads(self._reg_text)
        self.rules = self.registry.get("rules") or []
        self.by_slug = {r["slug"]: r for r in self.rules}
        self.by_id = {r["id"]: r for r in self.rules}
        if len(self.by_slug) != len(self.rules):
            raise Fail("в реестре повторяется латинская запись правила (slug)")
        if not self.order_path.exists():
            raise Fail(f"нет порядка карточек: {self.order_path} — его строит отдельный шаг")
        order = json.loads(self.order_path.read_text(encoding="utf-8"))
        self.order_raw = order
        self.common = (order.get("common") or {}) if isinstance(order, dict) else {}
        self.cards = sorted((Card(c, self) for c in order_cards(order)), key=lambda c: c.sort)
        self.by_key = {}
        for c in self.cards:
            if c.key in self.by_key:
                raise Fail(f"order.json: номер карточки {c.key} встречается дважды")
            self.by_key[c.key] = c
        # правила с продолжением: slug → номера карточек, где проверяются его части
        self.carry, self.carry_errors = {}, []
        for item in (order.get("carry") or []) if isinstance(order, dict) else []:
            name = str(item.get("slug") or item.get("rule") or "")
            r = self.by_slug.get(name) or self.by_id.get(str(item.get("rule") or ""))
            parts = [str(p).strip() for p in item.get("parts") or []]
            home = str(item.get("home") or "").strip()
            if home and home not in parts:
                parts.append(home)
            if r is None:
                self.carry_errors.append(f"carry: правила {name} нет в реестре")
                continue
            for p in parts:
                if p not in self.by_key:
                    self.carry_errors.append(f"carry {r['slug']}: карточки {p} нет")
            self.carry[r["slug"]] = sorted([p for p in parts if p in self.by_key], key=natural)
        for c in self.cards:
            for s in c.rules:
                if s in self.carry and c.key not in self.carry[s]:
                    self.carry[s] = sorted(self.carry[s] + [c.key], key=natural)
        for s, parts in self.carry.items():
            for p in parts:
                if s not in self.by_key[p].all_rules:
                    self.by_key[p].all_rules.append(s)
        self.held = {}
        for c in self.cards:
            for s, waits in c.held.items():
                self.held.setdefault(s, [])
                self.held[s] += [w for w in waits if w not in self.held[s]]
        files = {}
        if self.prog_dir.is_dir():
            files = {p.name: p.read_text(encoding="utf-8") for p in sorted(self.prog_dir.glob("*.json"))}
        self.progress = progress_from_files(files)
        self._prog_seen = {(b, k): json.dumps(v, sort_keys=True, ensure_ascii=False)
                           for b in ("cards", "gates") for k, v in self.progress[b].items()}

    def save(self):
        """Пишет только то, что изменилось: файл карточки или ворот и, если надо, реестр."""
        for bucket, kind in (("cards", "card"), ("gates", "gate")):
            for key, st in self.progress[bucket].items():
                dump = json.dumps(st, sort_keys=True, ensure_ascii=False)
                if self._prog_seen.get((bucket, key)) == dump or (not st and (bucket, key)
                                                                  not in self._prog_seen):
                    continue
                self.prog_dir.mkdir(parents=True, exist_ok=True)
                name = re.sub(r"[^A-Za-z0-9._-]+", "-", key) + ".json"
                _write_json(self.prog_dir / name, {"key": key, "kind": kind, "state": st})
                self._prog_seen[(bucket, key)] = dump
        text = json.dumps(self.registry, ensure_ascii=False, indent=1) + "\n"
        if text != self._reg_text:
            _write_json(self.reg_path, self.registry)
            self._reg_text = text

    def log(self, what: str, **kw):
        """Короткая история карточки или ворот (последние 30 событий) — в её же файле."""
        bucket, key = "cards", kw.pop("card", None)
        if key is None:
            bucket, key = "gates", kw.pop("gate", None)
        if key is None:
            return
        hist = self.progress[bucket].setdefault(str(key), {}).setdefault("history", [])
        hist.append({"date": today(), "what": what, **kw})
        del hist[:-30]

    @contextlib.contextmanager
    def locked(self):
        """Две сессии не должны одновременно переписать один файл состояния: замок берётся
        на саму папку состояния (лишних файлов не оставляет)."""
        fd = None
        try:
            import fcntl
            fd = os.open(str(self.dir), os.O_RDONLY)
            fcntl.flock(fd, fcntl.LOCK_EX)
        except Exception:
            if fd is not None:
                os.close(fd)
            fd = None
        try:
            if fd is not None:
                self.load()  # перечитать то, что успела записать другая сессия
            yield
        finally:
            if fd is not None:
                os.close(fd)

    # ---- git (только чтение)
    def git(self, *a):
        if not self.use_git:
            return None
        try:
            cwd = self.repo if getattr(self, "repo", None) else self.dir
            r = subprocess.run(["git", *a], cwd=str(cwd), capture_output=True,
                               text=True, timeout=15)
        except Exception:
            return None
        return r.stdout if r.returncode == 0 else None

    def git_ok(self, *a) -> bool:
        return self.git(*a) is not None

    def has_origin(self) -> bool:
        return self.use_git and self.git_ok("remote", "get-url", "origin")

    def state_in_repo(self):
        """Путь папки состояния внутри репозитория (scripts/erp) или None, если состояние ещё
        в закрытой папке (где бы она ни лежала: в ней rules_text/ и cards/)."""
        if is_private(self.dir):
            return None
        try:
            return self.dir.resolve().relative_to(self.repo.resolve()).as_posix()
        except ValueError:
            return None

    def current_branch(self):
        if os.environ.get("ERP_BRANCH"):
            return os.environ["ERP_BRANCH"]
        out = self.git("rev-parse", "--abbrev-ref", "HEAD")
        name = (out or "").strip()
        return name if name and name != "HEAD" else None

    def erp_branches(self) -> set:
        """Ветки erp/* — местные и на origin (по последнему fetch) — и переданные --busy."""
        if self._branches is None:
            found = set(self.extra_busy)
            out = self.git("for-each-ref", "--format=%(refname:short)",
                           "refs/heads/erp", "refs/remotes/origin/erp")
            for line in (out or "").splitlines():
                line = line.strip()
                if line.startswith("origin/"):
                    line = line[len("origin/"):]
                if line:
                    found.add(line)
            self._branches = found
        return self._branches

    def merged_branches(self) -> set:
        """Ветки erp/*, уже целиком влитые в origin/main (и местная, и на origin, если обе есть):
        занятостью карточки они не считаются. Такая ветка остаётся после мержа без удаления и
        иначе держала бы переоткрытую карточку занятой навсегда. Нет origin/main — не знаем."""
        if self._merged is None:
            done = set(self.extra_merged)
            main = "refs/remotes/origin/main"
            if self.use_git and self.git_ok("rev-parse", "--verify", "--quiet", main):
                out = self.git("for-each-ref", "--format=%(refname)",
                               "refs/heads/erp", "refs/remotes/origin/erp")
                state = {}
                for ref in (out or "").split():
                    name = ref.split("/", 2)[2] if ref.startswith("refs/heads/") else \
                        ref.split("/", 3)[3]
                    inside = self.git_ok("merge-base", "--is-ancestor", ref, main)
                    state[name] = state.get(name, True) and inside
                done |= {n for n, ok in state.items() if ok}
            self._merged = done
        return self._merged

    def branch_holds(self, branch: str) -> bool:
        """Ветка существует и ещё не влита в origin/main."""
        return branch in self.erp_branches() and branch not in self.merged_branches()

    # ---- закрытая часть
    def text_file(self, rule) -> Path | None:
        if self.private is None:
            return None
        p = self.private / "rules_text" / f"{rule['slug']}.md"
        return p if p.exists() else None

    def rule_text(self, rule) -> str | None:
        """Дословная строка правила: последняя строка между метками в rules_text."""
        p = self.text_file(rule)
        if p is None:
            return None
        body = p.read_text(encoding="utf-8")
        m = re.search(re.escape(BEGIN) + r"\n(.*?)\n" + re.escape(END), body, re.S)
        if not m:
            return ""
        return m.group(1).split("\n")[-1]

    def file_hash(self, rule) -> str | None:
        slug = rule["slug"]
        if slug not in self._hash_cache:
            t = self.rule_text(rule)
            self._hash_cache[slug] = None if t is None else sha(t)
        return self._hash_cache[slug]

    def card_file(self, card: Card) -> Path | None:
        if self.private is None:
            return None
        names = []
        d = card.raw.get("detail")
        if isinstance(d, str) and d.strip().lower() not in ("full", "outline"):
            names.append(d)
        if isinstance(d, dict):
            names += [d[k] for k in ("file", "path", "card") if isinstance(d.get(k), str)]
        names += [card.raw[k] for k in ("file", "card_file", "path")
                  if isinstance(card.raw.get(k), str)]
        bases = [self.private, self.private / "cards", self.dir, self.dir.parent.parent]
        for n in names:
            if "\n" in n or len(n) > 300:
                continue
            for p in ([Path(n)] if Path(n).is_absolute() else [b / n for b in bases]):
                if p.is_file():
                    return p
        cards = self.private / "cards"
        if cards.is_dir():
            keys = [card.key]
            if card.key.isdigit():
                keys += [f"{int(card.key):02d}", f"{int(card.key):03d}"]
            for k in keys:
                for pat in (f"{k}-{card.slug}.md", f"{k}-*.md", f"{k}_*.md", f"{k}.md"):
                    hit = sorted(cards.glob(pat))
                    if hit:
                        return hit[0]
        return None

    def steps(self, card: Card) -> list:
        """Названия шагов карточки по порядку. Пустой список — шагов не нашли."""
        if card.key not in self._steps_cache:
            self._steps_cache[card.key] = self._steps(card)
        return self._steps_cache[card.key]

    def _steps(self, card: Card) -> list:
        for src in (card.raw.get("steps"),
                    card.raw["detail"].get("steps") if isinstance(card.raw.get("detail"), dict)
                    else None):
            if isinstance(src, bool):
                continue
            if isinstance(src, int):
                # в открытом порядке — только число шагов; названия берутся из файла карточки
                p = self.card_file(card)
                titles = parse_steps(p.read_text(encoding="utf-8")) if p else []
                return titles if len(titles) == src else [""] * src
            if isinstance(src, list):
                return [self.expand((s.get("title") or s.get("text") or "")
                                    if isinstance(s, dict) else str(s)) for s in src]
        p = self.card_file(card)
        return parse_steps(p.read_text(encoding="utf-8")) if p else []

    def expand(self, step: str) -> str:
        """«@имя» и «@имя|добавка» → текст из блока common в order.json."""
        if not step.startswith("@"):
            return step
        name, _, add = step[1:].partition("|")
        base = self.common.get(name.strip())
        if not isinstance(base, str):
            return step
        return (base + " " + add).strip()

    def private_registry(self) -> dict:
        """Реестр закрытой папки: в нём записано, для какого документа он собран."""
        if self._private_reg is None:
            self._private_reg = {}
            if self.private is not None and self.private.resolve() == self.dir.resolve():
                self._private_reg = self.registry
            elif self.private is not None and (self.private / "registry.json").is_file():
                try:
                    self._private_reg = json.loads(
                        (self.private / "registry.json").read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    raise Fail(f"{self.private / 'registry.json'} не читается как JSON")
        return self._private_reg

    def notes_file(self, card: Card) -> Path | None:
        return None if self.private is None else self.private / "notes" / f"{card.key}-{card.slug}.md"

    def last_note(self, card: Card) -> str | None:
        p = self.notes_file(card)
        if p is None or not p.exists():
            return None
        parts = re.split(r"(?m)^### ", p.read_text(encoding="utf-8"))
        return ("### " + parts[-1]).strip() if len(parts) > 1 else None

    # ---- тесты в дереве репозитория
    def tests_roots(self) -> list:
        names = self.tests_roots_arg
        if not names and isinstance(self.order_raw, dict):
            names = self.order_raw.get("tests_roots") or []
        names = names or ["src/__tests__"]
        roots = []
        for n in names:
            p = Path(n) if Path(n).is_absolute() else self.repo / n
            if p.is_dir():
                roots.append(p)
        return roots

    def tests(self) -> dict:
        """slug → [ {file, title, tag, off, cond} ] по всем тестовым файлам дерева."""
        if self._tests is None:
            self._tests = scan_tests(self.tests_roots(), list(self.by_slug), self.repo)
        return self._tests


def progress_from_files(files: dict) -> dict:
    """{имя файла: текст} из папки progress/ → {"cards": {номер: …}, "gates": {номер: …}}."""
    out = {"schema": 1, "cards": {}, "gates": {}}
    for name, text in files.items():
        try:
            d = json.loads(text)
        except json.JSONDecodeError:
            raise Fail(f"progress/{name} не читается как JSON")
        key = str(d.get("key") or Path(name).stem)
        out["gates" if d.get("kind") == "gate" else "cards"][key] = d.get("state") or {}
    return out


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def parse_steps(md: str) -> list:
    """Шаги карточки: строки с галочкой в разделе, в заголовке которого есть «Шаг».
    Нет галочек — нумерованные строки того же раздела."""
    section, level = [], None
    for ln in md.splitlines():
        h = re.match(r"^(#{1,6})\s+(.*)$", ln)
        if h:
            if level is not None and len(h.group(1)) <= level:
                break
            if level is None and re.search(r"шаг", h.group(2), re.I):
                level = len(h.group(1))
            continue
        if level is not None:
            section.append(ln)
    box = re.compile(r"^\s{0,3}(?:[-*+]|\d+[.)])\s*\[[ xXхХ]\]\s*(.+?)\s*$")
    steps = [m.group(1) for m in map(box.match, section) if m]
    if not steps:
        num = re.compile(r"^\d+[.)]\s+(.+?)\s*$")
        steps = [m.group(1) for m in map(num.match, section) if m]
    # «1. Таблица» и «Шаг 1: Таблица» → «Таблица»: номер шага даёт команда
    return [re.sub(r"^(?:шаг\s*)?\d+\s*[.):—-]\s*", "", s, flags=re.I) for s in steps]


# --------------------------------------------------------------------------- тесты

def slug_pattern(slugs) -> re.Pattern:
    """Номер правила целым словом и необязательная метка после «#».
    u4-D-5.1 не совпадает с u4-D-5.10, u4-D-5.1a и u4-D-5.1.2."""
    alt = "|".join(re.escape(s) for s in sorted(slugs, key=len, reverse=True)) or "(?!x)x"
    return re.compile(r"(?<![A-Za-z0-9])(" + alt + r")(?:#([A-Za-z0-9]+))?(?![A-Za-z0-9])(?!\.[0-9])")


def tags_in(text: str, pattern: re.Pattern) -> set:
    """{(номер правила, метка или None)} — все номера правил в строке."""
    return {(m.group(1), m.group(2)) for m in pattern.finditer(text)}


def tag_fits(tag, want) -> bool:
    """want=None — обычный тест правила (любой, кроме #pre); иначе нужна именно эта метка."""
    return tag != PRE if want is None else tag == want


def _skip_string(body: str, i: int) -> int:
    """i — индекс открывающей кавычки; возвращает индекс за закрывающей."""
    q, n, j = body[i], len(body), i + 1
    while j < n and body[j] != q:
        if body[j] == "\n" and q != "`":
            return j  # строка в '…' и "…" не переносится: кавычка была не кавычкой
        j += 2 if body[j] == "\\" else 1
    return min(j + 1, n)


def strip_comments(body: str) -> str:
    """Комментарии → пробелы (длина та же): закомментированный тест тестом не считается."""
    out, i, n = list(body), 0, len(body)
    while i < n:
        ch = body[i]
        if ch in "\"'`":
            i = _skip_string(body, i)
        elif ch == "/" and body[i + 1:i + 2] == "/":
            j = body.find("\n", i)
            j = n if j < 0 else j
            out[i:j] = " " * (j - i)
            i = j
        elif ch == "/" and body[i + 1:i + 2] == "*":
            j = body.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out[i:j] = [c if c == "\n" else " " for c in body[i:j]]
            i = j
        else:
            i += 1
    return "".join(out)


def _call_end(body: str, i: int) -> int:
    """i — индекс открывающей скобки вызова; возвращает индекс за парной закрывающей.
    Скобка не нашлась — конец файла: блок считается длиннее, а не короче."""
    depth, n = 0, len(body)
    while i < n:
        ch = body[i]
        if ch in "\"'`":
            i = _skip_string(body, i)
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def call_kind(ident: str):
    """('test' | 'describe', выключен, условный) или None, если это не тест и не блок.
    Обёртка с другим именем (postgresDescribe, dbIt) — условная: она решает по окружению,
    выполнять ли блок, и только отчёт прогона покажет, выполнялся ли он."""
    if ident in ("it", "test", "fit"):
        return "test", False, False
    if ident in ("xit", "xtest"):
        return "test", True, False
    if ident in ("describe", "fdescribe"):
        return "describe", False, False
    if ident == "xdescribe":
        return "describe", True, False
    if re.fullmatch(r"[a-z][A-Za-z0-9_$]*Describe|describe[A-Z_$][A-Za-z0-9_$]*", ident):
        return "describe", False, True
    if re.fullmatch(r"[a-z][A-Za-z0-9_$]*(?:It|Test)|(?:it|test)[A-Z_$][A-Za-z0-9_$]*", ident):
        return "test", False, True
    return None


def scan_body(body: str, pat: re.Pattern) -> list:
    """[(номер правила, {title, tag, off, cond})] по одному файлу тестов.

    Тест выключен (off), если выключен он сам (it.skip, it.todo, it.fails, xit) или любой
    блок, в котором он лежит (describe.skip, xdescribe). Условный (cond) — skipIf / runIf или
    обёртка вроде postgresDescribe у него или у любого внешнего блока. Номер правила берётся
    из названия теста и из названий внешних блоков. Блок без тестов внутри ничего не даёт."""
    body = strip_comments(body)
    calls = []
    for m in CALL.finditer(body):
        kind = call_kind(m.group(1))
        if kind is None:
            continue
        what, off, cond = kind
        mods = set((m.group(2) or "").split(".")) - {""}
        off = off or bool(mods & {"skip", "todo", "fails"})
        cond = cond or bool(mods & {"skipIf", "runIf"})
        quote, start = m.group(4), m.end()
        stop = start
        while True:
            stop = body.find(quote, stop)
            if stop < 0 or stop - start > 500:
                stop = min(len(body), start + 500)
                break
            if body[stop - 1] != "\\":
                break
            stop += 1
        calls.append({"what": what, "off": off, "cond": cond, "title": body[start:stop].strip(),
                      "start": m.start(),
                      "end": _call_end(body, body.rfind("(", m.start(), m.end()))})
    blocks = [c for c in calls if c["what"] == "describe"]
    out = []
    for c in calls:
        if c["what"] != "test":
            continue
        outer = [b for b in blocks if b["start"] < c["start"] < b["end"]]
        tags = tags_in(c["title"], pat)
        for b in outer:
            tags |= tags_in(b["title"], pat)
        for s, tag in sorted(tags, key=str):
            out.append((s, {"title": c["title"], "tag": tag,
                            "off": c["off"] or any(b["off"] for b in outer),
                            "cond": c["cond"] or any(b["cond"] for b in outer)}))
    return out


def scan_tests(roots, slugs, repo: Path) -> dict:
    """slug → [{file, title, tag, off, cond}]. Берутся только файлы erp-*.test.ts: остальные
    шаг GitHub с отчётом не запускает (а *.spec.ts не запускает и сам vitest)."""
    pat = slug_pattern(slugs)
    found: dict = {}
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".next", ".git")]
            for fn in sorted(filenames):
                if not TEST_FILE.match(fn):
                    continue
                path = Path(dirpath) / fn
                try:
                    body = path.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                if not pat.search(body):
                    continue
                try:
                    rel = path.relative_to(repo).as_posix()
                except ValueError:
                    rel = str(path)
                for s, t in scan_body(body, pat):
                    found.setdefault(s, []).append(dict(t, file=rel))
    return found


def live_tests(ctx: Ctx, slug: str, want=None) -> list:
    """Тесты правила в дереве, которые не выключены (условные входят: выполнялись ли они,
    показывает отчёт прогона). want: None — обычные, 'pre', или номер карточки-части."""
    return [t for t in ctx.tests().get(slug, []) if not t["off"] and tag_fits(t["tag"], want)]


def load_report(path) -> dict:
    """Отчёт прогона GitHub (vitest --reporter=json, помеченный ci_report.py) →
    {"meta": {head_sha, run_id, …}, "results": [(файл, полное название теста, цвет)]}.
    Зелёный — только status == "passed"; пропущенный (skipped, pending, todo) зелёным не
    считается. Текстовый вывод и файлы другого вида не принимаются."""
    path = Path(path)
    if not path.is_file():
        raise Fail(f"нет отчёта тестов: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except json.JSONDecodeError as e:
        raise Fail(f"отчёт тестов {path.name} не читается как JSON: {e}")
    if not isinstance(data, dict) or not isinstance(data.get("testResults"), list):
        raise Fail(f"{path.name} — не отчёт vitest (нет списка testResults)")
    results = []
    for f in data["testResults"]:
        fname = os.path.basename(str(f.get("name", "")))
        if not TEST_FILE.match(fname):
            continue
        for a in f.get("assertionResults") or []:
            name = a.get("fullName") or " ".join((a.get("ancestorTitles") or [])
                                                 + [a.get("title") or ""])
            st = str(a.get("status")).lower()
            results.append((fname, str(name),
                            "green" if st == "passed" else "red" if st == "failed" else "skip"))
    meta = data.get("erp") if isinstance(data.get("erp"), dict) else {}
    return {"meta": meta, "results": results}


def green_for(results: list, slug: str, want=None):
    """(зелёные, красные, пропущенные) названия тестов с номером правила и нужной меткой."""
    pat = slug_pattern([slug])
    out = {"green": [], "red": [], "skip": []}
    for _file, name, state in results:
        if any(tag_fits(tag, want) for _, tag in tags_in(name, pat)):
            out[state].append(name)
    return out["green"], out["red"], out["skip"]


def fetch_run(ctx: Ctx, run_id: str, branch: str | None) -> dict:
    """Отчёт erp-tests прогона GitHub: скачивается командой gh, руками файл не подаётся.
    Проверяется, что прогон — этой ветки и по коммиту, который в ней есть."""
    run_id = str(run_id or "").strip()
    if not re.fullmatch(r"[0-9]{4,}", run_id):
        raise Fail("нужен номер прогона GitHub (--run <число>): он стоит в адресе прогона и в "
                   "выводе `gh run list --branch <ветка>`")
    gh = shutil.which("gh")
    if not gh:
        raise Fail("нет команды gh — отчёт прогона взять нечем")

    def call(*a):
        try:
            return subprocess.run([gh, *a], cwd=str(ctx.repo), capture_output=True, text=True,
                                  timeout=180)
        except Exception as e:  # noqa: BLE001
            raise Fail(f"gh {' '.join(a[:3])} не выполнилась: {e}")

    r = call("run", "view", run_id, "--json", "headSha,headBranch,event,workflowName,status")
    if r.returncode != 0:
        raise Fail(f"прогон {run_id} не найден: {(r.stderr or r.stdout).strip()[:200]}")
    try:
        info = json.loads(r.stdout)
    except json.JSONDecodeError:
        raise Fail(f"gh run view {run_id}: ответ не читается")
    if branch and info.get("headBranch") != branch:
        raise Fail(f"прогон {run_id} — ветки {info.get('headBranch')}, а карточка за веткой "
                   f"{branch}: чужой прогон отметку не даёт")
    head = str(info.get("headSha") or "")
    if ctx.use_git and not ctx.git_ok("merge-base", "--is-ancestor", head, "HEAD"):
        raise Fail(f"прогон {run_id} шёл по коммиту {head[:10]}, которого нет в этой ветке")
    tmp = Path(tempfile.mkdtemp(prefix="erp-run-"))
    try:
        r = call("run", "download", run_id, "-n", REPORT_NAME, "-D", str(tmp))
        hits = sorted(tmp.rglob(REPORT_NAME + ".json"))
        if r.returncode != 0 or not hits:
            raise Fail(f"в прогоне {run_id} нет отчёта «{REPORT_NAME}»: PR должен быть «готов к "
                       f"ревью» (на черновике тесты не идут), шаг тестов правил — дойти до конца")
        report = load_report(hits[0])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    meta = report["meta"]
    if not meta.get("head_sha"):
        raise Fail(f"отчёт прогона {run_id} не помечен (ci_report.py): это не отчёт шага GitHub")
    if meta["head_sha"] != head:
        raise Fail(f"отчёт прогона {run_id} собран по коммиту {str(meta['head_sha'])[:10]}, "
                   f"а прогон — по {head[:10]}")
    report["run_id"], report["sha"] = run_id, head
    return report


# --------------------------------------------------------------------------- состояние правила

def default_status(rule) -> str:
    return "blocked_to_look" if rule.get("mark") == "to_look" else "not_started"


def text_matches(ctx: Ctx, rule) -> bool:
    """Текст правила в закрытой папке тот же, что записан в реестре (нет папки — верим реестру)."""
    fh = ctx.file_hash(rule)
    return fh is None or fh == rule.get("text_hash")


def is_done(ctx: Ctx, rule) -> bool:
    d = rule.get("done") or {}
    return (rule.get("status") == "done" and rule.get("mark") != "to_look"
            and d.get("hash") == rule.get("text_hash") and text_matches(ctx, rule))


def part_ok(ctx: Ctx, rule, key: str) -> bool:
    """Часть правила с продолжением, относящаяся к карточке key, отмечена и текст тот же."""
    p = (rule.get("parts_done") or {}).get(key) or {}
    return bool(p) and p.get("hash") == rule.get("text_hash") and text_matches(ctx, rule)


def prelook_ok(ctx: Ctx, rule) -> bool:
    p = rule.get("prelook") or {}
    return bool(p) and p.get("hash") == rule.get("text_hash") and text_matches(ctx, rule)


def waits_for(ctx: Ctx, rule) -> list:
    """Номера правил «досмотреть», просмотра которых ждёт это правило."""
    names = list(rule.get("blocked_by") or []) + list(ctx.held.get(rule["slug"], []))
    out = []
    for b in names:
        if (ctx.by_id.get(b) or ctx.by_slug.get(b) or {}).get("mark") == "to_look" and b not in out:
            out.append(b)
    return out


def rule_view(ctx: Ctx, rule, card: Card | None = None) -> str:
    """Как правило выглядит сейчас (если дана карточка — с её точки зрения):
    done / part_done / problem / look / waits / open."""
    if rule.get("problem"):
        return "problem"
    if rule.get("mark") == "to_look":
        return "look"
    if is_done(ctx, rule):
        return "done"
    if waits_for(ctx, rule):
        return "waits"
    if card is not None and card.key in ctx.carry.get(rule["slug"], []) \
            and part_ok(ctx, rule, card.key):
        return "part_done"
    return "open"


def shelve_evidence(rule) -> None:
    """Принятое свидетельство не стирается никогда: когда отметка уходит (вопрос, новый текст,
    новое свидетельство), запись владельца переносится в журнал evidence_log."""
    d = rule.get("done") or {}
    if d.get("kind") == "evidence" and d not in (rule.get("evidence_log") or []):
        rule.setdefault("evidence_log", []).append(d)


def shelve_cleared(rule) -> None:
    """Ответ владельца на вопрос не стирается: прежняя запись уходит в problem_cleared_log."""
    pc = rule.pop("problem_cleared", None)
    if pc and pc not in (rule.get("problem_cleared_log") or []):
        rule.setdefault("problem_cleared_log", []).append(pc)


def owner_records(*sources):
    """(свидетельства, снятые вопросы) — все записи владельца по правилу: действующие и из
    журналов. Источники — запись правила и его запись в registry["retired"]."""
    ev, cl = [], []
    for s in sources:
        if not s:
            continue
        d = s.get("done") or {}
        if d.get("kind") == "evidence":
            ev.append(d)
        ev += list(s.get("evidence_log") or [])
        if s.get("problem_cleared"):
            cl.append(s["problem_cleared"])
        cl += list(s.get("problem_cleared_log") or [])
    return ev, cl


def reset_rule(ctx: Ctx, rule, why: str) -> None:
    rule["reset"] = {"reason": why, "date": today(), "old_status": rule.get("status"),
                     "old_hash": (rule.get("done") or {}).get("hash")}
    rule["status"] = default_status(rule)
    shelve_evidence(rule)
    rule.pop("done", None)
    ctx.log("reset", rule=rule["slug"], why=why)


# --------------------------------------------------------------------------- сторожа

def moved_problem(ctx: Ctx):
    """Состояние переехало (в закрытую папку на новом месте или, после карточки 001, в
    репозиторий), а команду запустили по старой копии."""
    mark = ctx.dir / STATE_MOVED
    if not mark.is_file():
        return None
    try:
        to = json.loads(mark.read_text(encoding="utf-8")).get("to") or "scripts/erp"
    except json.JSONDecodeError:
        to = "scripts/erp"
    return (f"эта копия состояния устарела: оно теперь в {to}. Запускай команды оттуда "
            f"(после карточки 001 — `python3 scripts/erp/<команда>` в рабочей копии)")


def require_live_state(ctx: Ctx) -> None:
    why = moved_problem(ctx)
    if why:
        raise Fail(why)


def origin_problem(ctx: Ctx, fetch=False):
    """Причина, по которой дереву нельзя верить, или None. Состояние — то, что в origin/main:
    рабочая копия сессии создаётся заранее и отстаёт на часы и дни."""
    if ctx.state_in_repo() is None:
        return None  # состояние ещё в закрытой папке: она одна на всех, отстать не может
    if not ctx.has_origin():
        return None  # самопроверка или репозиторий без origin: сверять не с чем
    if fetch:
        try:
            r = subprocess.run(["git", "fetch", "origin", "--prune", "--quiet"], cwd=str(ctx.repo),
                               capture_output=True, text=True, timeout=120)
        except Exception as e:  # noqa: BLE001
            return f"git fetch origin не выполнилась ({e}): без свежего origin/main карточку не выдаю"
        if r.returncode != 0:
            return ("git fetch origin не выполнилась: " + (r.stderr or "").strip()[:160]
                    + " — без свежего origin/main карточку не выдаю")
        ctx._branches = None
        ctx._merged = None
    if not ctx.git_ok("rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"):
        return "в репозитории нет origin/main: выполни git fetch origin"
    if not ctx.git_ok("merge-base", "--is-ancestor", "refs/remotes/origin/main", "HEAD"):
        return ("дерево отстало от origin/main — обнови. Новая карточка: "
                "`git switch --detach origin/main` и снова next_card.py; своя ветка в работе: "
                "`git merge origin/main` (без rebase и без force-push)")
    return None


def require_fresh(ctx: Ctx, fetch=False) -> None:
    why = origin_problem(ctx, fetch)
    if why:
        raise Fail(why)


def require_pushed(ctx: Ctx, card: Card) -> None:
    """Взятие карточки действует, только когда оно на GitHub: до пуша ту же карточку
    возьмёт другая сессия, и столкновение всплывёт после часов работы."""
    rel = ctx.state_in_repo()
    if rel is None or not ctx.has_origin():
        return  # состояние в закрытой папке (до карточки 001): она одна на всех, хватает замка
    branch = ctx.progress["cards"].get(card.key, {}).get("taken_by")
    if not branch:
        return
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", card.key) + ".json"
    text = ctx.git("show", f"refs/remotes/origin/{branch}:{rel}/progress/{name}")
    taken = None
    if text:
        try:
            taken = (json.loads(text).get("state") or {}).get("taken_by")
        except json.JSONDecodeError:
            taken = None
    if taken != branch:
        raise Fail(f"карточка {card.key} взята, но взятие не на GitHub. Сейчас же: "
                   f"`git add {rel} && git commit -m \"erp {card.key}: взята\" && "
                   f"git push -u origin {branch}`. Пуш отвергнут — карточку взяла другая "
                   f"сессия: удалить свою ветку и запустить next_card.py снова (force-push запрещён)")


def _git_at(path: Path, *a):
    try:
        r = subprocess.run(["git", *a], cwd=str(path), capture_output=True, text=True, timeout=30)
    except Exception:  # noqa: BLE001
        return None
    return r.stdout if r.returncode == 0 else None


def private_home(ctx: Ctx):
    """Корень git закрытой папки или None, если она не под git."""
    if ctx.private is None:
        return None
    top = _git_at(ctx.private, "rev-parse", "--show-toplevel")
    return Path(top.strip()).resolve() if top and top.strip() else None


def private_problem(ctx: Ctx, write=False):
    """Причина, по которой закрытой папкой нельзя пользоваться, или None."""
    if ctx.private is None:
        asked = ctx.private_asked or PRIVATE_DEFAULT
        return (f"нет закрытой папки с rules_text/ и cards/ (искал {asked}): без неё нет ни текста "
                f"правил, ни карточек, ни записок. Путь задаётся ERP_PRIVATE; один раз её "
                f"создаёт setup_private.py")
    if not write:
        return None
    home = private_home(ctx)
    if home is None:
        return (f"закрытая папка {ctx.private} не под своим git: записки, вопросы и решения "
                f"не сохранятся в историю. Один раз: python3 {HERE / 'setup_private.py'}")
    code_top = _git_at(ctx.repo, "rev-parse", "--show-toplevel") if ctx.repo else None
    if code_top and Path(code_top.strip()).resolve() == home:
        if not (home / "src").is_dir():  # кода продукта тут нет: это сама закрытая папка
            return (f"команда запущена из самой закрытой папки {home}: запусти её из рабочей "
                    f"копии репозитория (или укажи --repo)")
        return (f"закрытая папка {ctx.private} лежит внутри рабочей копии {home}: её видит "
                f"только эта сессия, записка следующей сессии потеряется. Один раз: "
                f"python3 {HERE / 'setup_private.py'} — и дальше работать с ERP_PRIVATE")
    if _is_code_checkout(ctx, home):
        return (f"закрытая папка {ctx.private} лежит внутри рабочей копии кода {home} (другой "
                f"рабочей копии того же репозитория): в её историю закрытое не пишется. "
                f"Закрытая папка одна — {PRIVATE_DEFAULT.parent.parent}; работать без ERP_PRIVATE")
    own = ctx.private.resolve()
    if home not in (own, own.parent.parent):
        return (f"закрытая папка {ctx.private} лежит внутри чужого репозитория {home}: в его "
                f"историю закрытое не пишется и никуда не отправляется. Ей нужен свой git: "
                f"python3 {HERE / 'setup_private.py'}")
    if _cfg(home, PRIVATE_MARK) != "true":
        return (f"git {home} не помечен как собственный git закрытой папки (пометку ставит "
                f"setup_private.py; после клонирования её нет): закрытое в его историю не пишется "
                f"и никуда не отправляется. Если {home} — сама закрытая папка, а не чужой "
                f"репозиторий, в который она попала, один раз: `git -C {home} config "
                f"{PRIVATE_MARK} true`")
    return None


def _cfg(home: Path, key: str) -> str:
    """Настройка из .git/config именно этого git (общие настройки пользователя не в счёт)."""
    return (_git_at(home, "config", "--local", "--get", key) or "").strip()


def _cfg_set(home: Path, key: str, value) -> bool:
    if value is None:
        _git_at(home, "config", "--local", "--unset-all", key)
        return True
    return _git_at(home, "config", "--local", key, str(value)) is not None


def _git_common(path):
    """Общая папка git (одна у всех рабочих копий одного репозитория) или None."""
    out = _git_at(path, "rev-parse", "--git-common-dir") if path else None
    if not out or not out.strip():
        return None
    return Path(os.path.realpath(os.path.join(str(path), out.strip())))


def _code_tops(ctx: Ctx, home: Path) -> list:
    """Корни рабочих копий кода: откуда запущена команда и где лежат сами команды. Корень
    самой закрытой папки сюда не входит (команды могут лежать и в ней)."""
    out = []
    for start in (ctx.repo, HERE):
        top = _git_at(start, "rev-parse", "--show-toplevel") if start and Path(start).is_dir() else None
        top = Path(top.strip()).resolve() if top and top.strip() else None
        if top is not None and top != home and top not in out:
            out.append(top)
    return out


def _is_code_checkout(ctx: Ctx, home: Path) -> bool:
    """Корень git закрытой папки — на самом деле ещё одна рабочая копия репозитория кода (у
    них общая папка git). Отдельный клон кода отсекает PRIVATE_MARK: пометки у него нет."""
    mine = _git_common(home)
    return mine is not None and any(_git_common(top) == mine for top in _code_tops(ctx, home))


def need_private(ctx: Ctx, write=False) -> None:
    why = private_problem(ctx, write)
    if why:
        raise Fail(why)


def commit_private(ctx: Ctx, message: str):
    """Снимок закрытой папки в её собственный git: записка, галочки, решения, ответы клиента.
    Возвращает короткий номер коммита или None, если менять было нечего."""
    home = private_home(ctx)
    if home is None or private_problem(ctx, write=True):
        return None
    if _git_at(home, "add", "-A") is None:
        raise Fail(f"закрытая папка {home}: git add не выполнилась")
    if not (_git_at(home, "status", "--porcelain") or "").strip():
        return None
    ident = [] if (_git_at(home, "config", "user.email") or "").strip() else \
        ["-c", "user.name=erp", "-c", "user.email=erp@localhost"]
    if _git_at(home, *ident, "-c", "commit.gpgsign=false", "commit", "-q", "-m", message) is None:
        raise Fail(f"закрытая папка {home}: git commit не выполнилась — записка не сохранена в историю")
    return (_git_at(home, "rev-parse", "--short", "HEAD") or "").strip() or None


def _remote_key(url: str, base=None) -> str:
    """Адрес репозитория в одной записи, чтобы узнать один адрес в разном написании: без
    схемы, имени пользователя, порта, «www.», «.git» и регистра; местный путь — настоящий
    путь на диске (base — откуда считать относительный). Псевдоним из ~/.ssh/config так не
    узнать: поэтому копию называет владелец (COPY_ADDR), а не угадывает команда."""
    u = (url or "").strip()
    if not u:
        return ""
    if u.startswith("file://"):
        u = u[len("file://"):]
    scheme = re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", u)
    if not scheme and (u.startswith(("/", ".", "~")) or ":" not in u.split("/")[0]):
        path = Path(os.path.expanduser(u))
        if not path.is_absolute() and base:
            path = Path(base) / path
        return "path:" + re.sub(r"(\.git)?/*$", "", os.path.realpath(str(path)))
    u = u.lower()[len(scheme.group(0)) if scheme else 0:]
    u = re.sub(r"^[^/@]*@", "", u)
    m = re.match(r"^([^/:]+)(?::\d+(?=/|$))?[:/]*(.*)$", u)
    host, rest = (m.group(1), m.group(2)) if m else (u, "")
    host = re.sub(r"^(www|ssh)\.", "", host)
    rest = re.sub(r"(\.git)?/*$", "", re.sub(r"/+", "/", rest))
    return host + "/" + rest


def _copy_home(ctx: Ctx):
    """Корень закрытой папки, которую можно отправлять в копию: свой git, свой корень, не
    рабочая копия кода. Иначе None — про такую папку уже говорит private_problem."""
    return None if private_problem(ctx, write=True) else private_home(ctx)


def _lines(text) -> list:
    return [ln.strip() for ln in (text or "").splitlines() if ln.strip()]


def _code_remote_keys(ctx: Ctx, home: Path) -> set:
    """Все адреса репозитория кода (он открытый): каждый remote, на приём и на отправку."""
    keys = set()
    for top in _code_tops(ctx, home):
        for name in (_git_at(top, "remote") or "").split():
            for flag in ((), ("--push",)):
                for u in _lines(_git_at(top, "remote", "get-url", *flag, "--all", name)):
                    keys.add(_remote_key(u, top))
    keys.discard("")
    return keys


def private_copy(ctx: Ctx) -> dict:
    """Копия закрытой папки — закрытый репозиторий, названный владельцем: его адрес стоит и в
    origin её собственного git, и в настройке COPY_ADDR того же git. Отправка разрешена, только
    когда всё сошлось; любое сомнение — отказ с причиной, а не отправка.
    Возвращает {"home", "why", "key", "branch"}: home None — закрытой папки со своим git нет;
    why не None — отправлять нельзя (и почему)."""
    home = _copy_home(ctx)
    out = {"home": home, "why": None, "key": None, "branch": None}
    if home is None:
        return out
    urls = _lines(_git_at(home, "remote", "get-url", "--push", "--all", "origin"))
    named = _cfg(home, COPY_ADDR)
    how = (f"Копию называет владелец: `git -C {home} remote add origin <адрес ЗАКРЫТОГО "
           f"репозитория>` и `git -C {home} config {COPY_ADDR} <тот же адрес>`")
    if not urls and not named:
        out["why"] = (f"у закрытой папки {home} нет копии: тексты правил, карточки и записки "
                      f"лежат в одном экземпляре. {how}")
        return out
    key = _remote_key(named, home)
    if not named or len(urls) != 1 or _remote_key(urls[0], home) != key:
        out["why"] = (f"копия закрытой папки {home} не подтверждена: адрес отправки в origin её "
                      f"git и адрес в настройке {COPY_ADDR} должны быть одним адресом, а сейчас "
                      f"это не так (origin: {len(urls)} адрес(ов), {COPY_ADDR}: "
                      f"{'записан' if named else 'не записан'}). Отправки нет. {how}")
        return out
    code = _code_remote_keys(ctx, home)
    if not code:
        out["why"] = (f"копия закрытой папки {home} не отправляется: не удалось прочитать адрес "
                      f"репозитория кода, чтобы убедиться, что копия — не он. Запускать команду "
                      f"из рабочей копии репозитория")
        return out
    if key in code:
        out["why"] = (f"копией закрытой папки {home} назван репозиторий кода — он открытый, "
                      f"тексты правил туда не отправляются. Отправки нет; адрес копии называет "
                      f"владелец")
        return out
    branch = _cfg(home, COPY_BRANCH)
    if not branch:
        ref = (_git_at(home, "symbolic-ref", "-q", "HEAD") or "").strip()
        branch = ref[len("refs/heads/"):] if ref.startswith("refs/heads/") else ""
    if not branch or _git_at(home, "check-ref-format", "refs/heads/" + branch) is None:
        out["why"] = (f"закрытая папка {home} не на ветке, а ветка копии не записана: "
                      f"`git -C {home} config {COPY_BRANCH} <ветка копии>`")
        return out
    out.update(key=key, branch=branch)
    return out


def private_unsaved(ctx: Ctx) -> int:
    """Сколько файлов закрытой папки изменено и не записано в её историю (значит, и в копии
    их нет). В историю их кладёт mark.py (записка, вопрос, ворота) и next_card.py --take."""
    home = _copy_home(ctx)
    return len(_lines(_git_at(home, "status", "--porcelain"))) if home else 0


def private_copy_lag(ctx: Ctx, copy=None):
    """Без сети: чем копия закрытой папки отстаёт от её истории. None — копия названа и в неё
    отправлено всё, что записано в историю. «Отправлено» — это запись COPY_SENT (коммит и
    адрес последней удавшейся отправки), а не местная пометка origin/<ветка>: та переживает
    смену адреса. Если копию стёрли и завели заново по тому же адресу, без сети этого не
    увидеть."""
    copy = copy or private_copy(ctx)
    home = copy["home"]
    if home is None:
        return None
    if copy["why"]:
        return copy["why"]
    head = (_git_at(home, "rev-parse", "--verify", "--quiet", "HEAD") or "").strip()
    if not head:
        return None  # в истории папки ещё пусто: отправлять нечего до первой записи
    sent, _, where = _cfg(home, COPY_SENT).partition(" ")
    if not sent or where != copy["key"]:
        return f"копия закрытой папки {home} по нынешнему адресу ещё ни разу не отправлялась"
    if sent == head:
        return None
    behind = (_git_at(home, "rev-list", "--count", f"{sent}..HEAD") or "").strip()
    return (f"копия закрытой папки {home} отстаёт"
            + (f" на {behind} коммит(ов)" if behind not in ("", "0") else ""))


def _push_timeout() -> int:
    """Сколько секунд ждать отправку копии; негодное значение настройки — обычные 45."""
    raw = (os.environ.get("ERP_PUSH_TIMEOUT") or "").strip()
    try:
        n = int(raw) if raw else 45
    except ValueError:
        n = 45
    return min(max(n, 1), 600)


@contextlib.contextmanager
def _copy_lock(home: Path, limit: int):
    """Одна отправка за раз. Отдаёт {"held", "waited"}: замок взят ли и пришлось ли ждать
    другую сессию. Ждёт не дольше limit секунд — иначе очередь сессий копила бы ожидание."""
    state = {"held": False, "waited": False}
    fd = None
    try:
        import fcntl
        fd = os.open(str(home / ".git"), os.O_RDONLY)
        until = time.monotonic() + limit
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                state["held"] = True
                break
            except OSError:
                state["waited"] = True
                if time.monotonic() >= until:
                    break
                time.sleep(0.2)
    except Exception:  # noqa: BLE001
        state["held"] = fd is None  # замков нет вовсе (не та система): работаем без него
    try:
        yield state
    finally:
        if fd is not None:
            os.close(fd)


def _push_copy(home: Path, branch: str, limit: int):
    """git push закрытой папки в её копию: (удалось, что сказал git). Всегда только вперёд
    (без force). По истечении времени убивается вся группа процессов — и git, и его ssh."""
    try:
        p = subprocess.Popen(["git", "push", "-q", "origin", f"HEAD:refs/heads/{branch}"],
                             cwd=str(home), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, encoding="utf-8", errors="replace",
                             start_new_session=True, env=dict(os.environ, GIT_TERMINAL_PROMPT="0"))
    except OSError:
        return False, "git не запустился"
    try:
        out, err = p.communicate(timeout=limit)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(Exception):
            os.killpg(p.pid, signal.SIGKILL)
        with contextlib.suppress(Exception):
            p.communicate(timeout=5)
        return False, f"git не ответил за {limit} с"
    return p.returncode == 0, (err or "") + (out or "")


PUSH_REASONS = (  # что git сказал → что случилось; слова git в строку не идут: в них адрес копии
    (("[rejected]", "non-fast-forward", "fetch first"), "в копии есть запись, которой нет в папке"),
    (("не ответил за", "не запустился"), None),  # наши собственные слова — как есть
    (("could not resolve host", "couldn't resolve host", "unable to look up", "name or service not known",
      "temporary failure in name resolution"), "адрес копии не найден в сети"),
    (("authentication failed", "permission denied", "could not read username", "terminal prompts disabled",
      "returned error: 403", "returned error: 401"), "нет доступа к копии: вход не прошёл"),
    (("repository not found", "does not appear to be a git repository", "returned error: 404", "not found"),
     "копия не найдена по своему адресу"),
    (("remote rejected", "hook declined", "protected branch"), "сервер копии отклонил запись"),
    (("failed to connect", "unable to connect", "connection refused", "timed out", "network is unreachable",
      "could not read from remote", "connection reset", "unable to access"), "нет связи с копией"),
)


def _push_failure(said: str, home: Path, branch: str):
    """(что случилось, что делать) по ответу git. В строку идут только свои слова: адрес и
    узел копии в неё не попадают (вывод команд сессии переносят в PR открытого репозитория).
    Что сказал git дословно — в файле PUSH_LOG внутри .git закрытой папки."""
    low = (said or "").lower()
    what = next((said.strip() if text is None else text for keys, text in PUSH_REASONS
                 if any(k in low for k in keys)), "git отказал")
    with contextlib.suppress(Exception):
        (home / ".git" / PUSH_LOG).write_text(f"{today()}\n{said or ''}\n", encoding="utf-8")
    push = f"`git -C {home} push origin HEAD:refs/heads/{branch}`"
    if what.startswith("в копии есть запись"):
        ident = "" if (_git_at(home, "config", "user.email") or "").strip() else \
            " -c user.name=erp -c user.email=erp@localhost"
        return what, (f"Сначала забрать её: `git -C {home}{ident} pull --no-rebase --no-edit origin "
                      f"{branch}`, потом {push}")
    return what, f"Что сказал git — в {home / '.git' / PUSH_LOG}. Отправить ещё раз: {push}"


def sync_private_copy(ctx: Ctx) -> list:
    """Доводит копию закрытой папки до её истории и возвращает строки для печати. В сеть
    идёт, только когда есть что отправить. Отказ копии работу не останавливает: запись уже
    в истории папки, — но молчать о нём нельзя, поэтому строка начинается с «ВНИМАНИЕ»."""
    copy = private_copy(ctx)
    home = copy["home"]
    if private_copy_lag(ctx, copy) is None:
        return []
    if copy["why"]:
        return ["ВНИМАНИЕ: " + copy["why"]]
    limit, started = _push_timeout(), time.time()
    with _copy_lock(home, limit) as lock:
        if private_copy_lag(ctx, copy) is None:
            return []  # пока ждали замок, отставшее отправила другая сессия
        head = (_git_at(home, "rev-parse", "--verify", "--quiet", "HEAD") or "").strip()
        failed = _cfg(home, COPY_FAILED).split(" ", 2)
        fresh = len(failed) == 3 and failed[1:] == [head, copy["key"]] and \
            failed[0].isdigit() and int(failed[0]) >= int(started)
        if not lock["held"] or (lock["waited"] and fresh):
            # отправку ведёт или только что не смогла другая сессия: вторую попытку не копим
            return [f"ВНИМАНИЕ: копия закрытой папки НЕ обновилась: её сейчас отправляет другая "
                    f"сессия, и у неё не вышло или ещё не вышло. Запись цела — она в истории "
                    f"папки {home}; досылку повторит следующая команда"]
        ok, said = _push_copy(home, copy["branch"], limit)
        if ok and head:
            _cfg_set(home, COPY_FAILED, None)
            _cfg_set(home, COPY_BRANCH, copy["branch"])
            if _cfg_set(home, COPY_SENT, f"{head} {copy['key']}"):
                return ["Копия закрытой папки обновлена"]
            return [f"ВНИМАНИЕ: копия закрытой папки обновлена, но запись об этом ({COPY_SENT}) "
                    f"не легла в настройки git папки {home}: следующие команды будут считать "
                    f"копию отставшей и отправлять заново. Проверить {home / '.git' / 'config.lock'} "
                    f"(остаётся от прерванного git) и права на запись в {home / '.git'}"]
        _cfg_set(home, COPY_FAILED, f"{int(time.time())} {head} {copy['key']}")
    what, todo = _push_failure(said, home, copy["branch"])
    return [f"ВНИМАНИЕ: копия закрытой папки НЕ обновилась ({what}). Сама запись цела — она в "
            f"истории папки {home}. {todo}; force-push запрещён"]


def docs_drift(ctx: Ctx) -> list:
    """Что разошлось между документом, закрытым реестром и открытым реестром."""
    if ctx.private is None:
        return []
    reg = ctx.private_registry()
    src = ((reg.get("meta") or {}).get("source") or {}) if isinstance(reg, dict) else {}
    root = ctx.private.parent.parent  # корень закрытой папки: в нём reports/ и research_notes/
    out = []
    for key, name in (("arch", "«Архитектура»"), ("plan", "«План»")):
        rel, want = src.get(key), src.get(key + "_sha256")
        if not rel or not want:
            continue
        path = root / rel
        if not path.is_file():
            out.append(f"{name}: файла {path} нет — реестр не с чем сверить")
        elif sha(path.read_text(encoding="utf-8")) != want:
            out.append(f"{name} ({rel}) изменился после сборки реестра")
    if reg and reg is not ctx.registry:
        mine = {r.get("slug"): r.get("text_hash") for r in reg.get("rules") or []}
        diff = sorted(s for s in set(mine) | set(ctx.by_slug)
                      if mine.get(s) != (ctx.by_slug.get(s) or {}).get("text_hash"))
        if diff:
            out.append(f"закрытый реестр пересобран, а открытый нет: расходится правил {len(diff)} "
                       f"({', '.join(diff[:5])})")
    return out


def require_docs(ctx: Ctx) -> None:
    drift = docs_drift(ctx)
    if drift:
        raise Fail(f"документ изменился — работу не продолжать: {drift[0]}. Порядок: правка "
                   f"документа → {DOC_CHAIN}")


def cards_problem(ctx: Ctx):
    """Файлы карточек собраны не из нынешних order.json и реестра — или None.
    Спрашивается сам сборщик (build_cards.py --check), если он лежит в закрытой папке."""
    if ctx.private is None:
        return None
    tool = ctx.private / "tools" / "build_cards.py"
    if not tool.is_file():
        return None
    try:
        r = subprocess.run([sys.executable, str(tool), "--check"], capture_output=True, text=True,
                           timeout=120, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
    except Exception as e:  # noqa: BLE001
        return f"build_cards.py --check не выполнилась: {e}"
    if r.returncode == 0:
        return None
    first = next((ln for ln in (r.stdout + r.stderr).splitlines() if ln.strip()), "")
    return (f"файлы карточек устарели ({first.strip()[:140]}): в них может быть прежний текст "
            f"правил. Порядок: {DOC_CHAIN}")


# --------------------------------------------------------------------------- подтверждение человека

def confirm_words(words, what: str) -> str:
    """Дословные слова подтверждения. Пустые — отказ; длинные — отказ (не обрезаем молча:
    запись должна быть дословной и помещаться в строку экрана владельца)."""
    words = " ".join(str(words or "").split())
    if len(words) < 2:
        raise Fail(f"{what}: нужны дословные слова из сообщения владельца (--words \"…\"); для "
                   f"клиента — что он сделал и где лежит свидетельство. Сообщения в видимой части "
                   f"разговора нет — спроси владельца ещё раз: по памяти и по своим прежним "
                   f"репликам подтверждение не записывается")
    if len(words) > WORDS_MAX:
        raise Fail(f"{what}: слова длиннее {WORDS_MAX} знаков — запиши дословно ту часть сообщения, "
                   f"где само решение")
    return words


def record_hash(rec: dict) -> str:
    """Хэш записи человека: от всех её полей, включая случайную добавку."""
    body = {k: rec.get(k) for k in RECORD_KEYS}
    return sha(json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


def write_record(ctx: "Ctx", kind: str, key: str, role: str, by: str, date: str, words: str) -> dict:
    """Записать подтверждение человека. Имя и дословные слова — в закрытую папку
    (records/<хэш>.json); возвращается то, что идёт в открытое состояние: роль, дата, хэш."""
    need_private(ctx)
    rec = {"kind": kind, "key": str(key), "role": role, "by": by, "date": date, "words": words,
           "salt": secrets.token_hex(16)}
    h = record_hash(rec)
    folder = ctx.private / RECORDS
    folder.mkdir(parents=True, exist_ok=True)
    _write_json(folder / f"{h}.json", rec)
    return {"role": role, "date": date, "record": h}


def read_record(ctx: "Ctx", k):
    """Закрытая часть записи (имя, слова) или None: закрытой папки нет, файла нет, не читается."""
    h = str((k or {}).get("record") or "") if isinstance(k, dict) else ""
    if ctx.private is None or not RECORD_HASH.match(h):
        return None
    path = ctx.private / RECORDS / f"{h}.json"
    if not path.is_file():
        return None
    try:
        rec = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return rec if isinstance(rec, dict) else None


def confirmation_ok(k) -> bool:
    """Открытая запись подтверждения полная: роль, дата и хэш закрытой записи — и ничего, что
    назвало бы человека или его слова."""
    return bool(isinstance(k, dict) and k.get("role") and k.get("date")
                and RECORD_HASH.match(str(k.get("record") or ""))
                and not any(x in k for x in RECORD_SECRET))


def record_problem(ctx: "Ctx", k, kind: str, key: str):
    """Чем плоха запись человека — или None. Открытая часть проверяется всегда; закрытая (имя,
    слова, совпадение хэша) — когда закрытая папка доступна: в GitHub её нет и не будет."""
    if not isinstance(k, dict):
        return "запись не в том виде"
    leak = [x for x in RECORD_SECRET if x in k]
    if leak:
        return (f"в открытой записи есть поле {', '.join(leak)} — имя и дословные слова хранятся "
                f"только в закрытой папке, здесь остаются роль, дата и хэш")
    if not k.get("role") or not k.get("date") or not RECORD_HASH.match(str(k.get("record") or "")):
        return "нет роли, даты или хэша записи (record) — запись ставит только mark.py"
    if ctx.private is None:
        return None
    rec = read_record(ctx, k)
    if rec is None:
        return (f"в закрытой папке нет записи {k['record'][:12]}… ({RECORDS}/) — имени и слов "
                f"человека за этим хэшем нет")
    if record_hash(rec) != k["record"]:
        return f"запись {k['record'][:12]}… в закрытой папке изменена: хэш не сходится"
    if (rec.get("kind"), str(rec.get("key")), rec.get("role"), rec.get("date")) != \
            (kind, str(key), k.get("role"), k.get("date")):
        return (f"запись {k['record'][:12]}… в закрытой папке — о другом (другая роль, дата "
                f"или предмет)")
    by = str(rec.get("by") or "").strip()
    if len(by) < 2 or by.lower() in NOT_A_PERSON:
        return f"запись {k['record'][:12]}…: в закрытой папке нет имени человека"
    words = str(rec.get("words") or "").strip()
    if not words:
        return f"запись {k['record'][:12]}…: в закрытой папке нет дословных слов"
    if len(words) > WORDS_MAX:
        return f"запись {k['record'][:12]}…: слова длиннее {WORDS_MAX} знаков"
    return None


def secret_fields(node, path="") -> list:
    """Где в открытом состоянии встретились имя или слова человека (их там быть не должно)."""
    out = []
    if isinstance(node, dict):
        for name, v in node.items():
            here = f"{path}.{name}" if path else str(name)
            if name in ("by", "words"):
                out.append(here)
            else:
                out += secret_fields(v, here)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out += secret_fields(v, f"{path}[{i}]")
    return out


def passed_gates(ctx: "Ctx") -> list:
    """[(ворота, [запись подтверждения, …])] — всё, что записано у ворот, по порядку номеров."""
    out = []
    for c in ctx.cards:
        if c.gate:
            conf = ctx.progress["gates"].get(c.key, {}).get("confirmations") or []
            if conf:
                out.append((c, conf))
    return out


def gate_line(ctx: "Ctx", k) -> str:
    """Строка записи для человека: имя и слова — из закрытой папки, если она доступна."""
    role = ROLE_RU.get(k.get("role"), k.get("role"))
    rec = read_record(ctx, k)
    if rec is None or record_hash(rec) != k.get("record"):
        why = "имя и слова — в закрытой папке" if ctx.private is None else \
            "ЗАПИСИ В ЗАКРЫТОЙ ПАПКЕ НЕТ ИЛИ ОНА ИЗМЕНЕНА"
        return f"{role}, {k.get('date')}: {why} (запись {str(k.get('record') or '—')[:12]})"
    return f"{role} — {rec.get('by')}, {k.get('date')}: «{rec.get('words') or 'слов нет'}»"


# --------------------------------------------------------------------------- записка в открытой части

def public_note(ctx: Ctx, card: Card, blocked="none", blocked_rules=(), at=None) -> dict:
    """Короткая записка для открытого репозитория: только номера шагов и правил и одно слово
    из списка. Собирает её команда, а не сессия: текста и ноу-хау в ней быть не может.
    steps_at_note — сколько шагов было отмечено, когда записку писали (at — прежнее значение
    при обновлении сводки): записка с середины карточки карточку не закрывает."""
    st = ctx.progress["cards"].get(card.key, {})
    done_steps = sorted(set(st.get("steps_done") or []))
    left = steps_left(ctx, card)
    views = {s: rule_view(ctx, ctx.by_slug[s], card) for s in card.all_rules}
    return {"date": today(), "branch": st.get("taken_by"),
            "steps_at_note": len(done_steps) if at is None else at,
            "steps_done": done_steps, "next_step": left[0] if left else None,
            "rules_done": [s for s, v in views.items() if v in ("done", "part_done")],
            "rules_open": [s for s, v in views.items() if v == "open"],
            "rules_waiting": [s for s, v in views.items() if v in ("look", "waits", "problem")],
            "blocked": blocked, "blocked_rules": list(blocked_rules)}


def note_line(note: dict) -> str:
    def nums(xs):
        return ", ".join(map(str, xs)) if xs else "—"
    return (f"{note.get('date')} · ветка {note.get('branch')} · шаги сделаны: "
            f"{nums(note.get('steps_done'))}; следующий шаг: {note.get('next_step') or '—'}; "
            f"правила сделаны: {nums(note.get('rules_done'))}; открыты: "
            f"{nums(note.get('rules_open'))}; ждут: {nums(note.get('rules_waiting'))}; мешает: "
            f"{note.get('blocked')}" + (f" ({nums(note.get('blocked_rules'))})"
                                         if note.get("blocked_rules") else ""))


def note_errors(ctx: Ctx, key: str, note) -> list:
    """Записка в открытой части — только то, что собирает public_note."""
    if not isinstance(note, dict):
        return [f"карточка {key}: записка не в том виде"]
    allowed = {"date", "branch", "steps_done", "next_step", "rules_done", "rules_open",
               "rules_waiting", "blocked", "blocked_rules", "steps_at_note"}
    out = [f"карточка {key}: в записке лишнее поле {k} — текст записки хранится в закрытой папке"
           for k in sorted(set(note) - allowed)]
    if note.get("blocked", "none") not in NOTE_BLOCKED:
        out.append(f"карточка {key}: «мешает» — одно слово из списка {', '.join(NOTE_BLOCKED)}")
    for k in ("rules_done", "rules_open", "rules_waiting", "blocked_rules"):
        out += [f"карточка {key}: в записке {k} — не номер правила: {str(s)[:40]}"
                for s in note.get(k) or [] if s not in ctx.by_slug]
    if any(not isinstance(n, int) for n in note.get("steps_done") or []) or \
            not isinstance(note.get("next_step"), (int, type(None))) or \
            not isinstance(note.get("steps_at_note"), (int, type(None))):
        out.append(f"карточка {key}: шаги в записке — только номера")
    return out


# --------------------------------------------------------------------------- карточки и ворота

def cstate(ctx: Ctx, card: Card) -> dict:
    return ctx.progress["cards"].setdefault(card.key, {})


def steps_left(ctx: Ctx, card: Card) -> list:
    done = set(ctx.progress["cards"].get(card.key, {}).get("steps_done") or [])
    return [i for i in range(1, len(ctx.steps(card)) + 1) if i not in done]


def closure_gaps(ctx: Ctx, card: Card) -> list:
    """Чего не хватает, чтобы закрыть рабочую карточку (пусто — можно закрывать)."""
    gaps = []
    for s in card.all_rules:
        r = ctx.by_slug[s]
        v = rule_view(ctx, r, card)
        if v == "open":
            part = f": нужна часть этой карточки (тест {s}#{card.key})" \
                if s in ctx.carry else ""
            gaps.append(f"правило {s} ({r['id']}) не сделано{part}")
    left = steps_left(ctx, card)
    if left:
        gaps.append("не отмечены шаги: " + ", ".join(map(str, left)))
    note = ctx.progress["cards"].get(card.key, {}).get("note")
    if not note:
        gaps.append("нет записки следующей сессии (mark.py note)")
    elif isinstance(note, dict) and isinstance(note.get("steps_at_note"), int) \
            and note["steps_at_note"] < len(ctx.steps(card)):
        gaps.append(f"записка написана на шаге {note['steps_at_note']} (сессия тогда остановилась): "
                    f"после последнего шага нужна итоговая записка (mark.py note)")
    return gaps


def gate_missing(ctx: Ctx, card: Card) -> list:
    """Роли, от которых ещё нет полной записи: роль, дата и хэш закрытой записи с именем и
    дословными словами."""
    conf = ctx.progress["gates"].get(card.key, {}).get("confirmations") or []
    have = {c.get("role") for c in conf if confirmation_ok(c)}
    return [w for w in card.who if w not in have]


def is_closed(ctx: Ctx, card: Card) -> bool:
    if card.gate:
        return not gate_missing(ctx, card)
    st = ctx.progress["cards"].get(card.key, {})
    return bool(st.get("closed")) and not closure_gaps(ctx, card)


def holder(ctx: Ctx, card: Card):
    """Ветка, которая держит карточку, или None."""
    if card.gate or is_closed(ctx, card):
        return None
    st = ctx.progress["cards"].get(card.key, {})
    if st.get("taken_by") and not st.get("closed"):
        return st["taken_by"]
    if ctx.branch_holds(card.branch):
        return card.branch  # ветка, уже влитая в origin/main, карточку не держит
    return None


def before(ctx: Ctx, card: Card) -> list:
    return [c for c in ctx.cards if c.sort < card.sort]


def open_problems(ctx: Ctx, cards) -> list:
    seen, out = set(), []
    for c in cards:
        for s in c.all_rules:
            if s not in seen and ctx.by_slug[s].get("problem"):
                seen.add(s)
                out.append(s)
    return out


def pick_next(ctx: Ctx, me=None, ignore=None) -> dict:
    """Что выдать сейчас. Одно из:
      {"kind": "card", "card", "resume"}  — эту карточку и никакую другую;
      {"kind": "gate", "card", "need", "problems"} — впереди ворота, нужно действие человека;
      {"kind": "outline", "card"}         — очередь дошла до карточки, которая ещё не расписана;
      {"kind": "wait", "why"}             — взять нечего, пока не закончат занятые;
      {"kind": "done"}                     — всё закрыто.
    Порядок: первая по номеру карточка, которая не закрыта, не занята и у которой закрыты все
    «после». Карточка с кодом продукта (parallel_ok = false) одна в работе; карточку без кода
    (parallel_ok = true) можно вести рядом с любыми. За незакрытые ворота очередь не идёт.
    ignore — номер карточки, чьи отметки «занята/закрыта» не учитывать (проверка в GitHub
    спрашивает: «а выдали бы мы эту карточку?»)."""
    def closed(c):
        return False if c.key == ignore else is_closed(ctx, c)

    def held(c):
        return None if c.key == ignore else holder(ctx, c)

    if me:
        for c in ctx.cards:
            if not c.gate and held(c) == me and \
                    ctx.progress["cards"].get(c.key, {}).get("taken_by") == me:
                return {"kind": "card", "card": c, "resume": True}
    busy, reasons = [], []
    for c in ctx.cards:
        if closed(c):
            continue
        if c.gate:
            not_ready = [p for p in before(ctx, c) if not closed(p)]
            if not not_ready:
                return {"kind": "gate", "card": c, "need": gate_missing(ctx, c),
                        "problems": open_problems(ctx, before(ctx, c))}
            reasons.append(f"до ворот {c.key} не закрыты карточки: "
                           + ", ".join(p.key for p in not_ready[:8]))
            break
        h = held(c)
        if h and h != me:
            busy.append((c, h))
            reasons.append(f"карточка {c.key} занята веткой {h}")
            continue
        waiting = [a for a in c.after if a in ctx.by_key and not closed(ctx.by_key[a])]
        if waiting:
            reasons.append(f"карточка {c.key} ждёт карточки: {', '.join(waiting)}")
            continue
        code_busy = [b for b, _ in busy if not b.parallel_ok]
        if not c.parallel_ok and code_busy:
            reasons.append(f"карточка {c.key} с кодом, а карточки с кодом идут по одной: "
                           f"занята {code_busy[0].key}")
            continue
        if c.outline:
            return {"kind": "outline", "card": c}
        return {"kind": "card", "card": c, "resume": False}
    if reasons:
        return {"kind": "wait", "why": "; ".join(reasons[:6])}
    return {"kind": "done"}


def card_for_branch(ctx: Ctx, branch: str):
    for c in ctx.cards:
        if c.branch == branch:
            return c
    return None


def refresh(ctx: Ctx) -> list:
    """Привести отметки в соответствие с текстом правил. Возвращает строки о том, что сброшено.
    Вызывают только команды, которые пишут (mark.py, next_card.py --take)."""
    notes = []
    for r in ctx.rules:
        stale_text = not text_matches(ctx, r)
        if r.get("status") == "done":
            d = r.get("done") or {}
            why = None
            if r.get("mark") == "to_look":
                why = "правило помечено «досмотреть»"
            elif d.get("hash") != r.get("text_hash"):
                why = "текст правила изменился (хэш в реестре другой)"
            elif stale_text:
                why = "текст правила изменился (в закрытой папке он уже не тот, что в реестре)"
            if why:
                reset_rule(ctx, r, why)
                notes.append(f"СБРОШЕНО: {r['slug']} ({r['id']}) — {why}")
        if r.get("status") != "done" and "done" in r:
            shelve_evidence(r)  # свидетельство владельца — в журнал, а не в никуда
            r.pop("done")  # реестр пересобрали и статус сбросили, а старое доказательство осталось
        parts = r.get("parts_done") or {}
        for key in [k for k, p in parts.items()
                    if p.get("hash") != r.get("text_hash") or stale_text]:
            parts.pop(key)
            ctx.log("reset_part", rule=r["slug"], card=key)
            notes.append(f"СБРОШЕНО: {r['slug']} ({r['id']}) — часть карточки {key}: "
                         f"текст правила изменился")
        if "parts_done" in r and not parts:
            r.pop("parts_done")
        for field, name in (("prelook", "поведение «до просмотра»"),
                            ("problem", "вопрос по правилу")):
            f = r.get(field)
            if f and (f.get("hash") != r.get("text_hash") or stale_text):
                r.pop(field)
                ctx.log("reset_" + field, rule=r["slug"])
                notes.append(f"СБРОШЕНО: {r['slug']} ({r['id']}) — {name}: текст правила изменился")
        pc = r.get("problem_cleared")
        if pc and (pc.get("hash") != r.get("text_hash") or stale_text):
            shelve_cleared(r)  # ответ владельца к прежнему тексту остаётся в журнале
        if r.get("mark") == "to_look" and r.get("status") != "blocked_to_look":
            r["status"] = "blocked_to_look"
        if r.get("mark") != "to_look" and r.get("status") == "blocked_to_look":
            r["status"] = "not_started"
    for c in ctx.cards:
        st = ctx.progress["cards"].get(c.key)
        if c.gate or not st or not st.get("closed"):
            continue
        gaps = closure_gaps(ctx, c)
        if gaps:
            st["reopened"] = {"date": today(), "was_closed": st.pop("closed"), "why": gaps[:5]}
            st.pop("taken_by", None)
            st.pop("note", None)
            ctx.log("reopen", card=c.key, why=gaps[:5])
            notes.append(f"КАРТОЧКА {c.key} СНОВА ОТКРЫТА: {gaps[0]}")
    return notes


def validate_order(ctx: Ctx):
    """(ошибки, предупреждения) по самому порядку карточек."""
    errors, warns = list(ctx.carry_errors), []
    in_cards: dict = {}
    for c in ctx.cards:
        for a in c.after:
            if a not in ctx.by_key:
                errors.append(f"карточка {c.key}: в «после» названа карточка {a}, которой нет")
            elif ctx.by_key[a].sort >= c.sort:
                errors.append(f"карточка {c.key}: «после» указывает на карточку {a} "
                              f"с тем же или большим номером")
        for u in c.unknown_rules:
            errors.append(f"карточка {c.key}: правила {u} нет в реестре")
        for s in c.evidence:
            if s not in c.rules:
                errors.append(f"карточка {c.key}: правило {s} названо в evidence_rules, "
                              f"но не входит в карточку")
        if c.gate:
            if c.rules:
                warns.append(f"ворота {c.key}: у ворот записаны правила — они не учитываются")
            if not c.who_given:
                warns.append(f"ворота {c.key}: не указано, кто подтверждает — считаю: "
                             + who_ru(c.who))
        else:
            for s in c.rules:
                in_cards.setdefault(s, []).append(c.key)
            if not c.outline and not ctx.steps(c):
                warns.append(f"карточка {c.key}: не найдены шаги")
    covered = {str(c.slice) for c in ctx.cards if not c.gate and c.rules}
    uncovered: dict = {}
    for r in ctx.rules:
        where = in_cards.get(r["slug"], [])
        sl = str(r.get("slice"))
        if not where and r.get("mark") != "to_look" and sl != "later":
            if sl in covered:
                errors.append(f"правило {r['slug']} ({r['id']}) не попало ни в одну карточку")
            else:
                uncovered[sl] = uncovered.get(sl, 0) + 1
        if len(where) > 1:
            warns.append(f"правило {r['slug']} стоит в нескольких карточках: {', '.join(where)} "
                         f"(для правила с продолжением нужен блок carry)")
    for sl, n in sorted(uncovered.items()):
        warns.append(f"срез {sl} ещё не разложен по карточкам: правил {n}")
    branches = [c.branch for c in ctx.cards]
    for b in sorted({b for b in branches if branches.count(b) > 1}):
        errors.append(f"две карточки дают одну ветку {b}")
    return errors, warns


def cards_of_rule(ctx: Ctx, slug: str) -> list:
    return [c for c in ctx.cards if not c.gate and slug in c.all_rules]


def find_rule(ctx: Ctx, name: str):
    r = ctx.by_slug.get(name) or ctx.by_id.get(name)
    if r is None:
        raise Fail(f"правила {name} нет в реестре")
    return r


def find_card(ctx: Ctx, key: str) -> Card:
    key = str(key).strip()
    c = ctx.by_key.get(key)
    if c is None and key.isdigit():  # «8» вместо «008»
        hits = [x for x in ctx.cards if x.key.isdigit() and int(x.key) == int(key)]
        c = hits[0] if len(hits) == 1 else None
    if c is None:
        raise Fail(f"карточки {key} нет в order.json")
    return c


def who_ru(roles) -> str:
    return ", ".join(ROLE_RU.get(w, w) for w in roles)
