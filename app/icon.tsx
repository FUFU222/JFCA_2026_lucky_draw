import path from 'node:path';
import fs from 'node:fs/promises';
import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const contentType = 'image/png';
export const size = {
  width: 64,
  height: 64
};

const ICON_DIR = path.join(process.cwd(), 'public', 'favicon');
const ICON_CANDIDATES = [
  { filename: 'icon.svg', mime: 'image/svg+xml' },
  { filename: 'icon.png', mime: 'image/png' },
  { filename: 'icon.jpg', mime: 'image/jpeg' },
  { filename: 'icon.jpeg', mime: 'image/jpeg' },
  { filename: 'icon.webp', mime: 'image/webp' }
];

async function loadCustomIcon(): Promise<{ dataUri: string } | null> {
  for (const candidate of ICON_CANDIDATES) {
    try {
      const filePath = path.join(ICON_DIR, candidate.filename);
      const data = await fs.readFile(filePath);
      const base64 = data.toString('base64');
      return { dataUri: `data:${candidate.mime};base64,${base64}` };
    } catch {
      // file missing, try next candidate
    }
  }
  return null;
}

export default async function Icon() {
  const customIcon = await loadCustomIcon();

  if (customIcon) {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <img
            src={customIcon.dataUri}
            alt="App icon"
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      ),
      size
    );
  }

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          background: '#111111',
          color: '#ffffff',
          borderRadius: '50%'
        }}
      >
        L
      </div>
    ),
    size
  );
}
