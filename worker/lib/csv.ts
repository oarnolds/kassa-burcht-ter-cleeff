// CSV as Dutch Excel opens it without questions: a byte-order mark, semicolons, CRLF line endings.

const BOM = String.fromCharCode(0xfeff);

function field(value: string | number): string {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: (string | number)[][]): string {
  return BOM + rows.map((row) => row.map(field).join(";") + "\r\n").join("");
}
