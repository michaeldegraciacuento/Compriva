<?php

namespace App\Domain\Inventory\Enums;

/** Source of a stock movement. */
enum StockMovementType: string
{
    case PurchaseReceipt = 'purchase_receipt';
    case Sale = 'sale';
    case SaleVoid = 'sale_void';
    case SaleReturn = 'sale_return';
    case Adjustment = 'adjustment';
    case OpeningBalance = 'opening_balance';
    case StockIn = 'stock_in';
    case StockOut = 'stock_out';
}
