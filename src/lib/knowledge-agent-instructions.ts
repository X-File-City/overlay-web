/**
 * Shared system text for Ask / Act so models reliably use knowledge tools.
 */

/** Instructs the model when to call save_memory (preferences, facts, standing instructions). */
export const MEMORY_SAVE_PROTOCOL = [
  'Memory tool (save_memory) — required behavior:',
  '- When the user states a personal fact, preference, goal, identity detail, or standing instruction they would reasonably want recalled in a future chat, you MUST call save_memory with one short factual line (e.g. "User likes pasta." or "User prefers British spelling.").',
  '- Examples that REQUIRE save_memory: food or style preferences; job or role; timezone or locale; "always do X"; durable constraints on how they want answers.',
  '- Do NOT use save_memory for pure small talk, one-off tasks, hypotheticals, or clearly transient remarks with no lasting meaning.',
  '- Call save_memory in the same turn as your reply when applicable (before or after your answer text in the tool loop); never skip it when they clearly share something to remember.',
].join('\n')

/** User attached documents this turn — already indexed; steer search_knowledge. */
export function indexedFilesSystemNote(fileNames: string[]): string {
  if (fileNames.length === 0) return ''
  const list = fileNames.map((n) => `"${n}"`).join(', ')
  return (
    `\n\n[Documents indexed this turn: ${list}. They are saved as notebook files and embedded for hybrid search. ` +
    `You MUST call search_knowledge with targeted queries (titles, section names, or the user's question) before answering — do not claim you cannot access these files. ` +
    `Snippets may not appear in AUTO_RETRIEVED_KNOWLEDGE for this message.]`
  )
}

/**
 * Clone UI messages and append a model-only text part to the latest user turn so the model
 * always sees explicit attachment context (client bubbles stay clean).
 */
export function cloneMessagesWithIndexedFileHint<T extends { role: string; parts?: unknown[] }>(
  inputMessages: T[],
  fileNames: string[],
): T[] {
  const names = fileNames.filter((n) => typeof n === 'string' && n.trim().length > 0)
  if (names.length === 0) return inputMessages

  const hint =
    `[Notebook files indexed for this turn: ${names.map((n) => `"${n}"`).join(', ')}. ` +
    `Call search_knowledge with relevant queries to read their content before you answer. ` +
    `Do not tell the user you cannot see or open these documents.]`

  const msgs = inputMessages.map((m) => ({
    ...m,
    parts: m.parts ? m.parts.map((p) => (typeof p === 'object' && p !== null ? { ...p } : p)) : undefined,
  })) as T[]

  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.role !== 'user') continue
    const prev = msgs[i]!.parts ? [...msgs[i]!.parts!] : []
    prev.push({ type: 'text', text: hint } as (typeof prev)[number])
    msgs[i] = { ...msgs[i]!, parts: prev }
    break
  }

  return msgs
}
