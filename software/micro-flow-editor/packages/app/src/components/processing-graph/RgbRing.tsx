/** Decorative only: never implies actual LED state or sends commands. */
export function RgbRing() {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-[4px] shadow-sm"
      style={{
        background:
          "conic-gradient(#ff466a, #ffb44b, #e9ef5b, #48dba2, #40c5f2, #6674ff, #c15dea, #ff466a)",
      }}
    >
      <span className="flex h-full w-full items-center justify-center rounded-full bg-surface shadow-[inset_0_1px_3px_#00000020]">
        <span className="h-2 w-2 rounded-full bg-surface-raised shadow-[inset_0_1px_2px_#ffffff80]" />
      </span>
    </span>
  );
}
