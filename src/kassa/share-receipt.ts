// A receipt for the customer who asks for one: a picture of the last sale, handed to the iPad's share
// sheet, where AirDrop is. Nothing is stored or sent anywhere else.

import { formatEuro } from "../../shared/money";
import type { SaleLineInput } from "../../shared/schemas";
import { businessDate, formatDateNl, localTime } from "../../shared/time";

/** A sale that has just been paid, as the receipt shows it. `cashGivenCents`: what the customer handed over, for cash. */
export type FinishedSale = {
  id: string;
  soldAt: string;
  lines: SaleLineInput[];
  totalCents: number;
  method: "cash" | "pin";
  cashGivenCents: number | null;
};

type Row = { label: string; amount: string };

/** What the receipt says, line by line. */
export type ReceiptRows = { when: string; number: string; lines: Row[]; total: string; paid: Row[] };

export function receiptRows(sale: FinishedSale): ReceiptRows {
  const given = sale.cashGivenCents ?? sale.totalCents;
  const paid: Row[] =
    sale.method === "pin"
      ? [{ label: "Pin", amount: formatEuro(sale.totalCents) }]
      : [
          { label: "Contant", amount: formatEuro(given) },
          ...(given > sale.totalCents ? [{ label: "Wisselgeld", amount: formatEuro(given - sale.totalCents) }] : []),
        ];
  return {
    when: `${formatDateNl(businessDate(sale.soldAt))} ${localTime(sale.soldAt)}`,
    // The same number Mollie shows for a pin payment ("Kassa bon …"), so that the penningmeester can find it.
    number: `Bon ${sale.id.slice(0, 8)}`,
    lines: sale.lines.map((line) => ({ label: `${line.qty} × ${line.name}`, amount: formatEuro(line.qty * line.unitPriceCents) })),
    total: formatEuro(sale.totalCents),
    paid,
  };
}

const WIDTH = 720;
const PAD = 48;
const FONT = '"DM Sans Variable", sans-serif';
const INK = "#252628";
const MUTED = "#6B6C6E";
const GREEN = "#566E1F";
const LINE = "#E0E1DA";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** Draws the receipt as a PNG, in the kassa's own letter and colours. */
export async function drawReceipt(rows: ReceiptRows): Promise<Blob | null> {
  await Promise.all([document.fonts?.load(`400 26px ${FONT}`), document.fonts?.load(`700 26px ${FONT}`)]).catch(() => {});
  const logo = await loadImage("/icon.svg");

  const rowHeight = 46;
  const height = PAD + 88 + 34 + 34 + 36 + rows.lines.length * rowHeight + 24 + 64 + 20 + rows.paid.length * rowHeight + 56 + PAD;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = "alphabetic";
  const left = (text: string, y: number, font: string, color = INK, maxWidth = WIDTH - 2 * PAD - 150) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(text, PAD, y, maxWidth);
  };
  const right = (text: string, y: number, font: string, color = INK) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = "right";
    ctx.fillText(text, WIDTH - PAD, y);
  };
  const rule = (y: number) => {
    ctx.fillStyle = LINE;
    ctx.fillRect(PAD, y, WIDTH - 2 * PAD, 2);
  };

  let y = PAD;
  if (logo) ctx.drawImage(logo, PAD, y, 64, 64);
  ctx.font = `700 28px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "4px";
  ctx.fillText("BURCHT TER CLEEFF", PAD + (logo ? 84 : 0), y + 44);
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
  y += 88;

  left("Speeltuin Burcht ter Cleeff", (y += 34) - 6, `400 24px ${FONT}`, MUTED);
  left(rows.when, (y += 34) - 6, `400 24px ${FONT}`, MUTED);
  right(rows.number, y - 6, `400 24px ${FONT}`, MUTED);
  y += 36;
  rule(y - 18);

  for (const line of rows.lines) {
    y += rowHeight;
    left(line.label, y - 14, `400 28px ${FONT}`);
    right(line.amount, y - 14, `400 28px ${FONT}`);
  }
  y += 24;
  rule(y - 8);
  y += 64;
  left("Totaal", y - 16, `700 34px ${FONT}`);
  right(rows.total, y - 16, `700 40px ${FONT}`);
  y += 20;
  for (const row of rows.paid) {
    y += rowHeight;
    left(row.label, y - 14, `400 26px ${FONT}`, MUTED);
    right(row.amount, y - 14, `400 26px ${FONT}`, MUTED);
  }
  y += 56;
  ctx.font = `700 26px ${FONT}`;
  ctx.fillStyle = GREEN;
  ctx.textAlign = "center";
  ctx.fillText("Bedankt en tot ziens!", WIDTH / 2, y);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/**
 * Makes the picture ahead of the tap, and returns what the tap does: open the share sheet with it. Safari
 * opens the share sheet only straight from a tap, so nothing may be waited for between the tap and the call.
 * null: this device cannot share a picture, and the kassa offers nothing.
 */
export async function prepareReceiptShare(sale: FinishedSale, draw: (rows: ReceiptRows) => Promise<Blob | null> = drawReceipt): Promise<(() => void) | null> {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return null;
  const blob = await draw(receiptRows(sale)).catch(() => null);
  if (!blob) return null;
  const file = new File([blob], `bon-${sale.id.slice(0, 8)}.png`, { type: "image/png" });
  if (!navigator.canShare({ files: [file] })) return null;
  return () => {
    // Closing the share sheet without sending rejects: that is the beheerder's choice, not a fault.
    navigator.share({ files: [file] }).catch(() => {});
  };
}
