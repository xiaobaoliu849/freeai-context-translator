export interface StreamEvent {
  delta?: string;
  done?: boolean;
  result?: { translation: string; detectedLang?: string };
  error?: string;
}

/**
 * Parses complete SSE events (`data: {...}\n\n`) out of a buffer, returning the
 * remaining partial buffer for the next call.
 */
export function consumeSSE(buffer: string): { events: StreamEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events: StreamEvent[] = [];
  for (const part of parts) {
    const line = part.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      events.push(JSON.parse(raw) as StreamEvent);
    } catch {
      // Skip partial/malformed events
    }
  }
  return { events, rest };
}

/**
 * Incrementally extracts the "translation" value from a streaming JSON payload.
 * The prompt asks the model to emit `translation` as the first key on a single
 * line, so as more of the raw text arrives the captured string grows. Returns
 * null until the `"translation": "` marker has been seen; `complete` is false
 * until the closing quote arrives.
 */
export function extractPartialTranslation(raw: string): { text: string; complete: boolean } | null {
  const keyMatch = raw.match(/"translation"\s*:\s*"/);
  if (!keyMatch || keyMatch.index === undefined) return null;

  const start = keyMatch.index + keyMatch[0].length;
  let out = '';
  let i = start;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') {
      // Escape sequence: wait for the escaped char to arrive
      if (i + 1 >= raw.length) break;
      const next = raw[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else out += next; // \" \\ \/ etc.
      i += 2;
    } else if (ch === '"') {
      return { text: out, complete: true };
    } else {
      out += ch;
      i++;
    }
  }
  return { text: out, complete: false };
}
