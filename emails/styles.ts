import type { CSSProperties } from 'react';

export type EmailLocale = 'en' | 'ja';

/**
 * Email clients strip stylesheets, so every rule is inline. The layout is a
 * single centered column with generous type: most recipients open this on a
 * phone at a venue, in a hurry, to read one number.
 */
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', 'Segoe UI', Roboto, sans-serif";

const INK = '#141414';
const MUTED = '#5f5f5f';
const RULE = '#e4e4e4';

export const emailStyles = {
  body: {
    backgroundColor: '#f5f5f4',
    fontFamily: FONT_STACK,
    margin: '0',
    padding: '24px 0',
  },
  container: {
    backgroundColor: '#ffffff',
    border: `1px solid ${RULE}`,
    borderRadius: '8px',
    margin: '0 auto',
    maxWidth: '560px',
    padding: '32px 28px',
  },
  brand: {
    color: INK,
    fontSize: '14px',
    fontWeight: 700,
    letterSpacing: '0.16em',
    margin: '0 0 24px',
    textTransform: 'uppercase',
  },
  heading: {
    color: INK,
    fontSize: '22px',
    fontWeight: 700,
    lineHeight: '1.4',
    margin: '0 0 16px',
  },
  paragraph: {
    color: INK,
    fontSize: '16px',
    lineHeight: '1.7',
    margin: '0 0 16px',
  },
  muted: {
    color: MUTED,
    fontSize: '14px',
    lineHeight: '1.7',
    margin: '0 0 12px',
  },
  actionSection: {
    margin: '24px 0',
  },
  button: {
    backgroundColor: INK,
    borderRadius: '6px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '16px',
    fontWeight: 600,
    padding: '14px 28px',
    textDecoration: 'none',
  },
  url: {
    margin: '0 0 20px',
    wordBreak: 'break-all',
  },
  urlLink: {
    color: MUTED,
    fontSize: '13px',
    textDecoration: 'underline',
  },
  numberPanel: {
    backgroundColor: '#faf9f7',
    border: `1px solid ${RULE}`,
    borderRadius: '8px',
    margin: '0 0 24px',
    padding: '28px 20px',
    textAlign: 'center',
  },
  numberLabel: {
    color: MUTED,
    fontSize: '14px',
    letterSpacing: '0.08em',
    margin: '0 0 10px',
    textTransform: 'uppercase',
  },
  number: {
    color: INK,
    fontSize: '40px',
    fontWeight: 700,
    letterSpacing: '0.02em',
    lineHeight: '1.2',
    margin: '0',
  },
} satisfies Record<string, CSSProperties>;
