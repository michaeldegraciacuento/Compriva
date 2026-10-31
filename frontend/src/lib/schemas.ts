import { z } from "zod";

/**
 * Form field schemas for decimal strings. Values stay strings end to end
 * (docs/README.md D4): the server does all arithmetic.
 */

const DECIMAL_4 = /^\d{1,11}(\.\d{1,4})?$/;
const DECIMAL_6 = /^\d{1,9}(\.\d{1,6})?$/;

export const moneyField = (label = "Amount") =>
  z.string().trim().regex(DECIMAL_4, `${label}: use a number with up to 4 decimals.`);

export const quantityField = (label = "Quantity") =>
  z.string().trim().regex(DECIMAL_4, `${label}: use a number with up to 4 decimals.`)
    .refine((v) => Number(v) > 0, `${label} must be greater than zero.`);

export const factorField = () =>
  z.string().trim().regex(DECIMAL_6, "Use a number with up to 6 decimals.")
    .refine((v) => Number(v) > 0, "Must be greater than zero.");

export const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === "" ? null : v));
