<?php

namespace App\Domain\Sales\Enums;

/** What a discount applies to. */
enum DiscountScope: string
{
    case Sale = 'sale';
    case Item = 'item';
}
