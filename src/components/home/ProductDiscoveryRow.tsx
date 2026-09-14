import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, BadgeInfo, PackageSearch, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import detailingToolkit from "@/assets/detailing-toolkit.jpg";
import { Button } from "@/components/ui/button";
import {
  listAffiliateProducts,
  recordAffiliateProductEvents,
  type AffiliateProduct,
} from "@/lib/affiliate-products.functions";

export function ProductDiscoveryRow() {
  const fetchProducts = useServerFn(listAffiliateProducts);
  const recordEvents = useServerFn(recordAffiliateProductEvents);
  const recordedSignature = useRef("");
  const products = useQuery({
    queryKey: ["affiliate-products"],
    queryFn: () => fetchProducts(),
    staleTime: 5 * 60 * 1000,
  });

  const visibleIds = (products.data ?? []).map((product) => product.id);
  const visibleSignature = visibleIds.join(",");
  useEffect(() => {
    if (!visibleSignature || recordedSignature.current === visibleSignature) return;
    recordedSignature.current = visibleSignature;
    void recordEvents({
      data: { productIds: visibleIds, eventKind: "impression", pagePath: "/dashboard" },
    }).catch(() => undefined);
  }, [recordEvents, visibleIds, visibleSignature]);

  return (
    <section className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-4 lg:pr-52" aria-labelledby="product-discovery-title">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <h1 id="product-discovery-title" className="truncate text-sm font-semibold">Trending tools &amp; products</h1>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Useful finds for mobile detailing businesses</p>
        </div>
        <span className="hidden shrink-0 items-center gap-1 text-[10px] text-muted-foreground sm:inline-flex">
          <BadgeInfo className="size-3" aria-hidden="true" /> Affiliate links are labelled
        </span>
      </div>

      {products.isLoading ? (
        <div className="flex h-28 items-center text-xs text-muted-foreground">Finding useful products…</div>
      ) : products.isError ? (
        <div className="flex h-28 items-center text-xs text-destructive">Product discovery is unavailable right now.</div>
      ) : products.data?.length ? (
        <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto pb-1">
          {products.data.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onVisit={() => {
                void recordEvents({
                  data: { productIds: [product.id], eventKind: "click", pagePath: "/dashboard" },
                }).catch(() => undefined);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="grid h-28 grid-cols-[7rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background sm:grid-cols-[10rem_minmax(0,1fr)]">
          <img
            src={detailingToolkit}
            alt="Professional car detailing tools arranged on a workbench"
            loading="lazy"
            width={1200}
            height={512}
            className="h-full w-full object-cover"
          />
          <div className="flex min-w-0 items-center px-3 sm:px-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <PackageSearch className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                Curated marketplace opening soon
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                Products appear here only after their price, destination and partnership disclosure are verified.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ProductCard({ product, onVisit }: { product: AffiliateProduct; onVisit: () => void }) {
  return (
    <article className="grid h-28 w-[16.5rem] shrink-0 snap-start grid-cols-[6rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={`${product.brand} ${product.title}`}
          loading="lazy"
          width={192}
          height={224}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full place-items-center bg-secondary/60" aria-hidden="true">
          <PackageSearch className="size-6 text-primary" />
        </div>
      )}
      <div className="flex min-w-0 flex-col p-2.5">
        <p className="truncate text-[9px] font-semibold uppercase text-muted-foreground">{product.category} · {product.brand}</p>
        <h2 className="mt-0.5 line-clamp-1 text-xs font-semibold">{product.title}</h2>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">{product.shortDescription}</p>
        <div className="mt-auto flex min-w-0 items-end justify-between gap-2">
          <div className="min-w-0">
            {product.priceLabel ? <p className="truncate text-[10px] font-semibold">{product.priceLabel}</p> : null}
            <p className="truncate text-[9px] text-muted-foreground">{product.isAffiliate ? product.disclosureLabel : "Featured product"}</p>
          </div>
          <Button asChild size="icon-sm" variant="outline" className="size-7 shrink-0" title={`View ${product.title}`}>
            <a href={product.destinationUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={onVisit} aria-label={`View ${product.title} from ${product.brand}`}>
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>
    </article>
  );
}