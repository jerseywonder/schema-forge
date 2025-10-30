const lib = require('../dist');
const { getSchema, dataFormat, toJSONSchema } = lib;
const fs = require('fs');
const path = require('path');

async function runCsv(filePath) {
  const abs = path.join(__dirname, path.basename(filePath));
  const text = fs.readFileSync(abs, 'utf8');
  const { csvParse } = await import('d3-dsv');
  const rows = csvParse(text);

  const wrangled = dataFormat(rows, { sanitizeKeys: true, dropEmptyColumns: true, convertDates: true });
  // Ensure output directory and write to JSON file
  const outDir = path.join(__dirname, 'cleaned');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, path.basename(filePath).replace(/\.csv$/i, '.json'));
  fs.writeFileSync(outPath, JSON.stringify(wrangled, null, 2));
  console.log('Wrangled data written to:', outPath);
}

async function main() {
  const entries = fs.readdirSync(__dirname, { withFileTypes: true });
  const csvFiles = entries
    .filter(d => d.isFile() && /\.csv$/i.test(d.name))
    .map(d => d.name);

  if (csvFiles.length === 0) {
    console.log('No CSV files found in', __dirname);
    return;
  }

  for (const file of csvFiles) {
    try {
      await runCsv(file);
    } catch (err) {
      console.error('Failed to wrangle', file, '-', err && err.message ? err.message : err);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });



