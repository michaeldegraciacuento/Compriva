<?php

namespace App\Domain\Catalog\Enums;

/** Physical dimension of a unit of measure. */
enum UnitType: string
{
    case Count = 'count';
    case Weight = 'weight';
    case Volume = 'volume';
    case Length = 'length';
}
