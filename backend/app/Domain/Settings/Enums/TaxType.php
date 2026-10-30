<?php

namespace App\Domain\Settings\Enums;

/** Philippine tax treatment of a sale line. */
enum TaxType: string
{
    case Vat = 'vat';
    case VatExempt = 'vat_exempt';
    case ZeroRated = 'zero_rated';
    case NonVat = 'non_vat';
}
