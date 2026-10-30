<?php

namespace App\Domain\Cashiering\Enums;

/** Cash drawer movement outside of sales. */
enum CashMovementType: string
{
    case CashIn = 'cash_in';
    case CashOut = 'cash_out';
    case CashDrop = 'cash_drop';
}
