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
 *
 * Also safely ignores <think>...</think> blocks from reasoning models (e.g. DeepSeek-R1).
 */
export function extractPartialTranslation(raw: string): { text: string; complete: boolean } | null {
  if (!raw) return null;

  // If a reasoning/think block is in progress and not closed yet, don't show think stream as translation
  if (raw.includes('<think>') && !raw.includes('</think>')) {
    return null;
  }

  // Strip completed <think>...</think> blocks
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trimStart();

  const keyMatch = cleaned.match(/"translation"\s*:\s*"/);
  if (keyMatch && keyMatch.index !== undefined) {
    const start = keyMatch.index + keyMatch[0].length;
    let out = '';
    let i = start;
    while (i < cleaned.length) {
      const ch = cleaned[i];
      if (ch === '\\') {
        // Escape sequence: wait for the escaped char to arrive
        if (i + 1 >= cleaned.length) break;
        const next = cleaned[i + 1];
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

  // If the model did not output JSON (e.g. smaller local model outputting raw translation directly)
  if (cleaned && !cleaned.startsWith('{') && !cleaned.startsWith('```')) {
    return { text: cleaned, complete: false };
  }

  return null;
}
