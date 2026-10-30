<?php

namespace App\Domain\Inventory\Enums;

/**
 * Kind of manual stock document (stored in stock_adjustments.type).
 * Every posted document produces stock movements through the StockLedger.
 */
enum StockDocumentType: string
{
    case StockIn = 'stock_in';
    case StockOut = 'stock_out';
    case Adjustment = 'adjustment';

    /** @return list<AdjustmentReason> */
    public function reasons(): array
    {
        return match ($this) {
            self::StockIn => [AdjustmentReason::Received, AdjustmentReason::TransferIn, AdjustmentReason::Found,
                AdjustmentReason::OpeningBalance, AdjustmentReason::Other],
            self::StockOut => [AdjustmentReason::Damage, AdjustmentReason::Expiry, AdjustmentReason::Theft,
                AdjustmentReason::InternalUse, AdjustmentReason::ReturnToSupplier, AdjustmentReason::Other],
            self::Adjustment => [AdjustmentReason::CountCorrection, AdjustmentReason::OpeningBalance, AdjustmentReason::Other],
        };
    }

    /** Document number prefix: SI-000001, SO-000001, ADJ-000001. */
    public function prefix(): string
    {
        return match ($this) {
            self::StockIn => 'SI',
            self::StockOut => 'SO',
            self::Adjustment => 'ADJ',
        };
    }

    public function movementType(AdjustmentReason $reason): StockMovementType
    {
        if ($reason === AdjustmentReason::OpeningBalance) {
            return StockMovementType::OpeningBalance;
        }

        return match ($this) {
            self::StockIn => StockMovementType::StockIn,
            self::StockOut => StockMovementType::StockOut,
            self::Adjustment => StockMovementType::Adjustment,
        };
    }
}
