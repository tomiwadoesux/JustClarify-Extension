// The gate for the interview's public routes.
//
// lib/api-guard.js cannot be used here: it only admits the extension's own
// chrome-extension:// origin, and this is an ordinary web page. So this file
// holds the web-page equivalents, and they are deliberately cheap and blunt:
//
//   sameOrigin   only our own page may call these routes from a browser
//   burst        a loose per-IP limit. Loose on purpose: a whole class behind
//                campus Wi-Fi shares one address. The share link and the daily
//                caps in the database are the real limits.
//   open         the board's switch, plus a hard env override
//   adminKey     the same JC_ADMIN_KEY convention as the tellme board
//
// Nothing here stores or logs an IP address. The burst limiter keeps addresses
// in memory for one minute and that is all.

import { timingSafeEqual } from 'node:crypto';
import { tellmeBurstLimited } from '@/lib/tellme';
import { hardDisabled } from './config.mjs';
import { enabledFlag } from './backend';

// A browser sends Origin on every POST, including same-origin ones. Requiring
// it to match our own host stops other sites from driving these routes with a
// visitor's browser, and turns away the laziest scripts.
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch (_) {
    return false;
  }
}

export function burst(scope, request, perMinute) {
  return tellmeBurstLimited(`iv-${scope}`, request, perMinute);
}

export async function interviewOpen() {
  if (hardDisabled()) return false;
  return enabledFlag();
}

export function adminKeyMatches(given) {
  const expected = process.env.JC_ADMIN_KEY || '';
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cronAuthorised(request) {
  const expected = process.env.CRON_SECRET || '';
  const given = request.headers.get('authorization') || '';
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
