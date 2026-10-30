<?php

namespace App\Domain\Inventory\Enums;

/** Draft documents are editable; posted documents have moved stock and are locked. */
enum DocumentStatus: string
{
    case Draft = 'draft';
    case Posted = 'posted';
}
