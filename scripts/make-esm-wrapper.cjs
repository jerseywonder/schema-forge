const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });

// Create an ESM wrapper that re-exports named bindings from the CJS default
const esm = `import cjs from './index.js';
export const getSchema = cjs.getSchema;
export const dataFormat = cjs.dataFormat;
export default cjs;
`;

fs.writeFileSync(path.join(distDir, 'index.mjs'), esm, 'utf8');
console.log('Wrote dist/index.mjs');


