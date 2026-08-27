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

/** Case-insensitive, and tolerant of the trailing punctuation people type. */
export function findMentions(
  body: string,
  users: readonly MentionableUser[],
): MentionableUser[] {
  const haystack = body.toLowerCase();

  const byLongestName = [...users].sort(
    (left, right) => right.displayName.length - left.displayName.length,
  );

  const found: MentionableUser[] = [];
  // Which characters have already been claimed by a longer name, so "@Dana
  // Whitfield" does not also register as "@Dana".
  const claimed = new Array<boolean>(body.length).fill(false);

  for (const user of byLongestName) {
    const needle = `@${user.displayName.toLowerCase()}`;

    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      from = at + 1;

      // A name must not run straight into more word characters, or "@Dan" would
      // match inside "@Daniel".
      const after = body[at + needle.length];
      if (after !== undefined && /[\w'-]/.test(after)) continue;

      let overlaps = false;
      for (let index = at; index < at + needle.length; index += 1) {
        if (claimed[index]) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      for (let index = at; index < at + needle.length; index += 1) {
        claimed[index] = true;
      }

      if (!found.some((existing) => existing.id === user.id)) found.push(user);
      break;
    }
  }

  return found;
}
