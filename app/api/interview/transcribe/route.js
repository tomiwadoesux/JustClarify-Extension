// Turn a voice note into text for the student to review.
//
// POST multipart/form-data: token, turn, audio   ->   { text }
//
// The text comes back already redacted and is NOT stored here. The student
// reads it, fixes anything the transcription got wrong, and sends it as a
// normal turn. That review step matters most for exactly the students
// transcription serves worst, whose accent or second language it mishears.
//
// The audio lives in memory for the length of this request. It is never
// written anywhere and never logged, and it only goes to transcription models
// that keep nothing (see MODELS in lib/interview/config.mjs).
//
// This is separate from /api/transcribe on purpose. That route belongs to the
// extension and its guard only admits the extension's origin.

import { LIMITS } from '@/lib/interview/config.mjs';
import { GATE, ERRORS } from '@/lib/interview/copy.mjs';
import { sniffAudio } from '@/lib/interview/audio.mjs';
import { sameOrigin, burst, json } from '@/lib/interview/guard';
import { interviewEngine } from '@/lib/interview/backend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Forbidden.' }, 403);
  if (burst('stt', request, 240)) return json({ error: ERRORS.tooMany }, 429);

  // Refuse an oversized body before reading it.
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > LIMITS.maxAudioBytes + 20_000) return json({ error: ERRORS.audioTooLong }, 413);

  let token;
  let turn;
  let audio;
  try {
    const form = await request.formData();
    token = String(form.get('token') || '');
    turn = Number(form.get('turn'));
    const file = form.get('audio');
    if (!file || typeof file === 'string') return json({ error: ERRORS.audioBad }, 400);
    if (file.size > LIMITS.maxAudioBytes) return json({ error: ERRORS.audioTooLong }, 413);
    audio = new Uint8Array(await file.arrayBuffer());
  } catch (_) {
    return json({ error: 'Bad request.' }, 400);
  }

  // Under a second of sound is a mis-tap, not an answer.
  if (audio.byteLength < 1500) return json({ error: ERRORS.audioBad }, 400);
  if (!sniffAudio(audio)) return json({ error: ERRORS.audioBad }, 415);

  try {
    const result = await interviewEngine.transcribe({ token, turn, audio });
    switch (result.status) {
      case 'text':
        return json({ text: result.text });
      case 'unheard':
        return json({ error: ERRORS.audioBad }, 422);
      case 'stt-limit':
        return json({ error: ERRORS.audioLimit }, 429);
      case 'resync':
        return json({ error: ERRORS.generic, turn: result.turn, question: result.question }, 409);
      case 'cap':
        return json({ error: GATE.full, closed: true }, 503);
      default:
        return json({ error: ERRORS.session, ended: true }, 401);
    }
  } catch (error) {
    console.error('[api/interview/transcribe]', String(error?.message || error).slice(0, 120));
    return json({ error: ERRORS.audioBad }, 503);
  }
}
