<?php

namespace Database\Seeders;

use App\Models\Discount;
use App\Models\PaymentMethod;
use App\Models\Setting;
use App\Models\TaxRate;
use App\Models\Unit;
use Illuminate\Database\Seeder;

/**
 * Units, Philippine tax treatments, payment methods, statutory discounts and
 * global settings. Keyed on codes, so it is safe to run repeatedly; it never
 * overwrites values a store has since edited in settings.
 */
class ReferenceDataSeeder extends Seeder
{
    public function run(): void
    {
        $this->units();
        $this->taxRates();
        $this->paymentMethods();
        $this->statutoryDiscounts();
        $this->settings();
    }

    private function units(): void
    {
        $units = [
            // code, name, type, allows decimal
            ['pc', 'Piece', 'count', false],
            ['pack', 'Pack', 'count', false],
            ['box', 'Box', 'count', false],
            ['case', 'Case', 'count', false],
            ['dozen', 'Dozen', 'count', false],
            ['bottle', 'Bottle', 'count', false],
            ['tray', 'Tray', 'count', false],
            ['kg', 'Kilogram', 'weight', true],
            ['g', 'Gram', 'weight', true],
            ['l', 'Liter', 'volume', true],
            ['ml', 'Milliliter', 'volume', true],
            ['m', 'Meter', 'length', true],
        ];

        foreach ($units as [$code, $name, $type, $decimal]) {
            Unit::updateOrCreate(['code' => $code], ['name' => $name, 'type' => $type, 'allows_decimal' => $decimal]);
        }
    }

    private function taxRates(): void
    {
        $rates = [
            // code, name, type, rate, default
            ['VAT12', 'VAT 12%', 'vat', '12.0000', true],
            ['VAT_EXEMPT', 'VAT-exempt', 'vat_exempt', '0.0000', false],
            ['ZERO_RATED', 'Zero-rated', 'zero_rated', '0.0000', false],
            ['NON_VAT', 'Non-VAT', 'non_vat', '0.0000', false],
        ];

        foreach ($rates as [$code, $name, $type, $rate, $default]) {
            TaxRate::updateOrCreate(
                ['code' => $code],
                ['name' => $name, 'type' => $type, 'rate' => $rate, 'is_inclusive' => true, 'is_default' => $default],
            );
        }
    }

    /** Cash, plus GCash and Maya paid by QR code (docs/README.md). */
    private function paymentMethods(): void
    {
        $methods = [
            // code, name, type, requires reference, opens drawer, allows change
            ['cash', 'Cash', 'cash', false, true, true],
            ['gcash', 'GCash', 'e_wallet', true, false, false],
            ['maya', 'Maya', 'e_wallet', true, false, false],
        ];

        foreach ($methods as $order => [$code, $name, $type, $reference, $drawer, $change]) {
            PaymentMethod::updateOrCreate(['code' => $code], [
                'name' => $name,
                'type' => $type,
                'requires_reference' => $reference,
                'opens_cash_drawer' => $drawer,
                'allows_change' => $change,
                'sort_order' => $order,
            ]);
        }
    }

    /** Senior citizen (RA 9994) and PWD (RA 10754): 20% discount on VAT-exempt sales. */
    private function statutoryDiscounts(): void
    {
        foreach ([['SC20', 'Senior Citizen 20%', 'senior_citizen'], ['PWD20', 'PWD 20%', 'pwd']] as [$code, $name, $kind]) {
            Discount::updateOrCreate(['code' => $code], [
                'name' => $name,
                'kind' => $kind,
                'type' => 'percentage',
                'value' => '20.0000',
                'scope' => 'sale',
                'is_vat_exempt' => true,
                'requires_customer_id' => true,
            ]);
        }
    }

    private function settings(): void
    {
        $defaults = [
            'receipt' => [
                'paper_size' => '80mm',                    // 58mm | 80mm | a4
                'header_lines' => [],
                'footer_text' => 'Thank you for shopping!',
                'show_vat_breakdown' => true,
            ],
            'tax' => [
                'prices_include_vat' => true,
                'default_tax_rate' => 'VAT12',
            ],
            'pos' => [
                'allow_over_allocation' => false,          // terminals sell only their allocation (offline-sync.md §6)
                'allocation_share_percent' => 90,          // terminals together hold at most 90% of free stock
                'require_open_shift' => true,
                'max_cash_in_drawer' => '20000.0000',      // prompt a cash drop above this
            ],
            'inventory' => [
                'costing_method' => 'weighted_average',
                'allocation_hours' => 8,                   // allocate expected sales for N hours
                'expiry_warning_days' => 30,
            ],
        ];

        foreach ($defaults as $group => $values) {
            foreach ($values as $key => $value) {
                Setting::firstOrCreate(['store_id' => null, 'group' => $group, 'key' => $key], ['value' => $value]);
            }
        }
    }
}
