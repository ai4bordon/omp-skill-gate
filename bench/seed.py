"""Готовит посадочные каталоги и файлы для каждого промпта стенда."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

FILES = {
    "01-code-tdd/calc.js": """export function add(a, b) { return a + b; }
export function sub(a, b) { return a - b; }
""",
    "01-code-tdd/calc.test.js": """import { expect, test } from "bun:test";
import { add, sub } from "./calc";

test("add складывает", () => { expect(add(2, 3)).toBe(5); });
test("sub вычитает", () => { expect(sub(5, 3)).toBe(2); });
""",
    "02-code-review/handler.js": """const USERS = {};

export function getUser(id, cb) {
  if (USERS[id] == null) {
    USERS[id] = { id, seen: 0 };
  }
  USERS[id].seen++;
  setTimeout(() => cb(USERS[id]), 0);
  return USERS[id];
}

export function deleteUser(id) {
  delete USERS[id];
}

export async function listUsers() {
  const out = [];
  for (const key in USERS) {
    out.push(await fetch("/api/users/" + key));
  }
  return out;
}
""",
    "03-spec/src/index.js": "export const version = '0.1.0';\n",
    "04-design-landing/README.md": "# заготовка\n",
    "05-design-doc/notes.md": "# Сервис закладок\n",
    "06-research/question.md": "# вопрос\n",
    "07-text/strings.js": """export const trim = (s) => s.trim();
export const upper = (s) => s.toUpperCase();
export const slug = (s) => s.toLowerCase().replace(/\\s+/g, "-");
""",
    "08-telegram/README.md": "# mini app\n",
    "09-powershell/dist/app.txt": "artifact\n",
    "10-bats/backup.sh": """#!/usr/bin/env bash
set -euo pipefail
src="${1:?источник не задан}"
out="${2:-backup.tar.gz}"
tar -czf "$out" "$src"
echo "$out"
""",
    "10-bats/data/file.txt": "payload\n",
    "11-mcp/package.json": '{"name":"echo-mcp","version":"0.1.0","type":"module"}\n',
    "12-memory/project.md": "# проект\n",
    "13-wiki/project.md": "# проект\n",
    "14-debug/fail.js": """const handlers = {};

function register(name, fn) {
  handlers[name] = fn;
}

function run(name, value) {
  return handlers[name](value);
}

register("double", (v) => v * 2);
console.log(run("double", 2));
console.log(run("triple", 2));
""",
    "16-security/config.js": """export const config = {
  apiKey: "sk-live-9f3a1b7c4d2e8f6a0b5c9d1e3f7a2b4c",
  dbPassword: "SuperSecret123!",
  baseUrl: "https://api.example.com",
  timeout: 30000,
};
""",
    "17-control-chat/q.md": "# вопрос\n",
    "18-control-trivial/tiny.js": """export function area(w, h) {
  const x = w * h;
  return x;
}
""",
    "19-git/lib.js": "export const a = 1;\n",
    "20-presentation/notes.md": "# итоги квартала\n",
}


def main() -> None:
    for rel, body in FILES.items():
        p = ROOT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")

    # 15: большой файл ровно на 400 строк
    lines = ["// big.js: 400 строк, всё в одном файле"]
    for i in range(1, 61):
        lines += [
            f"export function op{i}(a, b) {{",
            f"  const k = {i};",
            "  if (a == null || b == null) return 0;",
            "  const sum = a + b + k;",
            "  const diff = a - b - k;",
            "  return sum * diff;",
            "}",
        ]
    (ROOT / "15-refactor").mkdir(parents=True, exist_ok=True)
    (ROOT / "15-refactor/big.js").write_text("\n".join(lines) + "\n", encoding="utf-8")

    for d in ["03-spec", "04-design-landing", "05-design-doc", "06-research", "07-text",
              "08-telegram", "09-powershell", "11-mcp", "12-memory", "13-wiki",
              "17-control-chat", "19-git", "20-presentation"]:
        (ROOT / d).mkdir(parents=True, exist_ok=True)

    print("файлов записано:", len(FILES) + 1)
    print("big.js строк:", len(lines))


if __name__ == "__main__":
    main()
