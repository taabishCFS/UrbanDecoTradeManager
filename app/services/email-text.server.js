/* ============================================================
   EMAIL TEXT HELPERS (pure, no I/O)
============================================================ */

const NO_NEW_TEXT = "(no new text)";

/**
 * Strips the quoted previous email chain from a reply so only the
 * sender's new message is kept.
 */
export function cleanEmailReply(body) {
  if (!body) return NO_NEW_TEXT;

  let text = String(body).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // "On ... wrote:" attribution (the whole line, so a sentence that merely
  // contains "wrote:" is kept) and everything after it. Gmail often wraps
  // it, so "wrote:" may sit on the next line, optionally after the end of
  // the sender's address ("...<trade@x.com>" / "trade@x.com> wrote:").
  text = text.replace(
    /(^|\n)[ \t]*On[ \t](?:[^\n]*wrote:|[^\n]*\n[ \t]*(?:[^\n]*>[ \t]*)?wrote:)[ \t]*(?:\n[\s\S]*)?$/i,
    "$1"
  );

  // "-----Original Message-----" and everything after it
  text = text.replace(/(^|\n)\s*-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i, "$1");

  // Long underscore separator lines (Outlook uses 32) and everything after
  text = text.replace(/(^|\n)[ \t]*_{20,}[ \t]*\n[\s\S]*$/i, "$1");

  // Outlook-style From/Sent/To/Subject header block and everything after it
  text = text.replace(
    /(^|\n)\s*From:\s*.+\n\s*Sent:\s*.+\n\s*To:\s*.+\n\s*Subject:\s*.+[\s\S]*$/i,
    "$1"
  );

  // Lines quoted with ">"
  text = text
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");

  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text || NO_NEW_TEXT;
}

/**
 * Converts an HTML email body to readable plain text.
 */
export function htmlToText(html) {
  if (!html) return "";

  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&#039;": "'",
    "&nbsp;": " ",
  };

  return String(html)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|#039|nbsp);/g, (match) => entities[match])
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Returns the lowercase email address from a header such as
 * `"Ada Smith" <Ada@Example.com>` or a bare address. "" if none.
 */
export function parseEmailAddress(from) {
  if (!from) return "";

  const value = String(from);
  const bracketed = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  const candidate = (bracketed ? bracketed[1] : value).trim().toLowerCase();

  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate) ? candidate : "";
}

/**
 * Prefixes a subject with "Re: " unless it already starts with it.
 */
export function replySubject(subject) {
  const value = (subject || "").toString().trim();

  if (!value) return "Re: Your trade application";

  return /^re:/i.test(value) ? value : `Re: ${value}`;
}
