// moment not used; removed

/**
 * @typedef {Record<string, any>} DataRecord
 * @typedef {DataRecord[]} Dataset
 * @typedef {{ name: string, type: string, format: (string|null), repeating?: boolean, sequential?: boolean }} ColumnSchema
 */

/**
 * Normalize a number-like value by removing grouping, currency, and percent.
 * Returns a Number on success, otherwise the original value.
 * Note: percentages like "12%" become number 12 (not 0.12).
 * @param {any} value
 * @returns {any}
 */
function normalizeNumber(value, { emptyAsNull = false } = {}) {
  if (typeof value === 'number') return value;
  if (value == null) return emptyAsNull ? null : value;
  let s = String(value).trim();
  if (s === '') return emptyAsNull ? null : value;
  let hadPercent = false;
  // leading currency symbol
  s = s.replace(/^[\$€£]\s?/, (m) => { hadPercent = hadPercent || false; return ''; });
  // trailing currency code
  s = s.replace(/\s?(USD|EUR|GBP|AUD|CAD|NZD|JPY|CNY|INR)$/i, '');
  // grouping commas
  s = s.replace(/,/g, '');
  // percent
  if (/%$/.test(s)) { hadPercent = true; s = s.slice(0, -1).trim(); }
  if (s === '') return emptyAsNull ? null : value;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
  }
  return emptyAsNull ? null : value;
}

/**
 * Convert "true"/"false" (case-insensitive) strings to booleans.
 * Leaves other values unchanged.
 * @param {any} value
 * @returns {any}
 */
function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value == null) return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return value;
}

/**
 * Format dataset values based on inferred schema.
 * - Number: convert strings like "1,234.56", "$2,000" or "12%" to actual numbers
 * Other types are left as-is for now.
 * @param {Dataset} dataset
 * @param {{ preferStringNumbers?: boolean, numberEmptyAsNull?: boolean }} [options]
 * @returns {Dataset}
 */
function dataFormat(dataset, options = {}) {
  const rows = Array.isArray(dataset) ? dataset : [];
  const schema = getSchema(rows, options);
  const byName = Object.fromEntries(schema.map(c => [c.name, c]));
  const numberEmptyAsNull = options.numberEmptyAsNull !== undefined ? options.numberEmptyAsNull : true;
  const out = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const src = rows[i];
    const dst = { ...src };
    for (const key in byName) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      const col = byName[key];
      const val = src[key];
      if (col.type === 'Number') {
        dst[key] = normalizeNumber(val, { emptyAsNull: numberEmptyAsNull });
      } else if (col.type === 'Boolean') {
        dst[key] = normalizeBoolean(val);
      } else {
        dst[key] = val;
      }
    }
    out[i] = dst;
  }
  return out;
}

/**
 * Detect base type and more specific format.
 * @param {any} value
 * @param {boolean} [preferStringNumbers=false]
 * @returns {{ type: "String"|"Number"|"Boolean"|"Date", format: (string|null) }}
 */
function detectTypeAndFormat(value, preferStringNumbers = false) {
  if (value === null || value === undefined) return null;
  const vStr = typeof value === "string" ? value.trim() : String(value).trim();
  if (vStr === "") return null;

  // Boolean
  if (typeof value === "boolean" || /^(true|false)$/i.test(vStr))
    return { type: "Boolean", format: "Boolean" };

  // Date / Time (strftime format)
  const guessedFmt = guessDateFormatFromString(vStr);
  if (guessedFmt) return { type: "Date", format: guessedFmt };

  // Number / Percentage / comma-grouped numbers / currency (unless preferStringNumbers is true)
  if (!preferStringNumbers) {
    if (typeof value === "number") {
      return { type: "Number", format: Number.isInteger(value) ? "Integer" : "Float" };
    }
    let hadPercent = false;
    let hadCurrency = false;
    let norm = vStr.trim();
    // Strip leading currency symbols
    const symRe = /^[\$€£]\s?/;
    if (symRe.test(norm)) { hadCurrency = true; norm = norm.replace(symRe, ""); }
    // Strip trailing currency codes
    const codeRe = /\s?(USD|EUR|GBP|AUD|CAD|NZD|JPY|CNY|INR)$/i;
    if (codeRe.test(norm)) { hadCurrency = true; norm = norm.replace(codeRe, ""); }
    // Remove grouping commas
    norm = norm.replace(/,/g, "");
    // Handle trailing percent
    if (/%$/.test(norm)) { hadPercent = true; norm = norm.slice(0, -1).trim(); }
    if (/^[+-]?\d+(?:\.\d+)?$/.test(norm)) {
      const n = Number(norm);
      if (!Number.isNaN(n)) {
        return { type: "Number", format: hadPercent ? "Percentage" : (hadCurrency ? "Currency" : (Number.isInteger(n) ? "Integer" : "Float")) };
      }
    }
  }

  // String subformats
  if (/^(https?:\/\/)\S+$/i.test(vStr)) return { type: "String", format: "URL" };
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(vStr))
    return { type: "String", format: "Email" };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(vStr))
    return { type: "String", format: "IP Address" };
  if (/^\+?\d[\d\s().-]{8,}$/.test(vStr))
    return { type: "String", format: "Phone Number" };
  if (/^#[0-9A-Fa-f]{6}$/.test(vStr))
    return { type: "String", format: "Color" };
  if (vStr.startsWith("data:image")) return { type: "String", format: "Image" };
  if (vStr.startsWith("data:audio")) return { type: "String", format: "Audio" };
  if (vStr.startsWith("data:video")) return { type: "String", format: "Video" };
  // Currency handled as Number above
  // Percentage handled as Number above

  // JSON/Object
  if ((vStr.startsWith("{") && vStr.endsWith("}")) ||
      (vStr.startsWith("[") && vStr.endsWith("]"))) {
    try {
      JSON.parse(vStr);
      return { type: "String", format: vStr.startsWith("{") ? "Object" : "JSON" };
    } catch {}
  }

  if (vStr.length > 50) return { type: "String", format: "Text" };

  return { type: "String", format: null };
}

