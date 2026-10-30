<?php

namespace App\Domain\Catalog\Enums;

/** Price list a product price belongs to. */
enum PriceTier: string
{
    case Retail = 'retail';
    case Wholesale = 'wholesale';
    case Member = 'member';
}
