// Turn a list of interview sessions into the numbers the board shows.
//
// Pure, so it is unit-tested and so the board and any export agree. The one
// question this exists to answer is "which problems did students raise without
// being asked, and how many of them", which is why unprompted counts sit next
// to raised counts for every topic rather than in a separate view.

import { TOPICS } from './config.mjs';
import { refCode } from './ref.mjs';

const SUMMARISABLE = new Set(['done', 'ended', 'abandoned']);

function emptyTopic(topic) {
  return {
    key: topic.key,
    label: topic.label,
    raised: 0,
    unprompted: 0,
    severe: 0,
    severitySum: 0,
    quotes: [],
  };
}

export function aggregate(sessions = []) {
  const byStatus = {};
  const topics = new Map(TOPICS.map((t) => [t.key, emptyTopic(t)]));
  const tools = new Map();
  const levels = {};
  const other = [];
  let withSummary = 0;
  let degraded = 0;
  let pending = 0;
  let failed = 0;

  for (const session of sessions) {
    byStatus[session.status] = (byStatus[session.status] || 0) + 1;
    if (session.safety_degraded) degraded += 1;
    if (session.extract_error) failed += 1;
    // Waiting = it could be summarised and has not been. A session with no
    // answers has nothing to summarise, and one that ended on the support
    // message is deliberately left alone.
    if (SUMMARISABLE.has(session.status) && session.turn > 1 && !session.extracted_at) pending += 1;

    const summary = session.summary;
    if (!summary || summary.empty) continue;
    withSummary += 1;
    const ref = refCode(session.id);

    for (const entry of summary.topics || []) {
      const row = topics.get(entry.topic);
      if (!row) continue;
      row.raised += 1;
      if (entry.unprompted) row.unprompted += 1;
      if (entry.severity >= 3) row.severe += 1;
      row.severitySum += Number(entry.severity) || 0;
      row.quotes.push({
        quote: entry.quote,
        severity: entry.severity,
        unprompted: !!entry.unprompted,
        note: entry.note || '',
        ref,
      });
    }

    for (const entry of summary.other || []) {
      other.push({ problem: entry.problem, quote: entry.quote, ref });
    }

    for (const name of summary.tools || []) {
      const key = String(name).toLowerCase().replace(/\s+/g, '');
      if (!key) continue;
      const row = tools.get(key) || { name: String(name), count: 0 };
      row.count += 1;
      tools.set(key, row);
    }

    if (summary.level) levels[summary.level] = (levels[summary.level] || 0) + 1;
  }

  const topicRows = [...topics.values()]
    .map((row) => ({
      key: row.key,
      label: row.label,
      raised: row.raised,
      unprompted: row.unprompted,
      severe: row.severe,
      avgSeverity: row.raised ? Math.round((row.severitySum / row.raised) * 10) / 10 : 0,
      // Unprompted and severe first: those are the quotes worth reading.
      quotes: row.quotes
        .sort((a, b) => Number(b.unprompted) - Number(a.unprompted) || b.severity - a.severity)
        .slice(0, 12),
    }))
    // The ranking that matters: raised without being asked, then raised at all.
    .sort((a, b) => b.unprompted - a.unprompted || b.raised - a.raised);

  return {
    total: sessions.length,
    byStatus,
    withSummary,
    pending,
    failed,
    degraded,
    topics: topicRows,
    other: other.slice(0, 60),
    tools: [...tools.values()].sort((a, b) => b.count - a.count).slice(0, 30),
    levels,
  };
}
