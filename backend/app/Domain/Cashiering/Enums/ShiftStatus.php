<?php

namespace App\Domain\Cashiering\Enums;

/** Cashier shift lifecycle. */
enum ShiftStatus: string
{
    case Open = 'open';
    case Closed = 'closed';
}
