/** Offers a file to save, as a download of a blob. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Long enough for the browser to have read it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
