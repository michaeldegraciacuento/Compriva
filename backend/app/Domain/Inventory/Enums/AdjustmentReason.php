<?php

namespace App\Domain\Inventory\Enums;

/** Why stock was added, removed or corrected (see StockDocumentType::reasons()). */
enum AdjustmentReason: string
{
    // Stock in
    case Received = 'received';
    case TransferIn = 'transfer_in';
    case Found = 'found';
    // Stock out
    case Damage = 'damage';
    case Expiry = 'expiry';
    case Theft = 'theft';
    case InternalUse = 'internal_use';
    case ReturnToSupplier = 'return_to_supplier';
    // Count adjustment
    case CountCorrection = 'count_correction';
    // Any
    case OpeningBalance = 'opening_balance';
    case Other = 'other';

    public function label(): string
    {
        return match ($this) {
            self::Received => 'Received from supplier',
            self::TransferIn => 'Transfer in',
            self::Found => 'Found stock',
            self::Damage => 'Damaged',
            self::Expiry => 'Expired',
            self::Theft => 'Theft / loss',
            self::InternalUse => 'Internal use',
            self::ReturnToSupplier => 'Returned to supplier',
            self::CountCorrection => 'Physical count',
            self::OpeningBalance => 'Opening balance',
            self::Other => 'Other',
        };
    }
}
