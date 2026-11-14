# ER Diagram (`diagramType: "erd"`)

Use for a database schema: tables, their columns and keys, and the relationships between them (crow's-foot notation). Not for process flows (use `flowchart`) or messages over time (use `sequence`). Positions, box sizes, subject-area bands and the routes of the lines are computed by the tooling; author only the logical model.

**Example to copy (read it next; path is from `<skill-dir>`):** `references/examples/example-erd.json`.

## Schema

Never add coordinates or sizes (`x`, `y`, `w`, `h`, `box`, `points`, `layout`); `--layout` computes them. Array order is display order: tables in `entities` order within their area, columns in `columns` order, areas in `groups` order. A saved page embeds this JSON plus a trailing `layout` map of table positions (display-only; leave it out when you write). Every field marked optional can be left out.

```json
{
  "diagramType": "erd",
  "title": "Shop",
  "direction": "LR",
  "groups": [
    { "id": "sales", "name": "Sales", "color": "#e0f2fe" },
    { "id": "catalog", "name": "Catalog", "color": "#dcfce7" }
  ],
  "entities": [
    { "id": "customer", "name": "customer", "group": "sales",
      "columns": [
        { "name": "id", "type": "uuid", "pk": true },
        { "name": "email", "type": "text", "unique": true },
        { "name": "phone", "type": "text", "nullable": true }
      ] },
    { "id": "order", "name": "order", "group": "sales",
      "columns": [
        { "name": "id", "type": "uuid", "pk": true },
        { "name": "customer_id", "type": "uuid", "fk": true },
        { "name": "placed_at", "type": "timestamptz" }
      ] },
    { "id": "order_item", "name": "order_item", "group": "sales",
      "columns": [
        { "name": "order_id", "type": "uuid", "pk": true, "fk": true },
        { "name": "product_id", "type": "uuid", "pk": true, "fk": true },
        { "name": "qty", "type": "int", "note": "1 to 99" }
      ] },
    { "id": "product", "name": "product", "group": "catalog",
      "columns": [ { "name": "id", "type": "uuid", "pk": true }, { "name": "name", "type": "text" } ] }
  ],
  "relationships": [
    { "id": "r1", "from": "order", "to": "customer", "columns": ["customer_id"], "fromEnd": "zeroOrMany", "toEnd": "one", "label": "places" },
    { "id": "r2", "from": "order_item", "to": "order", "columns": ["order_id"], "fromEnd": "oneOrMany", "toEnd": "one", "identifying": true },
    { "id": "r3", "from": "order_item", "to": "product", "columns": ["product_id"], "fromEnd": "zeroOrMany", "toEnd": "one", "identifying": true }
  ],
  "notes": [
    { "id": "n1", "text": "Orders are never deleted; cancelled orders keep their items", "entities": ["order"] }
  ]
}
```

| Object | Field | Description |
|---|---|---|
| Diagram | `direction` | Optional. `LR` (default) or `TB`. Parent tables (the ones other tables point to) come first along the flow: left in `LR`, top in `TB`. If you leave it out, `--layout` tries both and keeps `TB` only when it makes the whole diagram fit the screen at a clearly bigger zoom. |
| Diagram | `detail` | Optional. `all` (default: every column), `keys` (only `pk` and `fk` columns, plus a "+ N more" row), `names` (table headers only). The page's **Columns** button cycles it. |
| Diagram | `showTypes` | Optional. `false` hides the type column. |
| Diagram | `showNotes` | Optional. `true` draws notes on the canvas instead of as badges. |
| Diagram | `colorKey` | Optional, only when you colour tables with `color` instead of using `groups`: `{ "#e0f2fe": "Billing" }`, what each colour means. |
| Group | `id`, `name`, `color` | A subject area, drawn as a coloured band behind its tables (like a swimlane). `color` is one of the flowchart's lane swatches, as the hex: `#e0f2fe` sky, `#fef3c7` amber, `#dcfce7` emerald, `#fee2e2` rose, `#f3e8ff` purple, `#ffedd5` orange, `#ccfbf1` teal, `#e0e7ff` indigo. Leave `color` out to take the next swatch in order. Array order is band order. With no `groups` there are no bands. |
| Entity | `id`, `name`, `group` | One table. `name` is shown as written, so keep the database's casing. `group` is a group id (a table with none goes in the first area). |
| Entity | `columns` | Array, shown in order. Each column: `name` (unique within the table), `type` (optional, free text shown as written), `pk`, `fk`, `unique`, `nullable` (optional booleans), `note` (optional: a tooltip, and a muted suffix at detail `all`). |
| Entity | `collapsed` | Optional. `true` draws the header only. Never author it unless the user asks for an overview. |
| Entity | `note` | Optional text. A table with no `pk` column is warned about unless this says why (for example `"append-only log"`). |
| Entity | `color` | Optional swatch hex, only without `groups` (with `groups`, the area sets the colour). Add `colorKey` when you use it. |
| Relationship | `id`, `from`, `to` | Entity ids. **`from` is the child: the table that holds the foreign key. `to` is the parent**, the table it points to. `from` equal to `to` is a self-reference (`columns` required). |
| Relationship | `columns` | The FK column names in `from`. The line leaves `from` at the first of those rows and enters `to` at its first `pk` row, so the reader sees which column joins which. Give it for every relationship. |
| Relationship | `toColumns` | Optional. The column names in `to` when the foreign key points at a unique column that is not the primary key. |
| Relationship | `fromEnd`, `toEnd` | Crow's-foot ends, one per end: `one`, `zeroOrOne`, `oneOrMany`, `zeroOrMany`. `fromEnd` is how many `from` rows relate to one `to` row; `toEnd` how many `to` rows relate to one `from` row. Defaults: `fromEnd` `zeroOrMany`, `toEnd` `one` (`zeroOrOne` when every FK column is `nullable`). |
| Relationship | `identifying` | Optional. `true` draws a solid line: the foreign key is part of the child's primary key. Missing or `false` draws a dashed line (non-identifying). |
| Relationship | `label` | Optional verb phrase (`places`, `ships to`), 20 characters at most, drawn at the middle of the line. |
| Note | `id`, `text`, `entities` | Attached to one or more table ids; drawn as a badge, or on the canvas with `showNotes`. 120 characters at most. |

The audit's budgets: table name 28 characters, column name 28, type 16, relationship label 20, note 120. Over a budget is a `[WARN]`: the page truncates the text.

## Writing rules

1. **Trace every table, every column the source lists and every foreign key.** Nothing is dropped: if the source is SQL DDL, each `CREATE TABLE` is an entity, each column a column (name and type as written), each `PRIMARY KEY` / `REFERENCES` / `FOREIGN KEY` a flag plus a relationship. Do not invent columns, tables or relationships the source does not have.
2. **`from` is the child.** The relationship goes from the table that holds the foreign key to the table it references: `order.customer_id` points at `customer`, so `"from": "order", "to": "customer"`. Reversed, the crow's feet land on the wrong table.
3. **Give `columns` for every relationship**, the FK column names in `from`, and mark each of them `"fk": true`. Without `columns` the line ends on the box edge and the reader cannot see which column joins. Composite keys list every column.
4. **Leave the ends at their defaults** (`zeroOrMany` at the child, `one` at the parent, `zeroOrOne` when the FK is `nullable`) and set `fromEnd` / `toEnd` only when the source says otherwise: a unique FK is `zeroOrOne` or `one` at `fromEnd` (one-to-one), a mandatory child is `oneOrMany`.
5. **Mark `identifying: true` when the FK is part of the child's primary key** (a junction or line-item table: every FK column is also `pk`). Everything else stays non-identifying, which draws dashed.
6. **Self-references** (`employee.manager_id` to `employee.id`) are one relationship with `from` equal to `to` and `columns`.
7. **Many-to-many goes through a junction table** when the source has one: it is its own entity with two relationships. Only draw a many-to-many directly (both ends `*OrMany`) for a conceptual model; the audit then prints an `[INFO]` suggesting a junction table.
8. **Use `groups` for subject areas** whenever the schema has more than about 8 tables: one area per bounded context (accounts, catalogue, billing, audit), named as the source names them, with each table in exactly one. At most 8 areas (one swatch each), and no more than 12 tables stacked in one column of an area.
9. **Set `"detail": "keys"` for more than about 15 tables**, or whenever a table has more than 25 columns: the page opens with only the key columns and a "+ N more" row, and the reader widens it with the **Columns** button. Keep every column in the JSON anyway; `detail` only changes what is drawn.
10. **Every rule, enum, default or caveat in the source is a `note`** on the table it concerns, or a column's `note` when it is about one column (`"1 to 99"`, `"new, paid, shipped"`). There are no index, view or trigger objects: put one in a note.
11. **Keep the database's names and casing** for `name` and column names; `id` values are short and lower case (`order_item`). Use the database's type text as written (`varchar(255)`, `timestamptz`) only if it fits 16 characters; otherwise shorten it and keep the full text in the column's `note`.
12. Never mark a table `collapsed` or leave a table out to save space; the page pans, zooms, collapses and switches detail by itself.

## Visual review checklist

The audit covers references, box overlap, routes through tables and label overlap; the layout report covers text overflow. Check by eye on the screenshot:

1. **Crow's feet** sit on the right ends: the many side (three prongs) at the child that holds the key, the single bar or the circle at the parent.
2. **Lines end at column rows**: each line starts at its FK row and enters at the parent's PK row, never on the header or a different column.
3. **Solid and dashed lines**: solid only where the FK is part of the child's primary key.
4. **Parents come first** along the flow, and tables that belong together sit in the same area band.
5. **Area bands** have readable names, and every table is inside the band it was given.
6. **Key glyphs and flags**: PK and FK icons on the right rows, `?` after a nullable type, a `U` chip on unique columns.
7. **Labels** are readable, short and not hiding a table or another label; lines do not run through tables.
8. **Text** in table names, column names and types is not cut off.

## Failure handling

- **Unknown references** (`from unknown entity`, `to unknown entity`, `is in unknown group`, `is attached to unknown entity`): fix the id in `from`, `to`, `group` or the note's `entities`.
- **`columns unknown column 'x' in 'table'`** (or `toColumns`): the name is not a column of that table; fix the spelling, or add the column.
- **`is a self-reference without 'columns'`**: name the FK column in `columns`.
- **`unknown fromEnd` / `unknown toEnd`**: use `one`, `zeroOrOne`, `oneOrMany` or `zeroOrMany`.
- **`Duplicate entity id` / `Duplicate column` / `Duplicate group id` / `Duplicate relationship id`**: ids are unique, and column names are unique within a table.
- **`unknown color`**: a group or table colour must be one of the lane swatch hex values listed above.
- **`Entities ... overlap`, `passes through entity`, `Labels ... overlap`, `sits over entity`, `route is not orthogonal`, `needs a horizontal stub`, `extends past the diagram edge`**: layout problems; re-run `--layout` (never edit positions or routes by hand). If it persists, shorten the label or split the area.
- **`Diagram is not laid out`**: run `--layout`.
- **`marked fk but no relationship uses it`** (warning): add the relationship, or drop `fk`.
- **`not marked fk`** (warning): add `"fk": true` to the column named in `columns`.
- **`has no primary key`** (warning): mark the `pk` column, or say why in the table's `note`.
- **`every column in 'columns' is a pk, so it is identifying`** (warning): add `"identifying": true`.
- **`columns at detail 'all'`** (warning): set `"detail": "keys"`.
- **`tables stack in one rank`** (warning): split the area into two.
- **`is over N characters and will be truncated`** (warning): shorten the name, type, label or note.
- **`[INFO] N line crossings` / `many-to-many drawn directly`**: not a failure. For crossings, reorder `entities` or split areas if the picture is hard to follow; for many-to-many, add a junction table if the schema is physical.
