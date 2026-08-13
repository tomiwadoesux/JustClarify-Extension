// Screenshot upload for /tellme reports.
//
// The image lands in the PUBLIC 'tellme' bucket, because the whole point is
// that the board shows it to everyone next to the report. The form says so
// before anyone picks a file — an upload here is a publish, not an attachment.
//
// Server-side constraints, not client-side politeness: type checked from the
// bytes' magic numbers rather than the filename, 3MB cap, random name so a
// crafted filename can neither collide nor script anything.

import { tellmeBurstLimited } from '@/lib/tellme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 3 * 1024 * 1024;

// Magic numbers for the three formats browsers actually produce.
function sniffImage(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    bytes.length > 12 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

export async function POST(request) {
  if (tellmeBurstLimited('upload', request, 6)) {
    return Response.json({ error: 'One screenshot at a time.' }, { status: 429 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return Response.json({ error: 'Uploads are not available right now.' }, { status: 503 });
  }

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  const file = form.get('image');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'Attach an image.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'Keep the screenshot under 3MB.' }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) {
    return Response.json({ error: 'PNG, JPEG or WebP screenshots only.' }, { status: 400 });
  }

  const name = `reports/${crypto.randomUUID()}.${kind.ext}`;
  const stored = await fetch(`${url}/storage/v1/object/tellme/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': kind.mime,
      'x-upsert': 'false',
    },
    body: bytes,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!stored || !stored.ok) {
    if (stored) console.error('[tellme] upload', stored.status, await stored.text().catch(() => ''));
    return Response.json({ error: "The upload didn't stick. Try again." }, { status: 503 });
  }

  return Response.json({ url: `${url}/storage/v1/object/public/tellme/${name}` });
}
