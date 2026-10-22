"""Прогоняет промпты стенда через omp -p --advisor, потоком в файл (без буфера в памяти)."""
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(r"C:/Users/Kerry/tmp/skillbench")
OMP = r"C:\Users\Kerry\.bun\bin\omp.exe"
RESULTS = ROOT / "results"
TIMEOUT = 1200
WORKERS = 5


def load_prompts() -> list[tuple[str, str, str]]:
    rows = []
    for line in (ROOT / "prompts.tsv").read_text(encoding="utf-8").splitlines()[1:]:
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) >= 3:
            rows.append((parts[0], parts[1], parts[2]))
    return rows


def run_one(item: tuple[str, str, str]) -> tuple[str, int, float]:
    pid, _expect, prompt = item
    work = ROOT / pid
    work.mkdir(parents=True, exist_ok=True)
    out_path = RESULTS / f"{pid}.json"
    err_path = RESULTS / f"{pid}.err"
    started = time.time()
    # stdout идёт прямо в файл: длинные прогоны не держим в памяти
    with out_path.open("wb") as out, err_path.open("wb") as err:
        proc = subprocess.Popen(
            [OMP, "-p", "--advisor", prompt, "--mode", "json"],
            cwd=str(work),
            stdout=out,
            stderr=err,
        )
        try:
            code = proc.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            code = -1
    (RESULTS / f"{pid}.exit").write_text(str(code), encoding="utf-8")
    return pid, code, time.time() - started


def main() -> None:
    RESULTS.mkdir(exist_ok=True)
    prompts = load_prompts()
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    if only:
        prompts = [p for p in prompts if p[0] in only]
    print(f"промптов: {len(prompts)}, потоков: {WORKERS}", flush=True)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(run_one, p): p[0] for p in prompts}
        for fut in as_completed(futures):
            pid, code, secs = fut.result()
            print(f"  {pid:20} exit={code:12} {secs:7.1f}s", flush=True)
    print("готово", flush=True)


if __name__ == "__main__":
    main()
