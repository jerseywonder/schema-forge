

/**
 * @typedef {Record<string, any>} DataRecord
 * @typedef {DataRecord[]} Dataset
 * @typedef {{
 *   name: string,
 *   type: string,
 *   format: (string|null),
 *   repeating?: boolean,
 *   sequential?: boolean,
 *   score?: number,
 *   probably?: string,
 *   tally?: Record<string, number>,
 *   completeness?: number,
 *   distinctCount?: number,
 *   cardinality?: number,
 *   topK?: Array<[string, number]>,
 *   numStats?: { min: number, max: number, mean: number, stdev: number },
 *   textStats?: { minLen: number, maxLen: number, avgLen: number },
 *   isUnique?: boolean,
 *   uniquenessRatio?: number,
 *   isPrimaryKey?: boolean,
 *   sourceName?: string
 * }} ColumnSchema
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
 * Heuristic: detect if a string looks like a delimited list (comma/semicolon/pipe).
 * Requires at least 2 non-empty parts and reasonable average token length.
 * @param {string} s
 */
function isLikelyList(s) {
  const parts = String(s).split(/[;,|]/).map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const avg = parts.reduce((sum, p) => sum + p.length, 0) / parts.length;
  return avg <= 30;
}

/**
 * Format dataset values based on inferred schema.
 * - Number: convert strings like "1,234.56", "$2,000" or "12%" to actual numbers
 * Other types are left as-is for now.
 * @param {Dataset} dataset
 * @param {object} [options]
 * @param {boolean} [options.preferStringNumbers=false]
 * @param {boolean} [options.numberEmptyAsNull=true]
 * @param {boolean} [options.sanitizeKeys=false]
 * @param {boolean} [options.dropEmptyColumns=false]
 * @returns {Dataset}
 */
