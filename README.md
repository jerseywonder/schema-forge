# schema-forge

Infer a dataset schema and format the dataset based on that schema.

- Detects column types from sample data: Number, Boolean, Date, String
- Recognizes common date formats and returns strftime-style formats (e.g. `%Y-%m-%d`)
- Normalizes numeric fields: strips commas, currency symbols/codes, and `%`
- Optional behaviors via options (e.g., convert empty numeric values to `null`)
 - Flags String columns with repeated values (`repeating: true|false`)
 - Flags Number columns that are strictly sequential (`sequential: true|false`)
 - Heuristic year detection: 4‑digit integers in the range 1800–2100 are classified as Date with `format: "%Y"`

## Install

```bash
npm install @andyball/schema-forge
```

## Quick start

```js
const { getSchema, dataFormat } = require('@andyball/schema-forge');

const rows = [
  { name: 'Alice', age: '32', revenue: '$2,345.50', when: '2024-10-01' },
  { name: 'Bob',   age: '23', revenue: '$1,100',     when: '01/10/2024' }
];

console.log(getSchema(rows));
console.log(dataFormat(rows));

// With options
console.log(dataFormat(rows, { numberEmptyAsNull: true }));
```

### Importing

CommonJS (require):

```js
const { getSchema, dataFormat } = require('@andyball/schema-forge');
// or
const forge = require('@andyball/schema-forge');
forge.getSchema(...);
```

ESM (import):

```js
// After v0.1.1+ you can use named ESM imports
import { getSchema, dataFormat } from '@andyball/schema-forge';
// or default
import forge from '@andyball/schema-forge';
```

## API

### getSchema(data, options?)

- **data**: `Array<object>` or JSON string
- **options**:
  - **preferStringNumbers**: `boolean` (default: `false`)
    - If `true`, numeric-looking strings remain as String unless all values are numeric

Returns an array of column descriptors:

```json
[
  { "name": "name", "type": "String", "format": null, "repeating": true },
  { "name": "age", "type": "Number", "format": "Integer", "sequential": false },
  { "name": "revenue", "type": "Number", "format": "Currency", "sequential": false },
  { "name": "year", "type": "Date", "format": "%Y", "sequential": true },
  { "name": "active", "type": "Boolean", "format": "Boolean" },
  { "name": "when", "type": "Date", "format": "%Y-%m-%d" }
]
```

Notes on detection:
- Numbers: handles `1,234.56`, `$2,000`, `12%`, `1234 USD`; outputs format `Integer`, `Float`, `Currency`, or `Percentage`.
- Numbers also include `sequential`: true when successive numeric values increase by 1 (requires at least 2 numbers; non-numeric/empty values are ignored for the check).
- Year heuristic: when a Number column consists only of 4‑digit integers all within 1800–2100 (and not currency/percentage/float), it is upgraded to `type: "Date"` with `format: "%Y"` and retains the `sequential` flag.
- Booleans: `true`/`false` (case-insensitive) recognized.
- Dates: recognizes ISO and common regional formats; returns strftime format (e.g., `%d/%m/%Y`, `%H:%M:%S`). Mixed formats → `format: "mixed"`.
- Strings: URLs, emails, IP addresses, phone numbers, colors, and data URIs get subformats; others default to `null` format. String descriptors also include `repeating`: true if any non-empty value repeats within the column.

### dataFormat(data, options?)

- **data**: `Array<object>`
- **options**:
  - **preferStringNumbers**: `boolean` (default: `false`) – passed through to `getSchema`
  - **numberEmptyAsNull**: `boolean` (default: `true`) – empty numeric values become `null`

Returns a new array of formatted rows. Current conversions:
- Number columns: strings like `"1,234.56"`, `"$2,000"`, `"12%"` → numbers
- Boolean columns: `"true"`/`"false"` → booleans
- Date and String columns: left as-is (format metadata is in schema)

Example:

```js
const rows = [
  { revenue: "$2,345,000.50", pct: "12%", active: "true", when: "31/12/2020" },
  { revenue: "$100", pct: "", active: "false", when: "2020-12-30" }
];

console.log(getSchema(rows));
console.log(dataFormat(rows));
```

## CLI-like local test

Run the built-in example:

```bash
npm run example
```

## Development

Install dev deps and build:

```bash
npm i -D typescript
npm run build
```

Run a quick test (after build):

```bash
npm test
```

## Publish

1. Update `package.json` fields (`name`, `description`, `author`, `keywords`).
2. Login: `npm login`
3. Publish: `npm publish --access public`


