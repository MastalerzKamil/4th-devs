import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Parse a single CSV line respecting quoted fields (handles commas and escaped quotes inside quotes).
 */
function parseCsvLine(line) {
  const fields = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] === '"') {
      let value = "";
      i += 1;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i += 1;
            break;
          }
        } else {
          value += line[i];
          i += 1;
        }
      }
      fields.push(value);
    } else {
      let value = "";
      while (i < line.length && line[i] !== ",") {
        value += line[i];
        i += 1;
      }
      fields.push(value);
      if (i < line.length) i += 1;
    }
  }

  return fields;
}

/**
 * Read CSV file and yield rows as objects using the first line as header keys.
 */
export async function* readCsv(path) {
  const file = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let header = null;

  for await (const line of file) {
    const fields = parseCsvLine(line);
    if (!header) {
      header = fields;
      continue;
    }
    const row = {};
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = fields[i] ?? "";
    }
    yield row;
  }
}

/**
 * Load all rows from a CSV file into an array.
 */
export async function loadCsv(path) {
  const rows = [];
  for await (const row of readCsv(path)) {
    rows.push(row);
  }
  return rows;
}
