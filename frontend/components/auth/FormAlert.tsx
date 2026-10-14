/** Form-level error banner (net-new / risk palette). */
export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="border border-net-new-border bg-net-new-bg px-3 py-2 text-sm text-net-new">
      {message}
    </p>
  );
}
