import { randomBytes } from "node:crypto";

const PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

export function generateChapterPassword(length = 16): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join(
    ""
  );
}

// chapman-accounts.internal is a synthetic, non-deliverable domain used
// only as a unique Auth identifier — these accounts never receive email.
export function chapterLoginEmail(chapterKey: string): string {
  return `chapter-${chapterKey}@chapman-accounts.internal`;
}
