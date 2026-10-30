<?php

namespace App\Domain\Customers\Enums;

/** Customer classification. */
enum CustomerType: string
{
    case Regular = 'regular';
    case SeniorCitizen = 'senior_citizen';
    case Pwd = 'pwd';
    case Business = 'business';
}
