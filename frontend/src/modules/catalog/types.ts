import type { IsoDateTime, Money, Quantity, Rate, Uuid } from "@/types/common";

export interface UnitRef {
  id: Uuid;
  code: string;
  name: string;
  type: "count" | "weight" | "volume" | "length";
  allows_decimal: boolean;
}

export interface Unit extends UnitRef {
  is_active: boolean;
}

export interface Category {
  id: Uuid;
  name: string;
  slug: string;
  parent_id: Uuid | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  products_count: number;
}

export interface Brand {
  id: Uuid;
  name: string;
  slug: string;
  is_active: boolean;
  products_count: number;
}

export interface TaxRate {
  id: Uuid;
  code: string;
  name: string;
  type: string;
  rate: Rate;
  is_inclusive: boolean;
  is_default: boolean;
}

export type BarcodeType = "ean13" | "ean8" | "upca" | "code128" | "internal";
export type PriceTier = "retail" | "wholesale" | "member";

export interface Price {
  id: Uuid;
  unit: UnitRef;
  tier: PriceTier;
  price: Money;
  effective_from: IsoDateTime;
  effective_to: IsoDateTime | null;
}

export interface Sku {
  id: Uuid;
  product_id: Uuid;
  product_name?: string;
  /** Product tracking flags (present when the product is loaded, e.g. SKU search). */
  tracks?: { batches: boolean; expiry: boolean };
  code: string;
  name: string;
  variant: string | null;
  base_unit: UnitRef;
  cost_price: Money;
  reorder_level: Quantity;
  reorder_quantity: Quantity;
  is_active: boolean;
  barcodes: { id: Uuid; barcode: string; type: BarcodeType; unit: UnitRef | null; is_primary: boolean }[];
  conversions: { id: Uuid; unit: UnitRef; factor: string; is_base: boolean; is_purchase_unit: boolean; is_sales_unit: boolean }[];
  /** Prices in effect now. */
  prices: Price[];
  stock: { quantity_on_hand: Quantity; quantity_allocated: Quantity; average_cost: Money };
}

export interface ProductImage {
  id: Uuid;
  url: string;
  is_primary: boolean;
  width: number | null;
  height: number | null;
  size_bytes: number;
}

export interface Product {
  id: Uuid;
  name: string;
  description: string | null;
  category: { id: Uuid; name: string } | null;
  brand: { id: Uuid; name: string } | null;
  tax_rate: { id: Uuid; code: string; name: string; rate: Rate };
  track_inventory: boolean;
  track_batches: boolean;
  track_expiry: boolean;
  is_active: boolean;
  image_url: string | null;
  images: ProductImage[];
  skus: Sku[];
  skus_count?: number;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** POST /products */
export interface NewProductInput {
  name: string;
  description?: string | null;
  category_id?: Uuid | null;
  brand_id?: Uuid | null;
  tax_rate_id: Uuid;
  track_inventory?: boolean;
  track_batches?: boolean;
  track_expiry?: boolean;
  skus: NewSkuInput[];
}

export interface NewSkuInput {
  code?: string | null;
  variant?: string | null;
  name?: string | null;
  base_unit_id: Uuid;
  cost_price?: Money;
  reorder_level?: Quantity;
  reorder_quantity?: Quantity;
  price: Money;
  barcode?: string | null;
  barcode_type?: BarcodeType;
}
