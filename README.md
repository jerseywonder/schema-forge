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
const { getSchema, toJSONSchema, dataFormat } = require('@andyball/schema-forge');

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
const { getSchema, toJSONSchema, dataFormat } = require('@andyball/schema-forge');
// or
const forge = require('@andyball/schema-forge');
forge.getSchema(...);
```

ESM (import):

```js
// After v0.1.1+ you can use named ESM imports
import { getSchema, toJSONSchema, dataFormat } from '@andyball/schema-forge';
// or default
import forge from '@andyball/schema-forge';
```

## API

### getSchema(data, options?)

- **data**: `Array<object>` or JSON string
- **options**:
  - **preferStringNumbers**: `boolean` (default: `false`)
    - If `true`, numeric-looking strings remain as String unless all values are numeric
  - **sanitizeKeys**: `boolean` (default: `false`)
    - If `true`, column names are sanitized: Unicode formatting/invisible/control chars removed, whitespace collapsed, NFC normalized, and deduped; original preserved on each column as `sourceName`.
  - **useNullMarkersForInference**: `boolean` (default: `false`)
    - If `true`, values matched by null markers/sentinels are skipped during inference. They are excluded from completeness, distinct/topK, and type/format tallies so they don't skew detection. Full null normalization still occurs in `dataFormat` based on inferred types.

Returns an array of column descriptors (abbreviated example):

```json
[
  {
    "name": "name",
    "type": "String",
    "format": "mixed",
    "repeating": true,
    "score": 0.72,
    "probably": "Text",
    "tally": { "Text": 180, "URL": 20 },
    "completeness": 1,
    "distinctCount": 160,
    "cardinality": 0.8889,
    "topK": [["Alice", 10], ["Bob", 8]],
    "uniquenessRatio": 0.8,
    "isUnique": false,
    "isPrimaryKey": false
  },
  {
    "name": "revenue",
    "type": "Number",
    "format": "Currency",
    "sequential": false,
    "numStats": { "min": 100, "max": 2345.5, "mean": 1234.2, "stdev": 345.1 },
    "score": 0.9,
    "probably": "Currency",
    "tally": { "Currency": 90, "Float": 10 },
    "completeness": 0.98,
    "distinctCount": 95,
    "cardinality": 0.9694,
    "topK": [["$100", 5], ["$200", 4]],
    "uniquenessRatio": 0.94,
    "isUnique": false,
    "isPrimaryKey": false
  },
  {
    "name": "year",
    "type": "Date",
    "format": "%Y",
    "sequential": true,
    "score": 1,
    "tally": { "%Y": 100 },
    "completeness": 1,
    "distinctCount": 10,
    "cardinality": 0.1,
    "topK": [["2020", 12], ["2021", 11]],
    "uniquenessRatio": 0.1,
    "isUnique": false,
    "isPrimaryKey": false
  }
]
```

Notes on detection:
- Numbers: handles `1,234.56`, `$2,000`, `12%`, `1234 USD`; outputs format `Integer`, `Float`, `Currency`, or `Percentage`.
- Numbers also include `sequential`: true when successive numeric values increase by 1 (requires at least 2 numbers; non-numeric/empty values are ignored for the check).
- Year heuristic: when a Number column consists only of 4‑digit integers all within 1800–2100 (and not currency/percentage/float), it is upgraded to `type: "Date"` with `format: "%Y"` and retains the `sequential` flag.
- Booleans: `true`/`false` (case-insensitive) recognized.
- Dates: recognizes ISO and common regional formats; returns strftime format (e.g., `%d/%m/%Y`, `%H:%M:%S`). Mixed formats → `format: "mixed"`.
- Strings: URLs, emails, IP addresses, phone numbers, colors, and data URIs get subformats; others default to `null` format. String descriptors also include `repeating`: true if any non-empty value repeats within the column.

Scoring, probability and tally:
- **tally**: counts per detected format in the column (e.g., `{ Text: 120, Percentage: 30 }`).
- **score**: the dominance of the most frequent format, computed as `max(tally.values) / sum(tally.values)`.
- **probably**: the label of the most frequent format from `tally`.
  - For String columns where the top label is `Text`, extra hints apply:
    - If values repeat: becomes `Categories` (or `Categories: a, b, c` when the unique set is small), or `Zero-variance column` if only one unique value.
    - If comma/semicolon/pipe-delimited lists dominate: `List`.
    - If `Percentage` dominates overall, `Percentage`.

Column metrics:
- **completeness**: fraction of non-empty values (`nonEmptyCount / totalRows`).
- **distinctCount**: number of unique non-empty values (normalised as strings).
- **cardinality**: `distinctCount / nonEmptyCount` (0 when `nonEmptyCount` is 0).
- **topK**: up to 5 most frequent values as `[ [value, count], ... ]`.
- Number columns include **numStats**: `{ min, max, mean, stdev }`.
- String columns include **textStats**: `{ minLen, maxLen, avgLen }`.
 - **uniquenessRatio**: `distinctCount / totalRows`.
 - **isUnique**: `distinctCount === nonEmptyCount` and `nonEmptyCount > 0`.
 - **isPrimaryKey**: `isUnique` and `completeness === 1`.

### dataFormat(data, options?)

- **data**: `Array<object>`
- **options**:
  - **preferStringNumbers**: `boolean` (default: `false`) – passed through to `getSchema`
  - **numberEmptyAsNull**: `boolean` (default: `true`) – empty numeric values become `null`
  - **bestGuess**: `boolean` (default: `true`) – when `true`, uses each column's `probably` to coerce String columns that predominantly look numeric (e.g., `Percentage`, `Currency`, `Integer`, `Float`). In this mode, numeric-looking strings are converted to numbers (stripping `%`, currency symbols/codes, commas), and non-numeric strings in those columns become `null` (respecting `numberEmptyAsNull`).
  - **reportIgnored**: `boolean` (default: `false`) – when `true`, logs to console only the values that are converted to `null` in numeric and numeric-like columns (e.g., empty strings, non-numeric placeholders in percentage/currency columns).
  - **report**: `(msg: string) => void` – optional logger; used when `reportIgnored` is `true` (defaults to `console.log`).
  - **convertDates**: `boolean` (default: `false`) – when `true`, converts columns inferred as `Date` into JavaScript `Date` objects. Uses native parsing for ISO/date-time and a loose parser for common `D/M/Y` and `M/D/Y` forms. Unparseable values are left unchanged.
  - **sanitizeKeys**: `boolean` (default: `false`) – if enabled, output rows use sanitized keys and map from original keys using `sourceName` in schema.
  - **dropEmptyColumns**: `boolean` (default: `false`) – if enabled, columns with no non-empty values are excluded from schema and removed from formatted output rows.

Returns a new array of formatted rows. Current conversions:
- Number columns: strings like `"1,234.56"`, `"$2,000"`, `"12%"` → numbers
- Boolean columns: `"true"`/`"false"` → booleans
- Date columns: left as-is unless `convertDates` is enabled, in which case values are converted to JavaScript `Date` instances when parsable.
- String columns: left as-is unless `bestGuess` is enabled, in which case numeric-dominant Strings (e.g., `