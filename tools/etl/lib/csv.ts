/**
 * Minimal RFC4180-ish CSV parser: supports a custom delimiter, quoted fields (with escaped
 * `""`), and embedded newlines inside quotes. Good enough for the HYG/Exoplanet Archive
 * exports used by the ETL, without pulling in an extra dependency.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // skip; \n (handled below) terminates the row
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Reads a numeric CSV cell, treating a missing/blank/unparseable value as absent.
 *
 * Always prefer this to a bare `Number(cell)`: catalogs leave unmeasured fields empty, and
 * `Number('')` is `0` — a finite, entirely plausible-looking value. That single coercion has
 * already produced two separate bugs here, painting 875 unphotometered stars as if they had a
 * measured colour index of 0, and placing exoplanet hosts at the origin where they matched the
 * Sun.
 */
export function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parses `text` as CSV and maps each data row to an object keyed by the header row. */
export function parseCsvObjects(text: string, delimiter = ','): Array<Record<string, string>> {
  const rows = parseCsv(text, delimiter).filter((row) => row.some((cell) => cell.length > 0));
  if (rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    header.forEach((column, index) => {
      record[column] = row[index] ?? '';
    });
    return record;
  });
}
