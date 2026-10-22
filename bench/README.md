# Стенд skill-gate

20 промптов: 18 доменов + 2 контрольных. Запуск живых прогонов omp с гейтом и Советником.

```
python seed.py     # фикстуры в каталоги прогонов
python run.py      # 20 прогонов omp -p --advisor --mode json, параллельно 5
python parse.py results   # таблица + summary
```

Промпты и ожидаемые скиллы: `prompts.tsv`. Сводки трёх проходов с машины автора:
`results/pass{1,2,3}-summary.json`. Детали методики и находок: `../docs/bench.md`.
