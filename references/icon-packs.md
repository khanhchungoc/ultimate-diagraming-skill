# Icon packs (tech and brand logos)

## Bundled tech logos (`devicon`)

A curated **Devicon** pack (MIT license, 69 tech/cloud/database/language/framework logos) ships with the skill in `assets/logos/devicon.json` (with `assets/logos/devicon-LICENSE.txt`).

Use entries directly in C4 diagrams as `"icon": "logo:devicon/<name>"` (for example `logo:devicon/postgresql`, `logo:devicon/kubernetes`, `logo:devicon/react`, `logo:devicon/aws`). They are also listed under **Tech logos** in the C4 icon picker.

## Local icon packs (custom brand and cloud logos)

For vendor packs whose terms do not allow bundling (such as full AWS or Azure icon archives), build a local pack from the vendor's own download on your machine:

## Build

```
python3 scripts/build_icon_pack.py <folder-or-zip-of-svgs> --name aws [--out icons]
```

- Each SVG keeps its `viewBox` and inner markup. Scripts, event attributes, `<image>`, `<style>` and references outside the file are removed or refused (a clear error names the file).
- The entry name is the file name, lowercase, with hyphens (`Amazon S3.svg` gives `amazon-s3`).
- Any file whose name contains LICENSE, TERMS or NOTICE is copied next to the pack as `<pack>-<file>`. Keep it there.
- Nothing is fetched. The same input gives the same bytes.

## Format

`icons/<pack>.json`:

```json
{"_license": "aws-TERMS.txt", "_source": "aws-icons.zip",
 "icons": {"s3": {"vb": "0 0 64 64", "body": "<path d=\"...\" fill=\"#3f8624\"/>"}}}
```

## Use

In the diagram: `"icon": "logo:aws/s3"`.

The page build looks for `icons/<pack>.json` in the folder given with `--icons <dir>` of `scripts/layout_engine.py`; without it, in `icons/` next to the diagram file, then in `./icons`.

Only the entries the diagram uses are embedded in the page, so the file stays standalone and Save keeps them. The logo is drawn on a white disc in its own colours and aspect ratio (vendor terms forbid recolouring and distortion).

## Missing

- Pack not installed: the audit prints a `[WARN]` per element; the element shows the generic icon of its kind.
- Pack installed, entry absent: one `[WARN]` naming the pack and entry; same fallback.
