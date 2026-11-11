# Updating a diagram

Applies to every diagram type.

## Updating an existing diagram

Use when the user saved edits in the browser, or asks to change a diagram that already exists.

1. Extract the current state (no manual HTML parsing):
   ```shell
   python "<skill-dir>/scripts/layout_engine.py" --extract <target.html> -o <current.json>
   ```
2. Edit the JSON and re-run the layout, audit and render steps, writing to the same `<target.html>`.
3. **Know what a re-layout resets.** `--layout` recomputes every node's position and the container sizes (lane heights for flowcharts), so positions the user dragged by hand are lost. Structure the user cares about (lane order, lane membership, labels, flags such as `feedback`) is kept. Tell the user before overwriting, and write to a new file name if they might want the old arrangement.
4. If the task is only to read the user's edits (e.g. to update user stories or specs), stop after step 1 and use the extracted JSON; do not re-layout.
