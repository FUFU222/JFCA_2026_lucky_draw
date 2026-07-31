import { formatRaffleNumber } from './number';

/**
 * Draws the ticket onto a canvas, so the number can be saved as a picture.
 *
 * Kept out of the component, and free of any DOM lookup, so the geometry can be
 * tested without a browser. The caller passes the font family it read from the
 * live element: `next/font` generates the real family name at build time, so
 * naming it here would quietly fall back to a system face.
 *
 * Sizes are expressed against a logical 600x300 ticket, which is what the page
 * shows scaled to the width of the phone. They are chosen to land on the same
 * rendered sizes as the markup version, because the picture replaces it in
 * place and a visible jump would be the visitor's first sight of their number.
 */

export const TICKET_WIDTH = 600;
export const TICKET_HEIGHT = 300;

// Kept in step with globals.css by hand. A mismatch here is cosmetic.
const BRAND_ACCENT = '#c8102e';
const BRAND_TINT = '#fdf1f2';
const FOREGROUND = '#171717';
const MUTED = '#6b7280';

export interface TicketDrawing {
  number: bigint;
  eventTitle: string;
  fontFamily: string;
}

export function ticketFileName(number: bigint): string {
  // The raw digits, not `formatRaffleNumber()`: its "No. 10000" display form
  // has a space and a period, which land in the saved file's name verbatim.
  return `lucky-draw-${number}.png`;
}

/**
 * Renders at `scale` times the logical size, so what lands in the camera roll
 * is not a blurred copy of a phone screen.
 */
export function drawTicket(canvas: HTMLCanvasElement, drawing: TicketDrawing, scale = 3): void {
  canvas.width = TICKET_WIDTH * scale;
  canvas.height = TICKET_HEIGHT * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser has no 2D canvas context');

  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const radius = 28;
  const border = 4;
  const centre = TICKET_WIDTH / 2;
  const font = drawing.fontFamily;

  ctx.fillStyle = BRAND_TINT;
  roundedRect(ctx, 0, 0, TICKET_WIDTH, TICKET_HEIGHT, radius);
  ctx.fill();

  ctx.strokeStyle = BRAND_ACCENT;
  ctx.lineWidth = border;
  roundedRect(
    ctx,
    border / 2,
    border / 2,
    TICKET_WIDTH - border,
    TICKET_HEIGHT - border,
    radius - border / 2,
  );
  ctx.stroke();

  // `letterSpacing` is recent enough that it cannot be assumed. Without it the
  // two tracked lines are merely tighter, so there is nothing to fall back to.
  const tracked = 'letterSpacing' in ctx;

  if (tracked) ctx.letterSpacing = '4px';
  ctx.fillStyle = MUTED;
  ctx.font = `500 19px ${font}`;
  ctx.fillText('YOUR LUCKY DRAW NUMBER', centre, 78);
  if (tracked) ctx.letterSpacing = '0px';

  ctx.fillStyle = FOREGROUND;
  ctx.font = `700 84px ${font}`;
  ctx.fillText(formatRaffleNumber(drawing.number), centre, 150);

  ctx.fillStyle = MUTED;
  ctx.font = `400 20px ${font}`;
  ctx.fillText(drawing.eventTitle, centre, 212);

  if (tracked) ctx.letterSpacing = '3px';
  ctx.fillStyle = BRAND_ACCENT;
  ctx.font = `600 19px ${font}`;
  ctx.fillText('LIVAPON', centre, 246);
  if (tracked) ctx.letterSpacing = '0px';
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  // `roundRect` is not old enough to rely on at a festival, where the oldest
  // phone in the crowd is the one that decides.
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
