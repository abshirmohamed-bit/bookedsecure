import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/quote/")({
  head: () => ({
    meta: [
      { title: "Enquiry forms — BookedSecure" },
      {
        name: "description",
        content:
          "Each BookedSecure business has its own enquiry link. Use the link your detailer gave you to send your request.",
      },
      { property: "og:title", content: "Enquiry forms — BookedSecure" },
      {
        property: "og:description",
        content: "Use the enquiry link your detailer gave you to request a quote or service.",
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
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-md p-8">
        <h1 className="text-lg font-semibold">Choose your detailer's enquiry link</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enquiry forms are specific to each business, so this page can't send a request on its own.
          Open the link your detailer gave you — it looks like{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-xs">/quote/their-business</code>.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          If you don't have the link, contact the business directly and they'll send it to you.
        </p>
      </div>
    </main>
  );
}
