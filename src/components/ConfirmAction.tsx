import type { ReactElement } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Asks before a destructive action, in BookedSecure's own dialog. Use it
 * instead of window.confirm: embedded and in-app browsers can cancel the
 * browser's box silently, so the action looks like it did nothing.
 */
export function ConfirmAction({
  children, title, description, confirmLabel = "Delete", onConfirm, onOpenChange,
}: {
  /** The button that opens the dialog. */
  children: ReactElement;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  /** Lets a parent popover stay open while the dialog shows. */
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <AlertDialog {...(onOpenChange ? { onOpenChange } : {})}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="z-[80] rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-10">Cancel</AlertDialogCancel>
          <AlertDialogAction className="min-h-10 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
