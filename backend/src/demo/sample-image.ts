import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import * as fs from 'fs';

/** What a generated specimen FDR shows. Everything here is fictional. */
export interface SampleDoc {
  bank: string;
  fdrNumber: string;
  branch: string;
  ifsc: string;
  depositor: string;
  amount: number;
  issueDate: string; // DD/MM/YYYY as printed
  maturityDate: string; // DD/MM/YYYY as printed
  inFavourOf: string;
}

let fontReady = false;
function ensureFonts() {
  if (fontReady) return;
  fontReady = true;
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/Library/Fonts/Arial.ttf',
  ];
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) GlobalFonts.registerFromPath(f, 'SakshiSans');
    } catch {
      /* try next */
    }
  }
}

/** Indian digit grouping: 500000 -> 5,00,000 */
export function inrGrouped(n: number): string {
  return n.toLocaleString('en-IN');
}

export async function renderFdrImage(d: SampleDoc): Promise<Buffer> {
  ensureFonts();
  const W = 1100;
  const H = 760;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, W - 40, H - 40);
  const family = GlobalFonts.families.some((f) => f.family === 'SakshiSans') ? 'SakshiSans' : 'sans-serif';
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.font = `bold 34px ${family}`;
  ctx.fillText(`${d.bank.toUpperCase()} - FIXED DEPOSIT RECEIPT`, 60, 55);
  ctx.font = `22px ${family}`;
  ctx.fillText('SPECIMEN FOR DEMONSTRATION - FICTIONAL, NOT A REAL BANK RECEIPT', 60, 105);
  ctx.beginPath();
  ctx.moveTo(60, 145);
  ctx.lineTo(W - 60, 145);
  ctx.stroke();
  ctx.font = `30px ${family}`;
  const lines = [
    `FDR No: ${d.fdrNumber}`,
    `Branch: ${d.branch}`,
    `IFSC: ${d.ifsc}`,
    `Depositor: ${d.depositor}`,
    `Deposit Amount: Rs. ${inrGrouped(d.amount)}/-`,
    `Date of Deposit: ${d.issueDate}`,
    `Maturity Date: ${d.maturityDate}`,
    `In favour of: ${d.inFavourOf}`,
  ];
  let y = 175;
  for (const l of lines) {
    ctx.fillText(l, 60, y);
    y += 56;
  }
  return canvas.toBuffer('image/png');
}

export const DD_MM_YYYY = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
