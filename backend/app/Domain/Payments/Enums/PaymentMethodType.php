<?php

namespace App\Domain\Payments\Enums;

/** Payment method family. */
enum PaymentMethodType: string
{
    case Cash = 'cash';
    case EWallet = 'e_wallet';
    case Card = 'card';
    case BankTransfer = 'bank_transfer';
    case Other = 'other';
}
