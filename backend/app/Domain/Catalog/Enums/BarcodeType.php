<?php

namespace App\Domain\Catalog\Enums;

/** Barcode symbology. */
enum BarcodeType: string
{
    case Ean13 = 'ean13';
    case Ean8 = 'ean8';
    case UpcA = 'upca';
    case Code128 = 'code128';
    case Internal = 'internal';
}
