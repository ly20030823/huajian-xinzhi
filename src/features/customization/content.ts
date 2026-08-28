export function parseGreetings(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*+]\s+(.+?)\s*$/)?.[1] ?? "")
    .filter((line) => line.length > 0);
}

export function pickGreeting(greetings: string[], random = Math.random): string | null {
  if (greetings.length === 0) return null;
  const index = Math.min(greetings.length - 1, Math.floor(random() * greetings.length));
  return greetings[index] ?? null;
}

export function pickNextGreeting(
  greetings: string[],
  currentGreeting: string,
  random = Math.random,
): string | null {
  if (greetings.length <= 1) return pickGreeting(greetings, random);
  return pickGreeting(
    greetings.filter((greeting) => greeting !== currentGreeting),
    random,
  );
}

export function renderAboutMarkdown(markdown: string, version: string, year: number): string {
  return markdown
    .split("{{version}}")
    .join(version || "…")
    .split("{{year}}")
    .join(String(year));
}
