/**
 * `@name` mentions inside a note.
 *
 * Matching is done against the actual list of people rather than by parsing a
 * token, because display names contain spaces — "@Dana Whitfield" is one
 * mention, not a mention of "Dana" followed by the word "Whitfield". A regex
 * that stops at whitespace would silently mention the wrong person whenever two
 * people share a first name, which is precisely when getting it right matters.
 *
 * Longest name first, so "@Dana Whitfield" is never consumed by a "@Dana" that
 * happens to also exist.
 */

export interface MentionableUser {
  id: string;
  displayName: string;
}

/** One run of note text: either plain, or a mention of somebody. */
export interface MentionSegment<T extends MentionableUser = MentionableUser> {
  text: string;
  /** The person mentioned, or null when this run is ordinary text. */
  user: T | null;
}

/**
 * Splits note text into plain runs and mentions, for rendering.
 *
 * Shares its matching with `findMentions` rather than re-deriving it, so what
 * gets highlighted and what gets notified can never disagree — a name shown in
 * somebody's colour that quietly notified nobody would be worse than no
 * highlight at all.
 */
export function splitMentions<T extends MentionableUser>(
  body: string,
  users: readonly T[],
): MentionSegment<T>[] {
  const spans = matchSpans(body, users);
  if (spans.length === 0) return [{ text: body, user: null }];

  const segments: MentionSegment<T>[] = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.start > cursor) {
      segments.push({ text: body.slice(cursor, span.start), user: null });
    }
    segments.push({ text: body.slice(span.start, span.end), user: span.user });
    cursor = span.end;
  }

  if (cursor < body.length) segments.push({ text: body.slice(cursor), user: null });

  return segments;
}

interface MentionSpan<T extends MentionableUser> {
  start: number;
  end: number;
  user: T;
}

/**
 * Every `@name` in the text, as character ranges.
 *
 * The single source of truth for both notifying and highlighting. Longest name
 * first, so "@Dana Whitfield" claims its characters before a shorter "@Dana"
 * can, and a claimed range is never matched twice.
 */
function matchSpans<T extends MentionableUser>(
  body: string,
  users: readonly T[],
): MentionSpan<T>[] {
  const haystack = body.toLowerCase();

  const byLongestName = [...users].sort(
    (left, right) => right.displayName.length - left.displayName.length,
  );

  const spans: MentionSpan<T>[] = [];
  const claimed = new Array<boolean>(body.length).fill(false);

  for (const user of byLongestName) {
    const needle = `@${user.displayName.toLowerCase()}`;

    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      from = at + 1;

      const end = at + needle.length;

      // The @ must start a word, or an email address like dana@example.com
      // would read as a mention of Dana.
      const before = body[at - 1];
      if (before !== undefined && !/[\s(\[]/.test(before)) continue;

      // And the name must not run straight into more word characters, or
      // "@Dan" would match inside "@Daniel".
      const after = body[end];
      if (after !== undefined && /[\w'-]/.test(after)) continue;

      let overlaps = false;
      for (let index = at; index < end; index += 1) {
        if (claimed[index]) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      for (let index = at; index < end; index += 1) claimed[index] = true;
      spans.push({ start: at, end, user });
    }
  }

  return spans.sort((left, right) => left.start - right.start);
}

/**
 * Who is mentioned. Case-insensitive, and tolerant of trailing punctuation.
 *
 * Each person appears once however many times they are named — a note is one
 * notification, not one per occurrence.
 */
export function findMentions(
  body: string,
  users: readonly MentionableUser[],
): MentionableUser[] {
  const found: MentionableUser[] = [];

  for (const span of matchSpans(body, users)) {
    if (!found.some((existing) => existing.id === span.user.id)) {
      found.push(span.user);
    }
  }

  return found;
}
