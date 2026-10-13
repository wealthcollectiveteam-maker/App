/**
 * Squad invite codes.
 *
 * A code is read aloud to a friend and typed back in, or pasted out of a
 * text message with whatever came along with it — a trailing newline, a
 * leading space, the wrong case. join_squad() compares against `upper(code)`,
 * so normalising here means the same string reaches the server however it
 * was carried.
 */
export function normalizeInviteCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}
