// Accurate transcription for the voice layer, on the project's key.
//
// This is NOT the fast path. Chrome's Web Speech API transcribes locally while
// the user is still speaking, so a command lands in ~50ms for free. This route
// exists for what Web Speech gets wrong — proper nouns, product names, an
// accent it handles badly — and is called only after the local transcript has
// already failed to match anything. Measured round trip: ~850ms.
//
// Extension -> here:  POST multipart/form-data, field "audio" (webm/opus blob)
//                     header: x-jc-install
// here -> extension:  { text }

import { experimental_transcribe as transcribe } from 'ai';
import { guard, cors } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = 'openai/gpt-4o-transcribe';
// A push-to-talk command is seconds long. Anything much larger is either a bug
// or someone using this endpoint as a free transcription service.
const MAX_BYTES = 2_000_000;

export async function OPTIONS(request) {
  // cors() only — a preflight must never count against anyone's meter.
  return new Response(null, { status: 204, headers: cors(request.headers.get('origin')) });
}

export async function POST(request) {
  const { headers, reject } = await guard(request, { scope: 'stt', perMinute: 20, perDay: 300 });
  if (reject) return reject;

  let audio;
  let hint = '';
  try {
    const form = await request.formData();
    const file = form.get('audio');
    if (!file || typeof file === 'string') {
      return Response.json({ error: 'No audio.' }, { status: 400, headers });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'That recording is too long.' }, { status: 413, headers });
    }
    audio = new Uint8Array(await file.arrayBuffer());
    // Optional vocabulary hint from the page: headings, link labels, the site
    // name. OpenAI's transcription API biases toward words in `prompt`, which
    // is the documented lever for exactly this failure — a brand name the
    // model has never seen coming back as ordinary English.
    hint = String(form.get('context') || '').slice(0, 400).trim();
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400, headers });
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json({ error: 'Hosted AI is not configured.' }, { status: 503, headers });
  }

  try {
    const result = await transcribe({
      model: MODEL,
      audio,
      ...(hint && { providerOptions: { openai: { prompt: hint } } }),
    });
    return Response.json({ text: (result?.text || '').trim() }, { status: 200, headers });
  } catch (error) {
    console.error('[api/transcribe]', error);
    return Response.json(
      { error: "Couldn't make out that recording." },
      { status: 502, headers },
    );
  }
}
