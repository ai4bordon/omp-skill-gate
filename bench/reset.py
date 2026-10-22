"""Сброс стенда: сохраняет артефакты прохода в pass<N>/ и чистит посадочные каталоги.

Сам каталог не удаляем: на Windows его может держать другой процесс,
поэтому вычищаем только содержимое.
"""
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def wipe(path: Path) -> list[str]:
    """Удаляет всё внутри каталога. Возвращает список того, что не удалось снять."""
    stuck: list[str] = []
    for child in list(path.iterdir()):
        for attempt in range(3):
            try:
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
                break
            except OSError:
                if attempt == 2:
                    stuck.append(child.name)
                else:
                    time.sleep(0.5)
    return stuck


def main() -> None:
    tag = sys.argv[1] if len(sys.argv) > 1 else "pass1"
    dest = ROOT / tag
    dest.mkdir(exist_ok=True)

    for d in sorted(p for p in ROOT.iterdir() if p.is_dir() and p.name[:2].isdigit()):
        target = dest / d.name
        if target.exists():
            try:
                shutil.rmtree(target)
            except OSError:
                # в pass2/19-git/.git файлы могут быть заняты: чистим, что можем
                for sub in sorted(target.rglob("*"), reverse=True):
                    try:
                        sub.unlink() if sub.is_file() else sub.rmdir()
                    except OSError:
                        pass
        shutil.copytree(d, target, dirs_exist_ok=True)
        stuck = wipe(d)
        note = f" (занято: {', '.join(stuck)})" if stuck else ""
        print(f"сохранён и очищен: {d.name}{note}")

    subprocess.run([sys.executable, str(ROOT / "seed.py")], check=True, cwd=str(ROOT))

    git = ROOT / "19-git"
    subprocess.run(["git", "init", "-q"], cwd=str(git), check=False)
    subprocess.run(["git", "add", "lib.js"], cwd=str(git), check=False)
    subprocess.run(
        ["git", "-c", "user.email=bench@local", "-c", "user.name=bench", "commit", "-qm", "init"],
        cwd=str(git),
        check=False,
    )
    (git / "lib.js").write_text("export const a = 1;\nexport const b = 2;\n", encoding="utf-8")
    print("стенд сброшен, артефакты в", dest)


if __name__ == "__main__":
    main()