/**
 * Auto-detect column types.
 * @param {Array|String} jsonData - Array of row objects or a JSON string.
 * @param {Object} options
 * @param {boolean} [options.preferStringNumbers=false] - Treat numeric strings as String unless all values are numeric.
 * @returns {ColumnSchema[]}
 */
function getSchema(jsonData, { preferStringNumbers = false } = {}) {
  const rows = Array.isArray(jsonData) ? jsonData : JSON.parse(jsonData);
  const acc = new Map();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    for (const col in row) {
      if (!Object.prototype.hasOwnProperty.call(row, col)) continue;
      const tf = detectTypeAndFormat(row[col], preferStringNumbers);
      if (!tf) continue;

      if (!acc.has(col)) {
        acc.set(col, { 
          types: new Set(),
          formatsByType: new Map(),
          sawNonEmpty: false,
          // string stats
          strSeen: new Set(),
          hasStringDuplicate: false,
          // number sequence stats
          lastNum: undefined,
          numCount: 0,
          isSequential: true,
          // number year-candidate stats
          numFourDigitCount: 0,
          numInRangeCount: 0
        });
      }
      const entry = acc.get(col);
      entry.sawNonEmpty = true;

      entry.types.add(tf.type);
      if (!entry.formatsByType.has(tf.type)) {
        entry.formatsByType.set(tf.type, new Set());
      }
      entry.formatsByType.get(tf.type).add(tf.format ?? "__none__");

      // Track repeating values for String-typed detections
      if (tf.type === "String") {
        const raw = row[col];
        if (raw != null) {
          const s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
          if (s !== '') {
            if (entry.strSeen.has(s)) {
              entry.hasStringDuplicate = true;
            } else {
              entry.strSeen.add(s);
            }
          }
        }
      }

      // Track sequential numbers for Number-typed detections
      if (tf.type === "Number") {
        const raw = row[col];
        const n = normalizeNumber(raw, { emptyAsNull: false });
        if (typeof n === 'number' && Number.isFinite(n)) {
          if (entry.numCount === 0) {
            entry.lastNum = n;
            entry.numCount = 1;
          } else {
            if (n - entry.lastNum !== 1) entry.isSequential = false;
            entry.lastNum = n;
            entry.numCount += 1;
          }
          // Track year-candidate stats
          if (Number.isInteger(n)) {
            if (n >= 1000 && n <= 9999) entry.numFourDigitCount += 1;
            // Year range heuristic
            if (n >= 1800 && n <= 2100) entry.numInRangeCount += 1;
          }
        }
      }
    }
  }

  const results = [];

  for (const [name, { types, formatsByType, sawNonEmpty }] of acc.entries()) {
    if (!sawNonEmpty) {
      results.push({ name, type: "String", format: null });
      continue;
    }

    // If mixed base types → treat as String + mixed
    if (types.size > 1) {
      results.push({ name, type: "String", format: "mixed" });
      continue;
    }

    let [onlyType] = [...types];
    const fset = formatsByType.get(onlyType) || new Set(["__none__"]);

    let format = null;
    // Heuristic: upgrade Number columns to Date (%Y) if values look like years
    if (onlyType === "Number") {
      const e = acc.get(name);
      const hasCurrency = fset.has('Currency');
      const hasPercentage = fset.has('Percentage');
      const hasFloat = fset.has('Float');
      const allFourDigits = e && e.numCount > 0 && e.numFourDigitCount === e.numCount;
      const allInRange = e && e.numCount > 0 && e.numInRangeCount === e.numCount;
      if (!hasCurrency && !hasPercentage && !hasFloat && allFourDigits && allInRange) {
        onlyType = "Date";
        format = "%Y";
      }
    }

    if (onlyType === "Date") {
      // Guess precise date format across the column's values
      const guessed = guessColumnDateFormat(rows, name);
      // Respect explicit %Y upgrade if already set
      format = format || guessed || null;
      if (format === "__mixed__") format = "mixed";
    } else {
      if (fset.size === 1) {
        const [onlyFormat] = [...fset];
        format = onlyFormat === "__none__" ? null : onlyFormat;
      } else {
        format = "mixed";
      }
    }

    if (onlyType === "String") {
      results.push({ name, type: onlyType, format, repeating: (acc.get(name)?.hasStringDuplicate === true) });
    } else if (onlyType === "Number") {
      const e = acc.get(name);
      const sequential = e && e.numCount >= 2 ? e.isSequential === true : false;
      results.push({ name, type: onlyType, format, sequential });
    } else if (onlyType === "Date") {
      // Provide sequential flag as well if derived from numeric sequence
      const e = acc.get(name);
      const sequential = e && e.numCount >= 2 ? e.isSequential === true : false;
      results.push({ name, type: onlyType, format, sequential });
    } else {
      results.push({ name, type: onlyType, format });
    }
  }

  // Post-pass: downgrade Number→String if preferStringNumbers and not all numeric
  if (preferStringNumbers) {
    for (const r of results) {
      if (r.type === "Number") {
        const allNumeric = rows.every(row => {
          const val = row[r.name];
          const s = String(val);
          return val == null || s === "" || /^-?\d+(\.\d+)?$/.test(s);
        });
        if (!allNumeric) {
          r.type = "String";
          r.format = "mixed";
        }
      }
    }
  }

  return results;
}


