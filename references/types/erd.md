# ER Diagram (`diagramType: "erd"`)

Use for a database schema: tables, their columns and keys, and the relationships between them (crow's-foot notation). Not for process flows (use `flowchart`) or messages over time (use `sequence`). Positions, box sizes and the curves of the lines are computed by the tooling; author only the logical model, and colour the tables by domain (see Colour).

**Example to copy (read it next; path is from `<skill-dir>`):** `references/examples/example-erd.json`.

## Schema

Never add coordinates or sizes (`x`, `y`, `w`, `h`, `box`, `points`, `layout`); `--layout` computes them. Array order is display order: tables in `entities` order, columns in `columns` order. Order only breaks ties: the layout spreads the tables like a graph, with the most connected tables in the middle and their neighbours around them. A saved page embeds this JSON with `schemaVersion` 3 and a trailing `layout` map of absolute table positions (display-only; leave it and `schemaVersion` out when you write). A page saved in the older format (`schemaVersion` 2 or 1, with `groups`) still opens: each group's colour becomes the `color` of its tables, the group names become `colorKey`, and the diagram is laid out again. Every field marked optional can be left out.

```json
{
  "diagramType": "erd",
  "title": "Shop",
  "colorKey": { "1": "Sales", "3": "Catalog" },
  "entities": [
    { "id": "customer", "name": "customer", "color": "1",
      "columns": [
        { "name": "id", "type": "uuid", "pk": true },
        { "name": "email", "type": "text", "unique": true },
        { "name": "phone", "type": "text", "nullable": true }
      ] },
    { "id": "order", "name": "order", "color": "1",
      "columns": [
        { "name": "id", "type": "uuid", "pk": true },
        { "name": "customer_id", "type": "uuid", "fk": true },
        { "name": "placed_at", "type": "timestamptz" }
      ] },
    { "id": "order_item", "name": "order_item", "color": "1",
      "columns": [
        { "name": "order_id", "type": "uuid", "pk": true, "fk": true },
        { "name": "product_id", "type": "uuid", "pk": true, "fk": true },
        { "name": "qty", "type": "int" }
      ] },
    { "id": "product", "name": "product", "color": "3",
      "columns": [ { "name": "id", "type": "uuid", "pk": true }, { "name": "name", "type": "text" } ] }
  ],
  "relationships": [
    { "id": "r1", "from": "order", "to": "customer", "columns": ["customer_id"], "fromEnd": "zeroOrMany", "toEnd": "one", "label": "places" },
    { "id": "r2", "from": "order_item", "to": "order", "columns": ["order_id"], "fromEnd": "oneOrMany", "toEnd": "one", "identifying": true },
    { "id": "r3", "from": "order_item", "to": "product", "columns": ["product_id"], "fromEnd": "zeroOrMany", "toEnd": "one", "identifying": true }
  ],
  "notes": [
    { "id": "n1", "text": "Orders are never deleted; cancelled orders keep their items", "entities": ["order"] },
    { "id": "n2", "text": "1 to 99", "entities": ["order_item"], "column": "qty" }
  ]
}
```

| Object | Field | Description |
|---|---|---|
| Diagram | `detail` | Optional. `all` (default: every column), `keys` (only `pk` and `fk` columns, plus a "+ N more" row), `names` (table headers only). The page's **Columns** button cycles it. |
| Diagram | `showTypes` | Optional. `false` hides the type column. |
| Diagram | `showNotes` | Optional. `true` draws notes on the canvas instead of as badges. |
| Diagram | `colorKey` | Optional. `{ "1": "Billing" }`: the domain each table colour stands for, shown as a legend. Write it whenever you use `color`. |
| Entity | `id`, `name` | One table. `name` is shown as written, so keep the database's casing. |
| Entity | `columns` | Array, shown in order. Each column: `name` (unique within the table), `type` (optional, free text shown as written), `pk`, `fk`, `unique`, `nullable` (optional booleans). A column's note is a Note with `column`, not a field here: an inline column `note` from older pages still opens, and the page turns it into such a note on load. |
| Entity | `collapsed` | Optional. `true` draws the header only. Never author it unless the user asks for an overview. |
| Entity | `note` | Optional text. A table with no `pk` column is warned about unless this says why (for example `"append-only log"`). |
| Entity | `color` | Optional. A palette slot, `"1"` to `"8"`: the theme's palette, so a slot names no fixed colour. Tints the table header. Leave it out for a neutral table. Name each colour in `colorKey`. |
| Relationship | `id`, `from`, `to` | Entity ids. **`from` is the child: the table that holds the foreign key. `to` is the parent**, the table it points to. `from` equal to `to` is a self-reference (`columns` required). |
| Relationship | `columns` | The FK column names in `from`. Lines attach to the side of the table that faces the other table, not to a row; hovering a table highlights its related tables and, in each, the foreign key and key rows involved, which is how the reader sees which column joins which. Give it for every relationship. |
| Relationship | `toColumns` | Optional. The column names in `to` when the foreign key points at a unique column that is not the primary key. |
| Relationship | `fromEnd`, `toEnd` | Crow's-foot ends, one per end: `one`, `zeroOrOne`, `oneOrMany`, `zeroOrMany`. `fromEnd` is how many `from` rows relate to one `to` row; `toEnd` how many `to` rows relate to one `from` row. Defaults: `fromEnd` `zeroOrMany`, `toEnd` `one` (`zeroOrOne` when every FK column is `nullable`). |
| Relationship | `identifying` | Optional. `true` draws a solid line: the foreign key is part of the child's primary key. Missing or `false` draws a dashed line (non-identifying). |
| Relationship | `label` | Optional verb phrase (`places`, `ships to`), 20 characters at most, drawn at the middle of the curve. |
| Note | `id`, `text`, `entities` | Attached to one or more table ids; drawn as a badge, or on the canvas with `showNotes`. 120 characters at most. |
| Note | `column` | Optional. A column name of the note's first table: the note is that column's (its badge sits in the column's row), for example the allowed values of a status. |

The audit's budgets: table name 28 characters, column name 28, type 16, relationship label 20, note 120. Over a budget is a `[WARN]`: the page truncates the text.

## Writing rules

1. **Trace every table, every column the source lists and every foreign key.** Nothing is dropped: if the source is SQL DDL, each `CREATE TABLE` is an entity, each column a column (name and type as written), each `PRIMARY KEY` / `REFERENCES` / `FOREIGN KEY` a flag plus a relationship. Do not invent columns, tables or relationships the source does not have.
2. **`from` is the child.** The relationship goes from the table that holds the foreign key to the table it references: `order.customer_id` points at `customer`, so `"from": "order", "to": "customer"`. Reversed, the crow's feet land on the wrong table.
3. **Give `columns` for every relationship**, the FK column names in `from`, and mark each of them `"fk": true`. Without `columns` the line ends on the box edge and the reader cannot see which column joins. Composite keys list every column.
4. **Leave the ends at their defaults** (`zeroOrMany` at the child, `one` at the parent, `zeroOrOne` when the FK is `nullable`) and set `fromEnd` / `toEnd` only when the source says otherwise: a unique FK is `zeroOrOne` or `one` at `fromEnd` (one-to-one), a mandatory child is `oneOrMany`.
5. **Mark `identifying: true` when the FK is part of the child's primary key** (a junction or line-item table: every FK column is also `pk`). Everything else stays non-identifying, which draws dashed.
6. **Self-references** (`employee.manager_id` to `employee.id`) are one relationship with `from` equal to `to` and `columns`.
7. **Many-to-many goes through a junction table** when the source has one: it is its own entity with two relationships. Only draw a many-to-many directly (both ends `*OrMany`) for a conceptual model; the audit then prints an `[INFO]` suggesting a junction table.
8. **Colour tables by domain** whenever the schema has more than about 8 tables; see Colour below.
9. **Set `"detail": "keys"` for more than about 15 tables**, or whenever a table has more than 25 columns: the page opens with only the key columns and a "+ N more" row, and the reader widens it with the **Columns** button. Keep every column in the JSON anyway; `detail` only changes what is drawn.
10. **Every rule, enum, default or caveat in the source is a `note`** on the table it concerns, or a note with `column` when it is about one column (`"1 to 99"`, `"new, paid, shipped"`). There are no index, view or trigger objects: put one in a note.
11. **Keep the database's names and casing** for `name` and column names; `id` values are short and lower case (`order_item`). Use the database's type text as written (`varchar(255)`, `timestamptz`) only if it fits 16 characters; otherwise shorten it and keep the full text in a note with `column`.
12. Never mark a table `collapsed` or leave a table out to save space; the page pans, zooms, collapses and switches detail by itself.

## Colour

Colour is what shows the reader which tables belong together; there are no boxes around tables. For a schema of more than about 8 tables:

1. Group the tables by domain, judged from the table names and the foreign keys (accounts, catalogue, billing, audit), using the source's own words for the domains when it has them.
2. Give each domain one slot from `"1"` to `"8"` and set `color` on every table of that domain. At most 8 domains.
3. Write a `colorKey` naming each domain: `{ "1": "Accounts", "2": "Billing" }`.
4. Leave isolated utility tables (a settings table, a migrations table, a table no foreign key touches) neutral: no `color`.

The layout counts same-coloured tables as slightly closer, so a domain tends to form a cluster. The audit warns when a schema has more than 8 tables and none has a colour.

## Visual review checklist

The audit covers references, box overlap, curves through tables and label overlap; the layout report covers text overflow. Check by eye on the screenshot:

1. **Crow's feet** sit on the right ends: the many side (three prongs) at the child that holds the key, the single bar or the circle at the parent.
2. **Lines attach to the sides** of the tables, as smooth curves that leave each side at a right angle; hovering a table highlights the matching FK and key rows.
3. **Solid and dashed lines**: solid only where the FK is part of the child's primary key.
4. **Hub tables** (the most referenced) sit in the middle, with the tables that reference them around them on several sides.
5. **Colours** match the domains, the legend names each one, and isolated tables are neutral.
6. **Key glyphs and flags**: PK and FK icons on the right rows, `?` after a nullable type, a `U` chip on unique columns.
7. **Labels** are readable, short and not hiding a table or another label; curves do not run through tables.
8. **Text** in table names, column names and types is not cut off.

## Failure handling

- **Unknown references** (`from unknown entity`, `to unknown entity`, `is attached to unknown entity`, `names unknown column`): fix the id in `from`, `to` or the note's `entities`, or the note's `column`.
- **`columns unknown column 'x' in 'table'`** (or `toColumns`): the name is not a column of that table; fix the spelling, or add the column.
- **`is a self-reference without 'columns'`**: name the FK column in `columns`.
- **`unknown fromEnd` / `unknown toEnd`**: use `one`, `zeroOrOne`, `oneOrMany` or `zeroOrMany`.
- **`Duplicate entity id` / `Duplicate column` / `Duplicate relationship id`**: ids are unique, and column names are unique within a table.
- **`unknown color`**: a table colour must be a palette slot, `"1"` to `"8"`. (A custom hex still loads, drawn as is, and the audit warns that its contrast is not checked; do not write one.)
- **`Entities ... overlap`, `passes through entity`, `Labels ... overlap`, `sits over entity`, `extends past the diagram edge`**: layout problems; re-run `--layout` (never edit positions or curves by hand). If it persists, shorten the label.
- **One `passes through entity` on a schema of more than 10 tables**: expected now and then. The layout uses a lighter search above 10 tables to stay fast, so re-running gives the same result. Accept it, or reorder `entities`, or split the schema by domain.
- **`N tables and none has a 'color'`** (warning): colour the tables by domain, see Colour.
- **`Diagram is not laid out`**: run `--layout`.
- **`marked fk but no relationship uses it`** (warning): add the relationship, or drop `fk`.
- **`not marked fk`** (warning): add `"fk": true` to the column named in `columns`.
- **`has no primary key`** (warning): mark the `pk` column, or say why in the table's `note`.
- **`every column in 'columns' is a pk, so it is identifying`** (warning): add `"identifying": true`.
- **`columns at detail 'all'`** (warning): set `"detail": "keys"`.
- **`is over N characters and will be truncated`** (warning): shorten the name, type, label or note.
- **`[INFO] N line crossings` / `many-to-many drawn directly`**: not a failure. For crossings, reorder `entities` if the picture is hard to follow; for many-to-many, add a junction table if the schema is physical.
