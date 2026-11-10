// The model calls for the interview, through the Vercel AI Gateway.
//
// Everything here returns a value or null. Nothing throws to its caller and no
// upstream error text is passed on: the engine treats null as "the model did
// not help this time" and falls back to written questions, the keyword floor
// or a retry from the board.
//
// THE LADDER. This repo had never used native structured output (the older
// routes talk to the gateway's OpenAI-compatible endpoint, which rejects
// response_format), so it is not assumed to work. Each structured call tries:
//   1. generateText + Output.object            recorded as via 'schema'
//   2. the same model, shape described in the
//      prompt, parsed with parseLoose            recorded as via 'prompt'
// and the engine supplies rung 3, a written question ('script'). The board
// shows the mix, so a provider that quietly stops honouring schemas is visible.
//
// PRIVACY. Every call asks the gateway for zero-data-retention routing, so a
// student's words are only sent to providers that do not keep them. If no such
// provider is available the call fails and the ladder moves on; it never
// widens to a provider that retains data.
//
// Both gpt-oss models reason before answering. A tight token cap is spent on
// reasoning and returns an empty reply, so reasoning is set low and the caps
// are generous.

import { generateText, Output, experimental_transcribe as transcribe } from 'ai';
import { MODELS } from './config.mjs';
import { QuestionOut, SafetyOut, SummaryOut, parseLoose } from './schema.mjs';
import {
  INTERVIEWER_SYSTEM,
  interviewerPrompt,
  SAFETY_SYSTEM,
  safetyPrompt,
  EXTRACTOR_SYSTEM,
  extractorPrompt,
} from './prompts.mjs';

function gatewayOptions(kind) {
  return { gateway: { zeroDataRetention: true, tags: ['interview', kind] } };
}

function note(kind, error) {
  // Short and local. Never the student's text, never the upstream body.
  console.error(`[interview] ${kind}`, String(error?.name || 'error'), String(error?.message || error).slice(0, 160));
}

async function structured({ kind, model, system, prompt, shapedPrompt, schema, name, maxOutputTokens, temperature, timeoutMs, reasoning = 'low' }) {
  try {
    const result = await generateText({
      model,
      system,
      prompt,
      output: Output.object({ schema, name }),
      reasoning,
      temperature,
      maxOutputTokens,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(timeoutMs),
      providerOptions: gatewayOptions(kind),
    });
    const checked = schema.safeParse(result.output);
    if (checked.success) return { data: checked.data, via: 'schema' };
  } catch (error) {
    note(`${kind} schema`, error);
  }

  try {
    const result = await generateText({
      model,
      system,
      prompt: shapedPrompt,
      reasoning,
      temperature: 0,
      maxOutputTokens,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(timeoutMs),
      providerOptions: gatewayOptions(kind),
    });
    const data = parseLoose(result.text, schema);
    if (data) return { data, via: 'prompt' };
  } catch (error) {
    note(`${kind} prompt`, error);
  }
  return null;
}

// `onEvent` exists for the live eval, which counts how often each rung was used.
export function createLlm({ onEvent = () => {} } = {}) {
  return {
    async question({ turns, topic }) {
      const result = await structured({
        kind: 'interviewer',
        model: MODELS.interviewer,
        system: INTERVIEWER_SYSTEM,
        prompt: interviewerPrompt({ turns, topic }),
        shapedPrompt: interviewerPrompt({ turns, topic, withShape: true }),
        schema: QuestionOut,
        name: 'next_question',
        maxOutputTokens: 900,
        temperature: 0.4,
        timeoutMs: 12_000,
      });
      onEvent({ kind: 'question', via: result?.via || null });
      return result;
    },

    // One rung only. The policy already asks for JSON, a second attempt would
    // double the latency of every turn, and the keyword floor is the backstop.
    async safety({ text }) {
      try {
        const result = await generateText({
          model: MODELS.safety,
          system: SAFETY_SYSTEM,
          prompt: safetyPrompt(text),
          reasoning: 'low',
          temperature: 0,
          maxOutputTokens: 600,
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(8_000),
          providerOptions: gatewayOptions('safety'),
        });
        const data = parseLoose(result.text, SafetyOut);
        onEvent({ kind: 'safety', ok: !!data });
        return data;
      } catch (error) {
        note('safety', error);
        onEvent({ kind: 'safety', ok: false });
        return null;
      }
    },

    async summary({ turns }) {
      const result = await structured({
        kind: 'extractor',
        model: MODELS.extractor,
        system: EXTRACTOR_SYSTEM,
        prompt: extractorPrompt({ turns }),
        shapedPrompt: extractorPrompt({ turns, withShape: true }),
        schema: SummaryOut,
        name: 'interview_summary',
        // Medium, not low. At low the model skimmed: given a student who kept
        // answering a different question from the one asked, it returned no
        // topics at all, three runs out of three. At medium it found all four,
        // every run. This call runs after the student has left, so the extra
        // three seconds cost nobody anything.
        reasoning: 'medium',
        maxOutputTokens: 4000,
        temperature: 0,
        timeoutMs: 45_000,
      });
      onEvent({ kind: 'summary', via: result?.via || null });
      return result;
    },

    // The SDK reads the container from the bytes (webm from Android and
    // desktop, mp4 from iOS), so no media type is passed.
    async transcribe({ audio }) {
      for (const model of MODELS.transcribe) {
        try {
          const result = await transcribe({
            model,
            audio,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(20_000),
          });
          const text = String(result?.text || '').trim();
          onEvent({ kind: 'transcribe', model, ok: !!text });
          if (text) return { text, seconds: result.durationInSeconds || 0, model };
        } catch (error) {
          note(`transcribe ${model}`, error);
          onEvent({ kind: 'transcribe', model, ok: false });
        }
      }
      return null;
    },
  };
}
