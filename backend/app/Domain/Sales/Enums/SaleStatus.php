<?php

namespace App\Domain\Sales\Enums;

/** Sale lifecycle. Only completed sales reach the cloud; voiding is final. */
enum SaleStatus: string
{
    case Completed = 'completed';
    case Voided = 'voided';
}
