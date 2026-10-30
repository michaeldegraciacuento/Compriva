<?php

namespace App\Domain\Sales\Enums;

/** Why a discount is granted; SC/PWD are statutory. */
enum DiscountKind: string
{
    case Promotional = 'promotional';
    case SeniorCitizen = 'senior_citizen';
    case Pwd = 'pwd';
    case Employee = 'employee';
    case Manual = 'manual';
}
