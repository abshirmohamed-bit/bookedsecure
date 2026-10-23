import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import brandMark from "@/assets/bookedsecure-mark.png.asset.json";
import { Button } from "@/components/ui/button";

/**
 * Kept as a contact page so existing pricing links and bookmarks do not break.
 */
export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Contact BookedSecure" },
      {
        name: "description",
        content: "Contact BookedSecure to discuss access for your service business.",
      },
      { property: "og:title", content: "Contact BookedSecure" },
      {
        property: "og:description",
        content: "Talk with BookedSecure about setting up your service business.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <main className="min-h-screen bg-landing-bg text-landing-copy">
      <nav className="mx-auto flex min-h-20 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12" aria-label="Contact navigation">
        <Link to="/" className="flex items-center gap-2" aria-label="BookedSecure home">
          <img src={brandMark.url} alt="" className="h-9 w-9 object-contain" />
          <span className="font-heading text-base font-semibold text-landing-accent">BookedSecure</span>
        </Link>
        <Button asChild variant="ghost" className="text-landing-muted hover:bg-landing-elevated hover:text-landing-copy">
          <Link to="/"><ArrowLeft aria-hidden="true" /> Home</Link>
        </Button>
      </nav>

      <div className="mx-auto max-w-3xl px-5 pb-24 pt-16 sm:px-8 sm:pb-32 sm:pt-24">
        <header className="text-center">
          <p className="text-sm font-semibold text-landing-accent">Access by invitation</p>
          <h1 className="mt-3 font-heading text-4xl font-semibold leading-tight text-landing-copy sm:text-6xl">
            Talk to us about BookedSecure
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-landing-muted sm:text-lg">
            We are setting up access directly with each business for now. Get in touch and we will
            discuss whether BookedSecure is right for your business and help you get started.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="min-h-12 bg-landing-action px-6 text-landing-action-foreground hover:bg-landing-action-hover">
              <a href="tel:+61466907824">
                <Phone aria-hidden="true" /> Call +61 466 907 824
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="min-h-12 border-landing-accent/30 bg-transparent px-6 text-landing-copy">
              <a href="mailto:bookedsecure@gmail.com?subject=BookedSecure%20access">
                <Mail aria-hidden="true" /> Email BookedSecure
              </a>
            </Button>
          </div>
        </header>
      </div>
    </main>
  );
}
