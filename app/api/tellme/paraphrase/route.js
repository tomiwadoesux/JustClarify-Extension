// The "tidy my words" button. Paraphrase only: same meaning, same rough
// length, as many of the person's own words kept as possible. The person sees
// the result in their textbox BEFORE submitting and can undo — the server
// never rewrites anything behind their back.

import { tellmeAI, tellmeBurstLimited } from '@/lib/tellme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PARAPHRASE_SYSTEM =
  'You tidy up one short problem report so it reads clearly. Keep the meaning exactly, keep as ' +
  'many of the writer\'s own words as possible, and keep it about the same length — never longer ' +
  'than the original plus a few words, never a summary. Fix grammar, spelling and word order ' +
  'only. Never add details, opinions or apologies that are not in the original, and never use ' +
  'em dashes. Reply with the tidied text alone: no quotes, no preamble.';

export async function POST(request) {
  if (tellmeBurstLimited('paraphrase', request, 8)) {
    return Response.json({ error: 'One tidy-up at a time. Try again in a few seconds.' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400 });
  }

  const text = String(body?.text || '').trim().slice(0, 2000);
  if (text.length < 3) {
    return Response.json({ error: 'Write something first, then tidy it.' }, { status: 400 });
  }

  const tidied = await tellmeAI(PARAPHRASE_SYSTEM, text, 600);
  if (!tidied) {
    return Response.json(
      { error: "The tidy-up isn't available right now. Your words are fine as they are." },
      { status: 503 },
    );
  }
  return Response.json({ text: tidied });
}
