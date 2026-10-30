<?php

namespace App\Domain\Sales\Enums;

/** How a discount value is applied. */
enum DiscountType: string
{
    case Percentage = 'percentage';
    case FixedAmount = 'fixed_amount';
}
