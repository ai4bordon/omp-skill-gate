"""Сравнивает два прохода стенда: pass1 (старый гейт) и results (исправленный)."""
import json
import sys
from pathlib import Path

ROOT = Path(r"C:/Users/Kerry/tmp/skillbench")


def load(tag: str) -> dict[str, dict]:
    p = ROOT / tag / "summary.json"
    if not p.exists():
        return {}
    rows = json.loads(p.read_text(encoding="utf-8"))
    return {r["id"]: r for r in rows}


def main() -> None:
    old = load(sys.argv[1] if len(sys.argv) > 1 else "pass1")
    new = load(sys.argv[2] if len(sys.argv) > 2 else "results")
    ids = sorted(set(old) | set(new))
    print("| # | промпт | ходы было → стало | блоки было → стало | цена было → стало |")
    print("|---|---|---|---|---|")
    t_old = t_new = 0
    b_old = b_new = 0
    c_old = c_new = 0.0
    for i in ids:
        a, b = old.get(i), new.get(i)
        if not a or not b:
            print(f"| {i[:2]} | {i[3:]} | нет данных | | |")
            continue
        t_old += a["turns"]; t_new += b["turns"]
        b_old += a["blocks"]; b_new += b["blocks"]
        c_old += a["cost"]; c_new += b["cost"]
        mark = " ✅" if b["turns"] < a["turns"] else ""
        print(
            f"| {i[:2]} | {i[3:]} | {a['turns']} → {b['turns']}{mark} | "
            f"{a['blocks']} → {b['blocks']} | ${a['cost']:.4f} → ${b['cost']:.4f} |"
        )
    print(f"\nходов: {t_old} → {t_new} ({t_new - t_old:+d})")
    print(f"блоков: {b_old} → {b_new} ({b_new - b_old:+d})")
    print(f"цена: ${c_old:.4f} → ${c_new:.4f} ({c_new - c_old:+.4f})")


if __name__ == "__main__":
    main()
