#!/usr/bin/env bash
# Готовит посадочные каталоги и файлы для каждого промпта стенда.
set -u
ROOT="/c/Users/Kerry/tmp/skillbench"
cd "$ROOT" || exit 1

# 01: калькулятор с одним тестом
mkdir -p 01-code-tdd && cd 01-code-tdd
cat > calc.js <<'EOF'
export function add(a, b) { return a + b; }
export function sub(a, b) { return a - b; }
EOF
cat > calc.test.js <<'EOF'
import { expect, test } from "bun:test";
import { add, sub } from "./calc";

test("add складывает", () => { expect(add(2, 3)).toBe(5); });
test("sub вычитает", () => { expect(sub(5, 3)).toBe(2); });
EOF
cd "$ROOT"

# 02: файл с проблемами для ревью
mkdir -p 02-code-review && cd 02-code-review
cat > handler.js <<'EOF'
const USERS = {};

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
EOF
cd "$ROOT"

# 03: пустой каталог под спеку
mkdir -p 03-spec && cd 03-spec
mkdir -p src && echo "export const version = '0.1.0';" > src/index.js
cd "$ROOT"

# 04: лендинг
mkdir -p 04-design-landing && cd 04-design-landing
echo "# заготовка" > README.md
cd "$ROOT"

# 05: дизайн-документ
mkdir -p 05-design-doc && cd 05-design-doc
echo "# Сервис закладок" > notes.md
cd "$ROOT"

# 06: ресёрч
mkdir -p 06-research && cd 06-research
echo "# вопрос" > question.md
cd "$ROOT"

# 07: README
mkdir -p 07-text && cd 07-text
cat > strings.js <<'EOF'
export const trim = (s) => s.trim();
export const upper = (s) => s.toUpperCase();
export const slug = (s) => s.toLowerCase().replace(/\s+/g, "-");
EOF
cd "$ROOT"

# 08: telegram mini app
mkdir -p 08-telegram && cd 08-telegram
echo "# mini app" > README.md
cd "$ROOT"

# 09: powershell
mkdir -p 09-powershell && cd 09-powershell
mkdir -p dist && echo "artifact" > dist/app.txt
cd "$ROOT"

# 10: bats
mkdir -p 10-bats && cd 10-bats
cat > backup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
src="${1:?источник не задан}"
out="${2:-backup.tar.gz}"
tar -czf "$out" "$src"
echo "$out"
EOF
chmod +x backup.sh
mkdir -p data && echo "payload" > data/file.txt
cd "$ROOT"

# 11: mcp сервер
mkdir -p 11-mcp && cd 11-mcp
echo '{"name":"echo-mcp","version":"0.1.0","type":"module"}' > package.json
cd "$ROOT"

# 12-13: память и вики
mkdir -p 12-memory && cd 12-memory && echo "# проект" > project.md && cd "$ROOT"
mkdir -p 13-wiki && cd 13-wiki && echo "# проект" > project.md && cd "$ROOT"

# 14: падающий скрипт
mkdir -p 14-debug && cd 14-debug
cat > fail.js <<'EOF'
const handlers = {};

function register(name, fn) {
  handlers[name] = fn;
}

function run(name, value) {
  return handlers[name](value);
}

register("double", (v) => v * 2);
console.log(run("double", 2));
console.log(run("triple", 2));
EOF
cd "$ROOT"

# 15: большой файл
mkdir -p 15-refactor && cd 15-refactor
python - <<'PY'
lines = ["// big.js: 400 строк, всё в одном файле"]
for i in range(1, 61):
    lines.append(f"export function op{i}(a, b) {{")
    lines.append(f"  const k = {i};")
    lines.append("  if (a == null || b == null) return 0;")
    lines.append("  const sum = a + b + k;")
    lines.append("  const diff = a - b - k;")
    lines.append("  return sum * diff;")
    lines.append("}")
open("big.js", "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY
wc -l big.js
cd "$ROOT"

# 16: секреты в конфиге
mkdir -p 16-security && cd 16-security
cat > config.js <<'EOF'
export const config = {
  apiKey: "sk-live-9f3a1b7c4d2e8f6a0b5c9d1e3f7a2b4c",
  dbPassword: "SuperSecret123!",
  baseUrl: "https://api.example.com",
  timeout: 30000,
};
EOF
cd "$ROOT"

# 17: контрольный вопрос
mkdir -p 17-control-chat && cd 17-control-chat && echo "# вопрос" > q.md && cd "$ROOT"

# 18: тривиальное переименование
mkdir -p 18-control-trivial && cd 18-control-trivial
cat > tiny.js <<'EOF'
export function area(w, h) {
  const x = w * h;
  return x;
}
EOF
cd "$ROOT"

# 19: git-репозиторий с изменением
mkdir -p 19-git && cd 19-git
git init -q 2>/dev/null
printf 'export const a = 1;\n' > lib.js
git add lib.js 2>/dev/null
git -c user.email=bench@local -c user.name=bench commit -qm "init" 2>/dev/null
printf 'export const a = 1;\nexport const b = 2;\n' > lib.js
cd "$ROOT"

# 20: презентация
mkdir -p 20-presentation && cd 20-presentation
echo "# итоги квартала" > notes.md
cd "$ROOT"

echo "посадочные каталоги готовы:"
ls -d */ | tr '\n' ' '
echo
