"""Разбирает потоки omp -p (results/<id>.json) и печатает сводку по стенду.

    python parse.py                     # текущий проход, results/
    python parse.py pass1               # сохранённый проход
    python parse.py results --json out.json
"""
import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def _args():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("dir", nargs="?", default="results", help="каталог прогонов (по умолчанию results)")
    ap.add_argument("--json", dest="json_out", help="путь для JSON-сводки (иначе <dir>/summary.json)")
    return ap.parse_args()


ARGS = _args()
RESULTS = ROOT / ARGS.dir
SESSIONS = Path(os.environ.get("SG_SESSIONS", str(Path.home() / ".omp/profiles/aggg5/agent/sessions")))

SKILL_RE = re.compile(r"skill://([A-Za-z0-9._-]+)")
# Та же форма, что в skill-gate.ts: маркер списка, необязательное имя скилла перед [oN]
STATUS_RE = re.compile(
    r"(?:^|\n)[ \t]*(?:[-*+][ \t]+)?(сделано|неприменимо|не сделано)\s*:\s*"
    r"(?:[a-z0-9._-]+[ \t]*\[[ \t]*(o\d+)\b[ \t]*\]|(o\d+)\b)",
    re.I,
)
GATE_MARK = "skill-gate:"


def stream(pid: str) -> list[dict]:
    p = RESULTS / f"{pid}.json"
    if not p.exists():
        return []
    rows = []
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def advisor_notes(session_id: str | None) -> list[dict]:
    if not session_id:
        return []
    hits = list(SESSIONS.glob(f"**/*{session_id}*"))
    notes: list[dict] = []
    for d in hits:
        if d.is_file():
            d = d.parent
        for f in d.glob("__advisor*.jsonl"):
            for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                msg = r.get("message") or {}
                if msg.get("role") != "assistant":
                    continue
                for c in msg.get("content") or []:
                    if not isinstance(c, dict):
                        continue
                    if c.get("type") == "toolCall" and c.get("name") == "advise":
                        a = c.get("arguments") or {}
                        notes.append(
                            {"severity": a.get("severity", "nit"), "note": (a.get("note") or "")[:400]}
                        )
    return notes


def analyze(pid: str, expect: str) -> dict:
    rows = stream(pid)
    m = {
        "id": pid,
        "expect": expect,
        "session": None,
        "skills": [],
        "declared_none": False,
        "blocks": 0,
        "statuses": {"сделано": 0, "неприменимо": 0, "не сделано": 0},
        "cost": 0.0,
        "tokens_in": 0,
        "turns": 0,
        "tools": 0,
        "answer": "",
        "advisor": [],
    }
    for r in rows:
        t = r.get("type")
        if t == "session":
            m["session"] = r.get("id")
        elif t == "turn_start":
            m["turns"] += 1
        elif t == "tool_execution_start":
            m["tools"] += 1
            args = r.get("args") or {}
            path = args.get("path")
            if isinstance(path, str):
                hit = SKILL_RE.search(path)
                if hit and hit.group(1) not in m["skills"]:
                    m["skills"].append(hit.group(1))
        elif t == "tool_execution_end":
            res = r.get("result") or {}
            for c in res.get("content") or []:
                if isinstance(c, dict) and str(c.get("text", "")).startswith(GATE_MARK):
                    m["blocks"] += 1
        elif t == "message_end":
            msg = r.get("message") or {}
            if msg.get("role") == "assistant":
                u = msg.get("usage") or {}
                m["cost"] += (u.get("cost") or {}).get("total", 0) or 0
                m["tokens_in"] += u.get("input", 0) or 0
                texts = [c.get("text", "") for c in msg.get("content") or []
                         if isinstance(c, dict) and c.get("type") == "text"]
                if texts:
                    m["answer"] += "\n".join(texts) + "\n"
    m["declared_none"] = bool(re.search(r"скиллов?\s+нет|no skills", m["answer"], re.I))
    # Групп три: kind, id из формы «скилл [oN]», id из простой формы
    seen_status: set[tuple[str, str]] = set()
    for kind, id_a, id_b in STATUS_RE.findall(m["answer"]):
        key = (kind.lower(), id_a or id_b)
        if key in seen_status:
            continue
        seen_status.add(key)
        if key[0] in m["statuses"]:
            m["statuses"][key[0]] += 1
    m["advisor"] = advisor_notes(m["session"])
    return m


def verdict(m: dict) -> str:
    exp = m["expect"]
    # pohuy грузится всегда по инструкции владельца: это фон, а не выбор скилла
    got = [s for s in m["skills"] if s != "pohuy"]
    if exp == "-":
        return "ok: профильный скилл не нужен и не взят" if not got else f"шум: взял {got[0]}"
    if any(e in got for e in exp.split("|")):
        extra = [s for s in got if s != exp]
        return "ok: нужный скилл" + (f" (+{len(extra)} доп.)" if extra else "")
    if got:
        return f"другой: {got[0]}"
    if m["declared_none"]:
        return "объявил «скиллов нет»"
    return "пропуск: без скилла и без декларации"


def main() -> None:
    prompts = []
    for line in (ROOT / "prompts.tsv").read_text(encoding="utf-8").splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) >= 3 and (RESULTS / f"{parts[0]}.json").exists():
            prompts.append((parts[0], parts[1]))

    out = [analyze(pid, exp) for pid, exp in prompts]
    out_path = Path(ARGS.json_out) if ARGS.json_out else RESULTS / "summary.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print("| # | промпт | ожидался | взял | вердикт | ходов | блок | статусы | советник | цена |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for m in out:
        s = m["statuses"]
        adv = "; ".join(n["severity"] for n in m["advisor"]) or "—"
        skills = ", ".join(s_ for s_ in m["skills"] if s_ != "pohuy") or "—"
        print(
            f"| {m['id'][:2]} | {m['id'][3:]} | {m['expect']} | {skills} | {verdict(m)} | "
            f"{m['turns']} | {m['blocks']} | {s['сделано']}/{s['неприменимо']}/{s['не сделано']} | {adv} | ${m['cost']:.4f} |"
        )

    total = sum(m["cost"] for m in out)
    ok = sum(1 for m in out if verdict(m).startswith("ok"))
    turns = sum(m["turns"] for m in out)
    blocks = sum(m["blocks"] for m in out)
    print(f"\nпрогонов: {len(out)}, верных: {ok}, ходов всего: {turns}, блоков: {blocks}, суммарно: ${total:.4f}")
    print(f"средний прогон: {turns / max(1, len(out)):.1f} ходов, ${total / max(1, len(out)):.4f}")


if __name__ == "__main__":
    main()
