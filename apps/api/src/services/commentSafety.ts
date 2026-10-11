// Deterministic protection for obvious abuse, including when remote moderation is unavailable.
// Context-sensitive cases continue through the existing Moderator port.
export function isAbusiveComment(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[’‘]/g, "'");
  return (
    /\b(?:fuck(?:ing|er|ers)?|shit|bitch(?:es)?|asshole(?:s)?|cunt(?:s)?|n[i1]gg[e3]r(?:s)?|f[a@]gg[o0]t(?:s)?)\b/i.test(
      normalized,
    ) ||
    /\b(?:you(?:'re| are)?|u(?: r)?)\s+(?:so\s+|a\s+|an\s+)?(?:stupid|idiot|worthless|disgusting|ugly|pathetic|loser|fat)\b/i.test(
      normalized,
    ) ||
    /\b(?:kill yourself|you should die|shut (?:the hell )?up|i(?:'ll| will) kill you)\b/i.test(normalized)
  );
}
