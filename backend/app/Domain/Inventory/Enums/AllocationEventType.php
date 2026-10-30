<?php

namespace App\Domain\Inventory\Enums;

/** Change to a terminal stock allocation. */
enum AllocationEventType: string
{
    case Allocate = 'allocate';
    case Release = 'release';
    case Consume = 'consume';
}