function dataFormat(dataset, options = {}) {
  const rows = Array.isArray(dataset) ? dataset : [];
  const schema = getSchema(rows, options);
  const byName = Object.fromEntries(schema.map(c => [c.name, c]));
  const numberEmptyAsNull = options.numberEmptyAsNull !== undefined ? options.numberEmptyAsNull : true;
  const out = new Array(rows.length);
  const sanitize = options && options.sanitizeKeys === true;
  const dropEmptyColumns = options && options.dropEmptyColumns === true;
  const columnsToInclude = dropEmptyColumns ? Object.keys(byName) : null;
  for (let i = 0; i < rows.length; i++) {
    const src = rows[i];
    const dst = sanitize || dropEmptyColumns ? {} : { ...src };
    for (const key in byName) {
      const col = byName[key];
      const sourceKey = sanitize && col.sourceName ? col.sourceName : key;
      if (!Object.prototype.hasOwnProperty.call(src, sourceKey)) continue;
      const val = src[sourceKey];
      const targetKey = key;
      if (col.type === 'Number') {
        dst[targetKey] = normalizeNumber(val, { emptyAsNull: numberEmptyAsNull });
      } else if (col.type === 'Boolean') {
        dst[targetKey] = normalizeBoolean(val);
      } else {
        dst[targetKey] = val;
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
  // Financial year like 2011-12 or 2011–12
  if (/^(19|20)\d{2}[-–](\d{2})$/.test(vStr)) return { type: "String", format: "Financial year" };
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

  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(vStr))
    return { type: "String", format: "Text" };


  const len = vStr.length;
  const sentences = (vStr.match(/[.!?](\s|$)/g) || []).length;
  if (len > 80 && sentences >= 1) return { type: "String", format: "Text"};
  if (sentences >= 1) return { type: "String", format: "Text" };
  if (len > 50) return { type: "String", format: "Text" };


  return { type: "String", format: "Text" };
}

// Removed specialized global string category detectors; using generic category vs text heuristic instead.

/**
 * Auto-detect column types.
 * @param {Array|String} jsonData - Array of row objects or a JSON string.
 * @param {object} [options]
 * @param {boolean} [options.preferStringNumbers=false] - Treat numeric strings as String unless all values are numeric.
 * @param {boolean} [options.sanitizeKeys=false] - Sanitize column names (strip invisible/control chars, normalize, dedupe). Adds sourceName with original.
 * @param {boolean} [options.dropEmptyColumns=false] - If true, columns with no non-empty values are excluded from schema and output rows.
 * @returns {ColumnSchema[]}
 */
function getSchema(jsonData, { preferStringNumbers = false, sanitizeKeys = false, dropEmptyColumns = false } = {}) {
  const rows = Array.isArray(jsonData) ? jsonData : JSON.parse(jsonData);
  const totalRows = rows.length;
  const acc = new Map();
  const usedSanitized = new Set();
  const originalToSanitized = new Map();
  function sanitizeKey(name) {
    let s = String(name);
    try { s = s.normalize('NFC'); } catch {}
    s = s.replace(/[\uFEFF\u200B-\u200D\u2060\u00A0\u00AD]/g, '');
    s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    if (s === '') s = 'col';
    return s;
  }
  function getUniqueSanitized(name) {
    const base = sanitizeKey(name);
    let candidate = base;
    let n = 2;
    while (usedSanitized.has(candidate)) {
      candidate = base + '_' + n;
      n += 1;
    }
    usedSanitized.add(candidate);
    return candidate;
  }

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    for (const col in row) {
      let keyName = col;
      if (sanitizeKeys) {
        if (!originalToSanitized.has(col)) {
          originalToSanitized.set(col, getUniqueSanitized(col));
        }
        keyName = originalToSanitized.get(col);
      }
      if (!Object.prototype.hasOwnProperty.call(row, col)) continue;
      const tf = detectTypeAndFormat(row[col], preferStringNumbers);
      if (!tf) continue;

      if (!acc.has(keyName)) {
        acc.set(keyName, { 
          types: new Set(),
          formatsByType: new Map(),
          sawNonEmpty: false,
          nonEmptyCount: 0,
          uniqueValues: new Set(),
          valueCounts: new Map(),
          formatCounts: new Map(),
          typeCounts: new Map(),
          // string stats
          strSeen: new Set(),
          hasStringDuplicate: false,
          strValueCounts: new Map(),
          maxStrValueCount: 0,
          strObsCount: 0,
          textFormatCounts: new Map(), // Paragraph/Sentence/Text counts among string obs
          listCount: 0,
          // number sequence stats
          lastNum: undefined,
          numCount: 0,
          isSequential: true,
          // number year-candidate stats
          numFourDigitCount: 0,
          numInRangeCount: 0,
          // numeric stats
          numStats: { count: 0, sum: 0, sumSq: 0, min: Infinity, max: -Infinity },
          // text stats
          textStats: { count: 0, minLen: Infinity, maxLen: 0, sumLen: 0 },
          sourceName: sanitizeKeys ? col : undefined
        });
      }
      const entry = acc.get(keyName);
      entry.sawNonEmpty = true;

      entry.types.add(tf.type);
      if (!entry.formatsByType.has(tf.type)) {
        entry.formatsByType.set(tf.type, new Set());
      }
      entry.formatsByType.get(tf.type).add(tf.format ?? "__none__");

      // Count formats for score/probably
      entry.nonEmptyCount += 1;
      const label = (tf && typeof tf.format === 'string' && tf.format.length > 0) ? tf.format : tf.type;
      entry.formatCounts.set(label, (entry.formatCounts.get(label) || 0) + 1);
      // Count base types
      entry.typeCounts.set(tf.type, (entry.typeCounts.get(tf.type) || 0) + 1);
      // Distinct tracking by normalised string
      const vRaw = row[col];
      const distinctKey = (typeof vRaw === 'string') ? String(vRaw).trim() : String(vRaw);
      if (distinctKey !== '') entry.uniqueValues.add(distinctKey);

      // Track repeating values for String-typed detections
      if (tf.type === "String") {
        const raw = row[col];
        if (raw != null) {
          const s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
          if (s !== '') {
            entry.strObsCount += 1;
            if (entry.strSeen.has(s)) {
              entry.hasStringDuplicate = true;
            } else {
              entry.strSeen.add(s);
            }
            // value frequency
            const c = (entry.strValueCounts.get(s) || 0) + 1;
            entry.strValueCounts.set(s, c);
            entry.valueCounts.set(s, (entry.valueCounts.get(s) || 0) + 1);
            if (c > entry.maxStrValueCount) entry.maxStrValueCount = c;
            // text subformats aggregation
            if (tf.format === 'Text') {
              entry.textFormatCounts.set(tf.format, (entry.textFormatCounts.get(tf.format) || 0) + 1);
            }
            // list heuristic
            if (isLikelyList(s)) entry.listCount += 1;
            // text stats
            const L = s.length;
            entry.textStats.count += 1;
            entry.textStats.sumLen += L;
            if (L < entry.textStats.minLen) entry.textStats.minLen = L;
            if (L > entry.textStats.maxLen) entry.textStats.maxLen = L;
          }
        }
      }

      // Track sequential numbers for Number-typed detections
      if (tf.type === "Number") {
        const raw = row[col];
        const n = normalizeNumber(raw, { emptyAsNull: false });
        if (typeof n === 'number' && Number.isFinite(n)) {
          // numeric stats
          const ns = entry.numStats;
          ns.count += 1;
          ns.sum += n;
          ns.sumSq += n*n;
          if (n < ns.min) ns.min = n;
          if (n > ns.max) ns.max = n;
          // value counts
          const nKey = String(n);
          entry.valueCounts.set(nKey, (entry.valueCounts.get(nKey) || 0) + 1);
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
  function addResult(entry) {
    if (entry.probably === undefined) delete entry.probably;
    if (entry.sourceName === undefined) delete entry.sourceName;
    results.push(entry);
  }

  for (const [name, { types, formatsByType, sawNonEmpty }] of acc.entries()) {
    if (!sawNonEmpty) {
      const entry = acc.get(name);
      if (!dropEmptyColumns) {
        results.push({ name, sourceName: entry && entry.sourceName ? entry.sourceName : undefined, type: "String", format: null, tally: {}, completeness: 0, distinctCount: 0, cardinality: 0, uniquenessRatio: 0, isUnique: false, isPrimaryKey: false });
      }
      continue;
    }

    // If mixed base types → treat as String + mixed, but still compute score/probably and repeating
    if (types.size > 1) {
      const e = acc.get(name);
      let score, probably;
      if (e && e.nonEmptyCount > 0) {
        const top = [...e.formatCounts.entries()].sort((a,b)=> b[1]-a[1])[0];
        if (top) {
          score = top[1] / e.nonEmptyCount;
          if (score < 1) probably = top[0];
        }
        // Prefer String heuristics (Category vs Text) when present
        if (e.strObsCount > 0) {
          const categoryScore = e.maxStrValueCount / e.strObsCount;
          const tCounts = e.textFormatCounts;
          const textScore = e.strObsCount > 0 ? ((tCounts.get('Text')||0) / e.strObsCount) : 0;
          const listScore = e.strObsCount > 0 ? (e.listCount / e.strObsCount) : 0;
          if (listScore >= textScore && listScore >= categoryScore && listScore > 0) {
            score = listScore;
            probably = 'List';
          } else if (textScore >= categoryScore && textScore > 0) {
            score = textScore;
            probably = 'Text';
          } else if (categoryScore > 0) {
            score = categoryScore;
            probably = 'Category';
          }
        }
        // If percentages dominate overall, prefer Percentage
        const percCount = e.formatCounts.get('Percentage') || 0;
        const percScore = e.nonEmptyCount ? (percCount / e.nonEmptyCount) : 0;
        if (percScore > (score || 0)) {
          score = percScore;
          probably = 'Percentage';
        }

        // Recalculate score/probably from tally (formatCounts): top label and max count / total
        const tallyEntries = [...e.formatCounts.entries()].sort((a,b)=> b[1]-a[1]);
        if (tallyEntries.length) {
          let total = 0;
          for (const [, c] of tallyEntries) total += c;
          const [topLabel, topCount] = tallyEntries[0];
          if (total) {
            score = topCount / total;
            probably = topLabel;
          }
        }
      }
      const repeating = (acc.get(name)?.hasStringDuplicate === true);
      {
        const e2 = acc.get(name);
        const nonEmpty = e2.nonEmptyCount;
        const distinct = e2.uniqueValues.size;
        const completeness = totalRows ? (nonEmpty / totalRows) : 0;
        const cardinality = nonEmpty ? (distinct / nonEmpty) : 0;
        const topK = [...e2.valueCounts.entries()].sort((a,b)=> b[1]-a[1]).slice(0, 5);
        const uniquenessRatio = totalRows ? (distinct / totalRows) : 0;
        const isUnique = distinct === nonEmpty && nonEmpty > 0;
        const isPrimaryKey = isUnique && completeness === 1;
        addResult({ name, sourceName: e2.sourceName, type: "String", format: "mixed", repeating, score, probably, tally: Object.fromEntries(e2.formatCounts), completeness, distinctCount: distinct, cardinality, topK, uniquenessRatio, isUnique, isPrimaryKey });
      }
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

    // Compute score/probably from counted formats; for Strings use category vs text heuristic
    const e = acc.get(name);
    let score, probably;
    if (e && e.nonEmptyCount > 0) {
      // base score by format frequency
      const top = [...e.formatCounts.entries()].sort((a,b)=> b[1]-a[1])[0];
      if (top) {
        score = top[1] / e.nonEmptyCount;
        if (score < 1) probably = top[0];
      }
      if (onlyType === "String") {
        // Calculate score/probably from tally (formatCounts): top label and max count / total
        const tallyEntries = [...e.formatCounts.entries()].sort((a,b)=> b[1]-a[1]);
        if (tallyEntries.length) {
          let total = 0;
          for (const [, c] of tallyEntries) total += c;
          const [topLabel, topCount] = tallyEntries[0];
          if (total) {
            score = topCount / total;
            probably = topLabel;

            if (topLabel === "Text" && acc.get(name)?.hasStringDuplicate === true) {
              if ([...acc.get(name).strSeen].length > 1) {

                if ([...acc.get(name).strSeen].length < 10) {
                probably = 'Categories: ' + [...acc.get(name).strSeen].join(', ');
                } else {
                  probably = 'Categories';
                }
              } else {
                probably = 'Zero-variance column';
              }
            }
          }
        }
      }
    }

    if (onlyType === "String") {
      const e4 = acc.get(name);
      const nonEmpty = e4.nonEmptyCount;
      const distinct = e4.uniqueValues.size;
      const completeness = totalRows ? (nonEmpty / totalRows) : 0;
      const cardinality = nonEmpty ? (distinct / nonEmpty) : 0;
      const topK = [...e4.valueCounts.entries()].sort((a,b)=> b[1]-a[1]).slice(0, 5);
      const textStats = e4.textStats.count ? { minLen: e4.textStats.minLen, maxLen: e4.textStats.maxLen, avgLen: e4.textStats.sumLen / e4.textStats.count } : undefined;
      const uniquenessRatio = totalRows ? (distinct / totalRows) : 0;
      const isUnique = distinct === nonEmpty && nonEmpty > 0;
      const isPrimaryKey = isUnique && completeness === 1;
      addResult({ name, sourceName: e4.sourceName, type: onlyType, format, repeating: (acc.get(name)?.hasStringDuplicate === true), score, probably, tally: Object.fromEntries(e4.formatCounts), completeness, distinctCount: distinct, cardinality, topK, textStats, uniquenessRatio, isUnique, isPrimaryKey });
    } else if (onlyType === "Number") {
      const e2 = acc.get(name);
      const sequential = e2 && e2.numCount >= 2 ? e2.isSequential === true : false;
      const nonEmpty = e2.nonEmptyCount;
      const distinct = e2.uniqueValues.size;
      const completeness = totalRows ? (nonEmpty / totalRows) : 0;
      const cardinality = nonEmpty ? (distinct / nonEmpty) : 0;
      const topK = [...e2.valueCounts.entries()].sort((a,b)=> b[1]-a[1]).slice(0, 5);
      const ns = e2.numStats;
      const variance = ns.count > 1 ? (ns.sumSq - (ns.sum*ns.sum)/ns.count) / (ns.count - 1) : 0;
      const numStats = ns.count ? { min: ns.min, max: ns.max, mean: ns.sum / ns.count, stdev: Math.sqrt(Math.max(0, variance)) } : undefined;
      const uniquenessRatio = totalRows ? (distinct / totalRows) : 0;
      const isUnique = distinct === nonEmpty && nonEmpty > 0;
      const isPrimaryKey = isUnique && completeness === 1;
      addResult({ name, sourceName: e2.sourceName, type: onlyType, format, sequential, score, probably, tally: Object.fromEntries(e2.formatCounts), completeness, distinctCount: distinct, cardinality, topK, numStats, uniquenessRatio, isUnique, isPrimaryKey });
    } else if (onlyType === "Date") {
      // Provide sequential flag as well if derived from numeric sequence
      const e3 = acc.get(name);
      const sequential = e3 && e3.numCount >= 2 ? e3.isSequential === true : false;
      const nonEmpty = e3.nonEmptyCount;
      const distinct = e3.uniqueValues.size;
      const completeness = totalRows ? (nonEmpty / totalRows) : 0;
      const cardinality = nonEmpty ? (distinct / nonEmpty) : 0;
      const topK = [...e3.valueCounts.entries()].sort((a,b)=> b[1]-a[1]).slice(0, 5);
      const uniquenessRatio = totalRows ? (distinct / totalRows) : 0;
      const isUnique = distinct === nonEmpty && nonEmpty > 0;
      const isPrimaryKey = isUnique && completeness === 1;
      addResult({ name, sourceName: e3.sourceName, type: onlyType, format, sequential, score, probably, tally: Object.fromEntries(e3.formatCounts), completeness, distinctCount: distinct, cardinality, topK, uniquenessRatio, isUnique, isPrimaryKey });
    } else {
      const e5 = acc.get(name);
      const nonEmpty = e5.nonEmptyCount;
      const distinct = e5.uniqueValues.size;
      const completeness = totalRows ? (nonEmpty / totalRows) : 0;
      const cardinality = nonEmpty ? (distinct / nonEmpty) : 0;
      const topK = [...e5.valueCounts.entries()].sort((a,b)=> b[1]-a[1]).slice(0, 5);
      const uniquenessRatio = totalRows ? (distinct / totalRows) : 0;
      const isUnique = distinct === nonEmpty && nonEmpty > 0;
      const isPrimaryKey = isUnique && completeness === 1;
      addResult({ name, sourceName: e5.sourceName, type: onlyType, format, score, probably, tally: Object.fromEntries(e5.formatCounts), completeness, distinctCount: distinct, cardinality, topK, uniquenessRatio, isUnique, isPrimaryKey });
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
 * Convert a schema (or rows) into a JSON Schema object.
 * If an array of rows is provided, the schema is inferred first.
 * @param {ColumnSchema[]|Dataset} input
 * @param {{ preferStringNumbers?: boolean }} [options]
 * @returns {object}
 */
function toJSONSchema(input, options = {}) {
  /** @type {ColumnSchema[]} */
  const schema = Array.isArray(input) && input.length && typeof input[0] === 'object' && !('name' in input[0])
    ? getSchema(/** @type {Dataset} */(input), options)
    : /** @type {ColumnSchema[]} */(input);

  const properties = {};
  const required = [];

  for (const col of schema) {
    const colSchema = {};
    if (col.type === 'Number') {
      if (col.format === 'Integer') {
        colSchema.type = 'integer';
      } else {
        colSchema.type = 'number';
      }
      if (col.numStats) {
        if (Number.isFinite(col.numStats.min)) colSchema.minimum = col.numStats.min;
        if (Number.isFinite(col.numStats.max)) colSchema.maximum = col.numStats.max;
      }
    } else if (col.type === 'Boolean') {
      colSchema.type = 'boolean';
    } else if (col.type === 'Date') {
      colSchema.type = 'string';
      if (typeof col.format === 'string') {
        const fmt = col.format;
        if (fmt === '%Y') {
          colSchema.pattern = '^(?:18|19|20|21)\\d{2}$';
        } else if (/^%Y[-/]%m[-/]%d$/.test(fmt)) {
          colSchema.format = 'date';
        } else if (/%H|%I/.test(fmt)) {
          colSchema.format = 'date-time';
        }
      }
    } else {
      colSchema.type = 'string';
      if (col.format === 'Financial year') {
        colSchema.pattern = '^(?:19|20)\\d{2}[-–]\\d{2}$';
      }
      if (col.textStats) {
        if (Number.isFinite(col.textStats.minLen)) colSchema.minLength = Math.max(0, col.textStats.minLen);
        if (Number.isFinite(col.textStats.maxLen)) colSchema.maxLength = Math.max(0, col.textStats.maxLen);
      }
    }

    properties[col.name] = colSchema;
    if (col.completeness === 1) required.push(col.name);
  }

  const out = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties,
    required
  };
  if (required.length === 0) delete out.required;
  return out;
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



const api = { dataFormat, getSchema, toJSONSchema };

module.exports = api;
// Preserve default import style: require('pkg').default
module.exports.default = api;


