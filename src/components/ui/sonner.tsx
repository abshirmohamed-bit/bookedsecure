import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-white/80 group-[.toaster]:backdrop-blur-2xl group-[.toaster]:backdrop-saturate-150 group-[.toaster]:text-foreground group-[.toaster]:border-white/70 group-[.toaster]:rounded-xl group-[.toaster]:shadow-[inset_0_1px_0_rgb(255_255_255),0_16px_40px_-16px_oklch(0.25_0.1_258/0.4)]",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
