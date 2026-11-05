import './loading-indicator.css';

export function LoadingIndicator({ label }: { label: string }) {
  return (
    <span className="loading-indicator" role="status" aria-label={label}>
      <span className="loading-indicator-ring" aria-hidden="true" />
    </span>
  );
}
