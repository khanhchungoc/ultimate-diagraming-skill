# Ask your AI about a diagram

Hand any diagram file to an AI assistant and ask "summarize this flow" or "who approves the refund?".

The diagram is stored as a short block of data (JSON, inside an element with the id `diagram-data`) at the top of the file, and the file's second line tells the assistant exactly which lines to read, so it skips the editor code below. With this skill installed, the assistant pulls out just that data in one step:

```shell
python scripts/layout_engine.py --extract <diagram.html>
```

## For developers

- The data is plain text, so diagrams can live in git and be reviewed. The format is defined in `scripts/disk_format.py`.
- Layout is done by `scripts/layout_engine.py` (`--layout`, `--verify`, `--extract`).
- Architecture and checks: [dev/architecture.md](../dev/architecture.md).
