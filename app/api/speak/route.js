// Spoken replies on the project's key.
//
// The browser's own speechSynthesis is free, instant and available offline, so
// it stays the default and this route is the upgrade — it exists because a
// robotic system voice reading a paragraph aloud is the difference between a
// feature people use and one they turn off. Measured: ~2.5s for a sentence, so
// callers should stream nothing and expect a wait, or fall back locally.
//
// Extension -> here:  POST { text, voice? }   header: x-jc-install
// here -> extension:  audio/mpeg bytes

import { experimental_generateSpeech as generateSpeech } from 'ai';
import { guard, cors } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = 'openai/tts-1';
// Chosen from a fixed set, never passed through: a free-text voice field is a
// way to probe the upstream provider for what else it accepts.
const VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const DEFAULT_VOICE = 'alloy';
// Roughly a long paragraph. Reading a whole article aloud is what the local
// speechSynthesis path is for — it is free and has no length limit.
const MAX_CHARS = 1200;

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get('origin')) });
}

export async function POST(request) {
  const { headers, reject } = await guard(request, { scope: 'tts', perMinute: 15, perDay: 200 });
  if (reject) return reject;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ error: 'Bad request.' }, { status: 400, headers });
  }

  const text = String(body?.text || '').trim().slice(0, MAX_CHARS);
  if (!text) return Response.json({ error: 'Nothing to say.' }, { status: 400, headers });

  const voice = VOICES.has(body?.voice) ? body.voice : DEFAULT_VOICE;

  if (!process.env.AI_GATEWAY_API_KEY) {
    return Response.json({ error: 'Hosted AI is not configured.' }, { status: 503, headers });
  }

  try {
    const result = await generateSpeech({ model: MODEL, text, voice });
    const audio = result?.audio;
    if (!audio?.uint8Array?.length) {
      return Response.json({ error: 'No audio came back.' }, { status: 502, headers });
    }
    return new Response(audio.uint8Array, {
      status: 200,
      headers: {
        ...headers,
        'content-type': audio.mediaType || 'audio/mpeg',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[api/speak]', error);
    return Response.json({ error: "Couldn't read that out." }, { status: 502, headers });
  }
}
