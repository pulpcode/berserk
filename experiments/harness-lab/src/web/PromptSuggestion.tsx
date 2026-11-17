export function PromptSuggestion({ announcement }: { announcement: string }) {
  return <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>;
}
