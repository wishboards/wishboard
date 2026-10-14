import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOpenApiDocument } from '../src/server/docs/openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TARGET_PATH = path.resolve(__dirname, '../api/openapi.json');

/**
 * Generates and formats the OpenAPI JSON specification file.
 * @param {string} [outputPath] - Custom file path to write to.
 * @returns {string} The formatted JSON string written.
 */
export function generateOpenApiSpecFile(outputPath = DEFAULT_TARGET_PATH) {
  const doc = getOpenApiDocument();
  const jsonContent = `${JSON.stringify(doc, null, 2)}\n`;
  const targetDir = path.dirname(outputPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, jsonContent, 'utf8');
  return jsonContent;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.env.OPENAPI_SPEC_PATH
    ? path.resolve(process.env.OPENAPI_SPEC_PATH)
    : DEFAULT_TARGET_PATH;
  generateOpenApiSpecFile(target);
  console.log(`Generated OpenAPI specification at ${target}`);
}
