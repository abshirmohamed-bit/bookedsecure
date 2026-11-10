import { Button } from "@/components/ui/button";

/**
 * Apple's rules fix the button to a black or white fill with the matching
 * title, so the colours are literal here (and in `.btn-apple`) rather than
 * theme tokens.
 *
 * The title is shown alone for now: Apple only permits its own logo artwork
 * from Apple Design Resources, and that file is not in the project yet. Once
 * it is supplied it goes in front of the title as a decorative `<img alt="">`.
 */
export function AppleSignInButton({
  onClick,
  disabled,
  label = "Continue with Apple",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className="btn-apple h-10 w-full rounded-md px-3"
    >
      <span>{label}</span>
    </Button>
  );
}
