"""Runs on prod for jev-choice-benchmark.ts: Jev (TypeSafe AI) requests, with the key added here.

The key (TYPESAFE_API_KEY) lives only on prod. It is read from /etc/leaddrive/app.env, never
printed, never written; nothing of this process stays on the host (started over ssh from a base64
command line, like line-stand-relay.py). The benchmark builds every request itself; this process
only carries them, four at a time.

stdin  {"id": n, "body": {...}}            one Jev request body (model, state, questions)
stdout {"id": n, "status": 200, "answer": {...}} | {"id": n, "status": 0, "detail": "..."}
"""
import json
import queue
import sys
import threading
import urllib.error
import urllib.request

URL = "https://api.typesafe.ai/v1/systemone"
out_lock = threading.Lock()


def emit(value):
    with out_lock:
        sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def key():
    for line in open("/etc/leaddrive/app.env", encoding="utf-8"):
        if line.startswith("TYPESAFE_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def ask(secret, item):
    request = urllib.request.Request(URL, data=json.dumps(item["body"], ensure_ascii=False).encode("utf-8"), method="POST",
                                     headers={"Authorization": "Bearer " + secret, "Content-Type": "application/json"})
    for attempt in range(2):  # one retry on overload, as the CRM's own Jev judge does
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return {"id": item["id"], "status": response.status, "answer": json.loads(response.read().decode("utf-8"))}
        except urllib.error.HTTPError as error:
            if error.code in (429, 529) or error.code >= 500:
                if attempt == 0:
                    continue
            return {"id": item["id"], "status": error.code, "detail": "http"}
        except Exception as error:  # noqa: BLE001 - a benchmark row, reported, never fatal
            if attempt == 0:
                continue
            return {"id": item["id"], "status": 0, "detail": type(error).__name__}
    return {"id": item["id"], "status": 0, "detail": "retry"}


def main():
    secret = key()
    if not secret:
        emit({"id": -1, "status": 0, "detail": "no TYPESAFE_API_KEY on this host"})
        return
    work = queue.Queue()

    def worker():
        while True:
            item = work.get()
            if item is None:
                return
            emit(ask(secret, item))

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(4)]
    for thread in threads:
        thread.start()
    for line in sys.stdin:
        if line.strip():
            work.put(json.loads(line))
    for _ in threads:
        work.put(None)
    for thread in threads:
        thread.join()


if __name__ == "__main__":
    main()
