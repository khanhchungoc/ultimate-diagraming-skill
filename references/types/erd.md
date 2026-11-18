# ER Diagram (Mermaid `erDiagram`)

Use for a database schema: tables, their columns and keys, and the relationships between them (crow's-foot notation). Not for process flows (use `flowchart`) or messages over time (use `sequence`). Positions, box sizes and the curves of the lines are computed by the tooling; author only the logical model, as Mermaid, and colour the tables by domain (see Colour).

## Mermaid

This is a complete diagram; no other file to read. Standard Mermaid `erDiagram` syntax, plus the conventions below.

```mermaid
---
title: Shop
---
erDiagram
  %% @colorKey 1 Sales
  %% @colorKey 3 Catalog
  customer {
    uuid id PK
    text email UK
    text? phone
  }
  order {
    uuid id PK
    uuid customer_id FK
    timestamptz placed_at
  }
  order_item {
    uuid order_id PK, FK
    uuid product_id PK, FK
    int qty "1 to 99"
  }
  product {
    uuid id PK
    text name
  }
  customer ||..o{ order : "places"
  order ||--|{ order_item : ""
  product ||--o{ order_item : ""
  class customer,order,order_item c1
  class product c3
  %% @note order: Orders are never deleted, cancelled orders keep their items
```

Conventions beyond standard Mermaid:

- **Relationships**: write the parent on the left and the child (the table that holds the foreign key) on the right. The marker next to a table says how many of its rows relate to one row of the other: `||` exactly one, `|o` or `o|` zero or one, `}|` or `|{` one or many, `}o` or `o{` zero or many. The many side is the child; in a one-to-one the right-hand table is the child. An ordinary foreign key is `||..o{`; a nullable one is `|o..o{`.
- **Line style**: `..` for an ordinary foreign key, `--` only for an identifying relationship (every FK column is also part of the child's primary key: junction, weak-entity and subtype tables).
- **Label**: `: "places"` (3 words at most); write `: ""` when there is none (Mermaid requires one).
- **Join columns** are found from the child's column names (`<parent>_id`, `<parent name>_id`, `<role>_<parent>_id`, `<role>_id` for a self-reference). When the FK column is named otherwise, or points at a unique column that is not the primary key, add it at the end of the label: `: "ships to [shipping_address_id]"`, composite `[a, b]`, to a unique column `[customer_email -> email]`.
- **Columns**: `type name KEYS "note"`, with keys `PK`, `FK`, `UK` (`PK, FK` together). Write a type with spaces as `double-precision`, `character-varying(255)` (`-` for each space). Append `?` for a nullable column (`text? phone`). A column with no type is `_ name`. The trailing `"..."` is an inline note on the column (a rule, enum or range).
- **Notes**: `%% @note order: text` on a table, `%% @note a,b: text` on several tables, `%% @note order.status: text` on a column. At most 120 characters.
- **Colour**: `class a,b c1` or `a:::c1` (slot `c1` to `c8`) and `%% @colorKey 1 Billing` to name each slot (shown as a legend). Write a `colorKey` whenever you colour.
- **Display**: `%% @detail keys` (only key columns plus a "+ N more" row) or `%% @detail names` (headers only); `%% @showTypes false` hides types; `%% @showNotes` draws notes on the canvas instead of as badges.
- **Text**: write `;` as `#59;` and `#` as `#35;` in notes and labels. `direction` is ignored.

## Writing rules

Trace prose requirements in two passes before writing (for SQL DDL or a complete schema, go straight to rule 1):
- **Conceptual pass (internal):** identify the core entities, domain groupings (`colorKey`), business-rule cardinalities and many-to-many relationships.
- **Logical/physical pass (the Mermaid):** resolve many-to-many relationships into junction tables, assign primary keys, foreign keys, nullable columns and identifying lines, and record any inferred columns or keys in the report.
- **Conceptual-only pause:** produce a conceptual view (`%% @detail names`, `%% @showTypes false`, direct many-to-many allowed) and ask for confirmation **only** when the user asks for a conceptual ERD or to review entities first, or when core scope is missing or contradictory.

1. **Trace every table, every column the source lists and every foreign key.** Nothing is dropped: if the source is SQL DDL, each `CREATE TABLE` is a table, each column a column (name and type as written), each `PRIMARY KEY` / `REFERENCES` / `FOREIGN KEY` a flag plus a relationship. Do not invent columns, tables or relationships the source does not have.
2. **The child holds the foreign key.** `order.customer_id` points at `customer`, so `customer ||..o{ order`. Reversed, the crow's feet land on the wrong table.
3. **Every relationship needs its join columns** (derived, or `[col]` in the label, see above). Without them the line ends on the box edge and the reader cannot see which column joins; `--layout` then prints a `[WARN]`. Add a short verb label whenever two tables share more than one relationship (`billing_address_id` vs `shipping_address_id`) or when the role is not obvious from the FK name.
4. **Map business-rule phrasing to markers.** Start from `||..o{` and change the markers when the rules state otherwise: *"must have at least one"* → `|{` at the child, *"may have zero or more"* → `o{`, *"must have exactly one"* → `||` at the parent (non-null FK), *"may have at most one"* → `|o` at the parent (nullable FK) or `o|` at the child (unique FK, i.e. 1:1).
5. **Identifying (`--`) when the FK is part of the child's primary key** (a junction, weak-entity or subtype table). Represent subtype/supertype inheritance either as separate child tables whose primary key is also the FK to the supertype (`--`, `o|` at the child), or as a single table with nullable subtype columns and a `%% @note` explaining the discriminator. Everything else is `..`.
6. **Self-references** (`employee.manager_id` to `employee.id`) are one relationship from the table to itself: `employee ||..o{ employee : "manager"`; the label names the role (`manager_id`) or add `[manager_id]`.
7. **Resolve many-to-many relationships through a junction table** whenever designing a logical or physical schema (especially when the relationship carries attributes such as `qty`, `role` or a timestamp): it is its own table with two relationships. Only draw a many-to-many directly (both ends many) for a conceptual model; the audit then prints an `[INFO]` suggesting a junction table.
8. **Colour tables by domain** whenever the schema has more than about 8 tables; see Colour.
9. **Leave `%% @detail` out**: `--layout` opens a schema of more than 15 tables, or with a table of more than 25 columns, at `keys` and prints `[INFO] Detail: keys`. Keep every column in the Mermaid anyway.
10. **Every table-level rule, index, view, trigger or caveat in the source is a `%% @note`** on the table it concerns, and every column-level rule, enum or range is the inline `"..."` note on the column itself (`"1 to 99"`, `"new, paid, shipped"`). A table with no primary key gets a `%% @note` saying why.
11. **Keep the database's names and casing** for table and column names (use singular snake_case such as `customer`, `order_item` when deriving from prose); table ids are short and lower case. Use the database's type text as written (`varchar(255)`, `timestamptz`).
12. Never mark a table collapsed or leave a table out to save space; the page pans, zooms, collapses and switches detail by itself.

## Colour

Colour is what shows the reader which tables belong together; there are no boxes around tables. For a schema of more than about 8 tables:

1. Group the tables by domain, judged from the table names and the foreign keys (accounts, catalogue, billing, audit), using the source's own words for the domains when it has them.
2. Give each domain one slot from `c1` to `c8` (at most 8 domains), put every table of the domain in it with a `class` line, and name each in `%% @colorKey`.
3. Leave isolated utility tables (a settings table, a migrations table, a table no foreign key touches) neutral.

The layout counts same-coloured tables as slightly closer, so a domain tends to form a cluster. The audit warns when a schema has more than 8 tables and none has a colour.
