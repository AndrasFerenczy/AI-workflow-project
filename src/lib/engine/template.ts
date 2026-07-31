/** Values a step instruction or argument template can reference. */
export interface TemplateScope {
  input: string;
  steps: Record<string, { output: string }>;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function lookup(path: string, scope: TemplateScope): string | undefined {
  if (path === "input") return scope.input;

  const match = /^steps\.([a-z0-9_]+)\.output$/.exec(path);
  if (match) return scope.steps[match[1]]?.output;

  return undefined;
}

/**
 * Substitutes {{input}} and {{steps.<key>.output}} in step instructions.
 *
 * Unknown placeholders are left verbatim rather than blanked, so a typo shows
 * up in the trace instead of silently producing an empty prompt.
 */
export function renderTemplate(template: string, scope: TemplateScope): string {
  if (!template.includes("{{")) return template;

  return template.replace(PLACEHOLDER, (original, path: string) => {
    const value = lookup(path, scope);
    return value ?? original;
  });
}

/** Placeholders in `template` that do not resolve against `scope`. */
export function findUnresolvedPlaceholders(
  template: string,
  scope: TemplateScope,
): string[] {
  const unresolved = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (lookup(match[1], scope) === undefined) unresolved.add(match[1]);
  }
  return [...unresolved];
}
