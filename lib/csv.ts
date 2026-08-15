/** Minimal RFC4180 CSV parser — good enough for the seed files, no dependency. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      pushRow();
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const [header, ...dataRows] = rows.filter((r) => r.length > 1 || r[0] !== "");
  return dataRows.map((cells) =>
    Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ""]))
  );
}

export const toBool = (v: string) => v.trim().toLowerCase() === "true";
export const toIntOrNull = (v: string) => (v.trim() === "" ? null : parseInt(v, 10));
export const toInt = (v: string, fallback = 0) =>
  v.trim() === "" ? fallback : parseInt(v, 10);
