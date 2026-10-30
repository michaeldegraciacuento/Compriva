<?php

namespace App\Domain\Sales\Enums;

/** Condition of a returned item. */
enum ReturnItemCondition: string
{
    case Resellable = 'resellable';
    case Damaged = 'damaged';
    case Expired = 'expired';
}
