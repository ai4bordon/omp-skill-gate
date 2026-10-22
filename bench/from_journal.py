"""Собирает сводку стенда из журналов сессий (когда потоки omp -p потеряны).

    python from_journal.py 11-1        # проход, чьи сессии начались в 11:1x
    python from_journal.py 11-1 pass2
"""
import json
import re
import sys
from pathlib import Path

SESSIONS = Path(r"C:/Users/Kerry/.omp/profiles/aggg5/agent/sessions")
ROOT = Path(r"C:/Users/Kerry/tmp/skillbench")
SKILL_RE = re.compile(r"skill://([A-Za-z0-9._-]+)")
STATUS_RE = re.compile(
    r"(?:^|\n)[ \t]*(?:[-*+][ \t]+)?(сделано|неприменимо|не сделано)\s*:\s*"
    r"(?:[a-z0-9._-]+[ \t]*\[[ \t]*(o\d+)\b[ \t]*\]|(o\d+)\b)",
    re.I,
)


def prompts() -> list[tuple[str, str]]:
    rows = []
    for line in (ROOT / "prompts.tsv").read_text(encoding="utf-8").splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) >= 3:
            rows.append((parts[0], parts[1]))
    return rows


def pick(run: str, stamp: str) -> Path | None:
    """stamp — регулярка по началу имени файла (метка времени сессии)."""
    d = SESSIONS / f"-tmp-skillbench-{run}"
    if not d.exists():
        return None
    pat = re.compile(stamp)
    files = [f for f in d.glob("*.jsonl") if "__advisor" not in f.name and pat.search(f.name[:19])]
    return sorted(files)[-1] if files else None  # имя начинается с метки времени


def analyze(run: str, expect: str, path: Path | None) -> dict:
    m = {
        "id": run,
        "expect": expect,
        "skills": [],
        "declared_none": False,
        "blocks": 0,
        "statuses": {"сделано": 0, "неприменимо": 0, "не сделано": 0},
        "cost": 0.0,
        "turns": 0,
        "answer": "",
    }
    if path is None:
        return m
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    for r in rows:
        t = r.get("type")
        if t == "custom_message" and r.get("customType") == "session-stop-continuation":
            m["blocks"] += 1
        elif t == "message":
            msg = r.get("message") or {}
            role = msg.get("role")
            if role == "assistant":
                m["turns"] += 1
                u = msg.get("usage") or {}
                m["cost"] += (u.get("cost") or {}).get("total", 0) or 0
                for c in msg.get("content") or []:
                    if not isinstance(c, dict):
                        continue
                    if c.get("type") == "toolCall":
                        p = (c.get("arguments") or {}).get("path")
                        if isinstance(p, str):
                            hit = SKILL_RE.search(p)
                            if hit and hit.group(1) not in m["skills"]:
                                m["skills"].append(hit.group(1))
                    elif c.get("type") == "text" and c.get("text"):
                        m["answer"] += c["text"] + "\n"
    m["declared_none"] = bool(re.search(r"скиллов?\s+нет|no skills", m["answer"], re.I))
    seen = set()
    for kind, a, b in STATUS_RE.findall(m["answer"]):
        key = (kind.lower(), a or b)
        if key in seen:
            continue
        seen.add(key)
        if key[0] in m["statuses"]:
            m["statuses"][key[0]] += 1
    return m


def verdict(m: dict) -> str:
    exp = m["expect"]
    got = [s for s in m["skills"] if s != "pohuy"]
    if exp == "-":
        return "ok" if not got else f"шум: {got[0]}"
    if any(e in got for e in exp.split("|")):
        return "ok"
    if got:
        return f"другой: {got[0]}"
    if m["declared_none"]:
        return "объявил «скиллов нет»"
    return "пропуск"


def main() -> None:
    stamp = sys.argv[1] if len(sys.argv) > 1 else "T11-"
    tag = sys.argv[2] if len(sys.argv) > 2 else None
    out = []
    for run, expect in prompts():
        out.append(analyze(run, expect, pick(run, stamp)))
    if tag:
        (ROOT / tag).mkdir(exist_ok=True)
        (ROOT / tag / "summary.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print("| # | промпт | ожидался | взял | вердикт | ответов | блок | статусы | цена |")
    print("|---|---|---|---|---|---|---|---|---|")
    for m in out:
        s = m["statuses"]
        got = ", ".join(x for x in m["skills"] if x != "pohuy") or "—"
        print(
            f"| {m['id'][:2]} | {m['id'][3:]} | {m['expect']} | {got} | {verdict(m)} | "
            f"{m['turns']} | {m['blocks']} | {s['сделано']}/{s['неприменимо']}/{s['не сделано']} | ${m['cost']:.4f} |"
        )
    print(
        f"\nпрогонов: {len(out)}, верных: {sum(1 for m in out if verdict(m) == 'ok')}, "
        f"блоков: {sum(m['blocks'] for m in out)}, суммарно: ${sum(m['cost'] for m in out):.4f}"
    )


if __name__ == "__main__":
    main()
