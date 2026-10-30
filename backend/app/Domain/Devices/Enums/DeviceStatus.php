<?php

namespace App\Domain\Devices\Enums;

/** Lifecycle of a checkout terminal. */
enum DeviceStatus: string
{
    case Pending = 'pending';
    case Active = 'active';
    case Revoked = 'revoked';
}
