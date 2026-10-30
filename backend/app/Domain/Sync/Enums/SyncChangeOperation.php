<?php

namespace App\Domain\Sync\Enums;

/** Kind of change in the sync change log. */
enum SyncChangeOperation: string
{
    case Upsert = 'upsert';
    case Delete = 'delete';
}
