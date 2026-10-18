/**
 * Extract the opaque card token from a scanned QR payload (ADR-004).
 * Accepts `https://hayattek.com/c/<token>`, dev URLs such as
 * `http://localhost:3100/c/<token>`, or a bare token.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function extractCardToken(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const match = text.match(/^https?:\/\/[^/\s]+\/c\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i);
  if (match) return match[1];
  if (TOKEN_RE.test(text) && !/^\d+$/.test(text)) return text;
  return null;
}

/** A 10-digit health number typed by hand (spaces allowed). */
export function parseHealthNumber(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  // Accept Arabic-Indic digits too.
  const latin = digits.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  return /^\d{10}$/.test(latin) ? latin : null;
}
