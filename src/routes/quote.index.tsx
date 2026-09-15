import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/quote/")({
  head: () => ({
    meta: [
      { title: "Enquiry forms — BookedSecure" },
      {
        name: "description",
        content:
          "Each BookedSecure business has its own enquiry link. Use the link your service provider gave you to send your request.",
      },
      { property: "og:title", content: "Enquiry forms — BookedSecure" },
      {
        property: "og:description",
        content: "Use the enquiry link your service provider gave you to request a quote or service.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QuoteIndexPage,
});

// Deliberately no default tenant: an ambiguous /quote must never route an enquiry
// to an arbitrary business.
function QuoteIndexPage() {
  return (
    <main className="brand-wash flex min-h-screen items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-md overflow-hidden">
        <div className="border-b border-border p-5">
          <p className="text-xs font-semibold text-primary">BookedSecure</p>
          <h1 className="mt-1 page-heading">Choose your service provider's enquiry link</h1>
        </div>
        <div className="p-5">
          <p className="mt-2 text-sm text-muted-foreground">
            Enquiry forms are specific to each business, so this page can't send a request on its
            own. Open the link your provider gave you — it looks like{" "}
            <code className="rounded bg-secondary px-1 py-0.5 text-xs">/quote/their-business</code>.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            If you don't have the link, contact the business directly and they'll send it to you.
          </p>
        </div>
      </div>
    </main>
  );
}
