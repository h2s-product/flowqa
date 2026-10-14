/**
 * Berkas contoh untuk step "Upload file": dibuat sekali di folder sementara,
 * jenisnya dari ekstensi nama berkas atau dari atribut `accept` kolom unggah.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);
const CONTENT: Record<string, Buffer> = {
  pdf: PDF,
  png: PNG,
  jpg: JPG,
  jpeg: JPG,
  txt: Buffer.from('Testora sample file\n'),
};

/** Ekstensi yang cocok dengan atribut accept (bawaan PDF). */
function extensionFor(accept: string): string {
  const a = accept.toLowerCase();
  if (!a || a.includes('pdf') || a.includes('*/*')) return 'pdf';
  if (a.includes('png') || a.includes('image/*')) return 'png';
  if (a.includes('jpg') || a.includes('jpeg')) return 'jpg';
  if (a.includes('text') || a.includes('.txt')) return 'txt';
  return 'pdf';
}

export function sampleFile(name: string, accept = ''): { name: string; path: string } {
  const clean = path.basename(name.trim()).replace(/[^\w.-]+/g, '-');
  const given = /\.([a-z0-9]+)$/i.exec(clean)?.[1]?.toLowerCase();
  const ext = given && CONTENT[given] ? given : extensionFor(accept);
  const file =
    given && CONTENT[given] ? clean : `${clean.replace(/\.[^.]*$/, '') || 'testora-sample'}.${ext}`;
  const dir = path.join(os.tmpdir(), 'testora-sample-files');
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) fs.writeFileSync(full, CONTENT[ext]);
  return { name: file, path: full };
}