/**
 * Guess a moment-like date format string from a single value string.
 * Returns null if not recognized.
 * @param {string} s
 * @returns {string|null}
 */
function guessDateFormatFromString(s) {
  const v = String(s).trim();
  if (!v) return null;

  // Time-only with optional seconds and AM/PM
  let m = v.match(/^((?:[01]?\d)|(?:2[0-3])):([0-5]\d)(?::([0-5]\d))?(?:\s*(AM|PM))?$/i);
  if (m) {
    const hasSec = !!m[3];
    const hasAmPm = !!m[4];
    return hasAmPm ? (hasSec ? '%I:%M:%S %p' : '%I:%M %p') : (hasSec ? '%H:%M:%S' : '%H:%M');
  }

  // ISO Date/DateTime (with T or space)
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const hasTime = !!m[4];
    const sep = v.includes('T') ? 'T' : (hasTime ? ' ' : '');
    let fmt = '%Y-%m-%d';
    if (hasTime) {
      fmt += sep + '%H:%M';
      if (m[6]) fmt += ':%S';
      if (m[7]) fmt += '.%f';
    }
    if (m[8]) {
      // numeric timezone offset
      fmt += '%z';
    }
    return fmt;
  }

  // YYYY/MM/DD or YYYY-MM-DD already handled above; include slashes variant
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(v)) return '%Y/%m/%d';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return '%Y-%m-%d';

  // D/M/Y or M/D/Y with / or -
  m = v.match(/^(\d{1,2})([\/\-])(\d{1,2})\2(\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const sep = m[2];
    if (a > 12 && b <= 12) return `%d${sep}%m${sep}%Y`;
    if (b > 12 && a <= 12) return `%m${sep}%d${sep}%Y`;
    // Ambiguous: default to %m/%d/%Y style
    return `%m${sep}%d${sep}%Y`;
  }

  // DD-MM-YYYY or DD/MM/YYYY variants with leading zeros
  if (/^\d{2}-\d{2}-\d{4}$/.test(v)) return '%d-%m-%Y';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return '%m/%d/%Y';

  return null;
}

/**
 * Guess a column's date format across all rows.
 * Returns a single format string, 'mixed' marker, or null if undecided.
 * @param {Array<object>} rows
 * @param {string} columnName
 * @returns {string|null}
 */
function guessColumnDateFormat(rows, columnName) {
  const counts = new Map();
  for (const row of rows) {
    const raw = row[columnName];
    if (raw == null || raw === '') continue;
    const fmt = guessDateFormatFromString(String(raw));
    if (!fmt) continue;
    counts.set(fmt, (counts.get(fmt) || 0) + 1);
  }
  const formats = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (formats.length === 0) return null;
  if (formats.length === 1) return formats[0][0];
  // More than one format observed
  return '__mixed__';
}



const api = { dataFormat, getSchema };

module.exports = api;
// Preserve default import style: require('pkg').default
module.exports.default = api;


