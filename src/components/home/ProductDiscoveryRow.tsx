import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, PackageSearch, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import microfibreTowels from "@/assets/product-microfibre.jpg";
import dualActionPolisher from "@/assets/product-polisher.jpg";
import pressureWasher from "@/assets/product-pressure-washer.jpg";
import wetDryVacuum from "@/assets/product-vacuum.jpg";
import { Button } from "@/components/ui/button";
import {
  listAffiliateProducts,
  recordAffiliateProductEvents,
  type AffiliateProduct,
} from "@/lib/affiliate-products.functions";

type DisplayProduct = AffiliateProduct & { trackEvents?: boolean };

const starterProducts: DisplayProduct[] = [
  {
    id: "microfibre-towels",
    brand: "Detailing essentials",
    title: "Microfibre towel set",
    category: "Finishing",
    shortDescription: "Soft, reusable cloths for drying, polishing and interior work.",
    imageUrl: microfibreTowels,
    destinationUrl: "https://www.amazon.com.au/s?k=professional+microfibre+detailing+towels",
    priceLabel: "Check current price",
    disclosureLabel: "",
    isAffiliate: false,
  },
  {
    id: "dual-action-polisher",
    brand: "Workshop equipment",
    title: "Dual-action polisher",
    category: "Paint correction",
    shortDescription: "A versatile machine polisher for correction and finishing work.",
    imageUrl: dualActionPolisher,
    destinationUrl: "https://www.amazon.com.au/s?k=dual+action+car+polisher",
    priceLabel: "Check current price",
    disclosureLabel: "",
    isAffiliate: false,
  },
  {
    id: "wet-dry-vacuum",
    brand: "Workshop equipment",
    title: "Wet & dry vacuum",
    category: "Interior",
    shortDescription: "Compact extraction-ready cleaning power for mobile interior jobs.",
    imageUrl: wetDryVacuum,
    destinationUrl: "https://www.amazon.com.au/s?k=wet+dry+vacuum+car+detailing",
    priceLabel: "Check current price",
    disclosureLabel: "",
    isAffiliate: false,
  },
  {
    id: "pressure-washer",
    brand: "Workshop equipment",
    title: "Compact pressure washer",
    category: "Exterior",
    shortDescription: "Portable washing equipment with a lance, hose and foam bottle.",
    imageUrl: pressureWasher,
    destinationUrl: "https://www.amazon.com.au/s?k=pressure+washer+car+detailing",
    priceLabel: "Check current price",
    disclosureLabel: "",
    isAffiliate: false,
  },
];

export function ProductDiscoveryRow() {
  const fetchProducts = useServerFn(listAffiliateProducts);
  const recordEvents = useServerFn(recordAffiliateProductEvents);
  const recordedSignature = useRef("");
  const products = useQuery({
    queryKey: ["affiliate-products"],
    queryFn: () => fetchProducts(),
    staleTime: 5 * 60 * 1000,
  });
  const displayProducts: DisplayProduct[] = products.data?.length
    ? products.data.map((product) => ({ ...product, trackEvents: true }))
    : starterProducts;

  useEffect(() => {
    const visibleIds = (products.data ?? []).map((product) => product.id);
    const visibleSignature = visibleIds.join(",");
    if (!visibleSignature || recordedSignature.current === visibleSignature) return;
    recordedSignature.current = visibleSignature;
    void recordEvents({
      data: { productIds: visibleIds, eventKind: "impression", pagePath: "/dashboard" },
    }).catch(() => undefined);
  }, [products.data, recordEvents]);

  return (
    <section className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-4 lg:pr-52" aria-labelledby="product-discovery-title">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <h1 id="product-discovery-title" className="truncate text-sm font-semibold">Trending tools &amp; products</h1>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Shop useful gear for your detailing business</p>
        </div>
      </div>

      {products.isLoading ? (
        <div className="flex h-28 items-center text-xs text-muted-foreground">Finding useful products…</div>
      ) : products.isError ? (
        <div className="flex h-28 items-center text-xs text-destructive">Product discovery is unavailable right now.</div>
      ) : (
        <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto pb-1">
          {displayProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onVisit={() => {
                if (!product.trackEvents) return;
                void recordEvents({
                  data: { productIds: [product.id], eventKind: "click", pagePath: "/dashboard" },
                }).catch(() => undefined);
              }}
            />
          ))}
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
            <p className="truncate text-[9px] text-muted-foreground">Available online</p>
          </div>
          <Button asChild size="icon-sm" variant="outline" className="size-7 shrink-0" title={`Shop ${product.title}`}>
            <a href={product.destinationUrl} target="_blank" rel="noopener noreferrer" onClick={onVisit} aria-label={`Shop ${product.title}`}>
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>
    </article>
  );
}