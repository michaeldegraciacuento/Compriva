<?php

namespace App\Domain\Sync\Enums;

/** Outcome of a pushed sync operation. */
enum SyncOperationStatus: string
{
    case Applied = 'applied';
    case Rejected = 'rejected';
}
