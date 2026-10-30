"use client";

import { useApiQuery } from "@/lib/use-api-query";

import { fetchBrands, fetchCategories, fetchTaxRates, fetchUnits } from "./api";

/** Categories, brands, units and tax rates for pickers and filters. */
export function useCatalogRefs() {
  return useApiQuery(["catalog-refs"], async () => {
    const [categories, brands, units, taxRates] = await Promise.all([fetchCategories(), fetchBrands(), fetchUnits(), fetchTaxRates()]);
    return { categories, brands, units, taxRates };
  });
}
