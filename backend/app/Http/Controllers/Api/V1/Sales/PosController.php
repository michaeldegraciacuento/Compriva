<?php

namespace App\Http\Controllers\Api\V1\Sales;

use App\Domain\Cashiering\Actions\ManageShifts;
use App\Domain\Cashiering\Actions\RecordCashMovement;
use App\Domain\Cashiering\Enums\CashMovementType;
use App\Domain\Cashiering\Enums\ShiftStatus;
use App\Domain\Cashiering\Queries\ShiftSummary;
use App\Domain\Cashiering\Services\Terminals;
use App\Domain\Catalog\Enums\PriceTier;
use App\Domain\Sales\Actions\CompleteSale;
use App\Domain\Sales\Services\CartPricer;
use App\Domain\Settings\Settings;
use App\Domain\Sync\Queries\TerminalData;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Sales\CheckoutRequest;
use App\Http\Resources\V1\Sales\PosResources;
use App\Http\Resources\V1\Sales\SaleResource;
use App\Models\CashierShift;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\ProductBarcode;
use App\Models\ProductPrice;
use App\Models\ProductSku;
use App\Models\Sale;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Point of sale: terminal, shift, sellable items, quotes and checkout.
 * All routes need pos.access; the terminal comes from X-Compriva-Device
 * (docs/README.md).
 */
class PosController extends Controller
{
    public function __construct(private readonly Terminals $terminals) {}

    /** Everything the POS screen needs to start: terminal, open shift, payment methods, discounts. */
    public function bootstrap(Request $request, TerminalData $data): JsonResponse
    {
        $terminal = $this->terminals->current($request);
        $shift = $terminal === null ? null : $this->terminalShift($terminal);

        return response()->json(['data' => [
            'install_id' => $this->terminals->installId($request),
            'terminal' => PosResources::terminal($terminal),
            'can_register' => $request->user()->hasPermission('devices.manage'),
            'shift' => PosResources::shift($shift),
            'payment_methods' => $data->paymentMethods(),
            'discounts' => $data->discounts(),
            // Categories that have something to sell, for browsing (cashiers cannot read the catalog API).
            'categories' => $data->categories(),
            'receipt' => SaleResource::receiptSettings(),
            'pos' => ['max_cash_in_drawer' => (string) Settings::get('pos', 'max_cash_in_drawer')],
        ]]);
    }

    /**
     * Issues the terminal's device token for background synchronization
     * (desktop app). It is stored in the Windows Credential Manager and lets the
     * terminal sync even while a cashier is signed in offline with a PIN.
     * A new token replaces the previous one; revoking the device revokes it.
     */
    public function syncToken(Request $request, AuditLogger $audit): JsonResponse
    {
        $device = $this->terminals->require($request);
        $device->tokens()->where('abilities', 'like', '%'.PersonalAccessToken::ABILITY_DEVICE.'%')->delete();
        $token = $device->createToken("sync:{$device->code}", [PersonalAccessToken::ABILITY_DEVICE]);
        $audit->record('device.sync_token_issued', $device, new: ['code' => $device->code], device: $device);

        return response()->json(['data' => ['token' => $token->plainTextToken, 'terminal' => PosResources::terminal($device)]], 201);
    }

    public function registerTerminal(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:100']]);

        return response()->json(['data' => PosResources::terminal($this->terminals->register($request, $data['name']))], 201);
    }

    public function shift(Request $request, ShiftSummary $summary): JsonResponse
    {
        $shift = $this->terminalShift($this->terminals->require($request));

        return response()->json(['data' => PosResources::shift($shift, $shift ? $summary->for($shift) : null)]);
    }

    public function openShift(Request $request, ManageShifts $shifts): JsonResponse
    {
        $data = $request->validate([
            'opening_float' => ['required', 'decimal:0,2', 'min:0', 'max:9999999'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);
        abort_unless($request->user()->hasPermission('cashier.shift'), 403, 'You may not open a shift.');

        $shift = $shifts->open($this->terminals->require($request), $request->user(), (string) $data['opening_float'], $data['notes'] ?? null);

        return response()->json(['data' => PosResources::shift($shift)], 201);
    }

    public function closeShift(Request $request, ManageShifts $shifts): JsonResponse
    {
        $data = $request->validate([
            'counted_cash' => ['required', 'decimal:0,2', 'min:0', 'max:9999999'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);
        $shift = $this->terminalShift($this->terminals->require($request))
            ?? throw new BusinessException('There is no open shift on this terminal.', ErrorCode::ShiftRequired, 409);

        ['shift' => $shift, 'summary' => $summary] = $shifts->close($shift, $request->user(), (string) $data['counted_cash'], $data['notes'] ?? null);

        return response()->json(['data' => PosResources::shift($shift, $summary)]);
    }

    /** Cash in, cash out or a cash drop on this terminal's open shift. */
    public function cashMovement(Request $request, RecordCashMovement $record, ShiftSummary $summary): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::enum(CashMovementType::class)],
            'amount' => ['required', 'decimal:0,2', 'gt:0', 'max:9999999'],
            'reason' => ['required', 'string', 'min:3', 'max:255'],
            'approval' => ['nullable', 'array'],
            'approval.login' => ['nullable', 'string', 'max:100'],
            'approval.secret' => ['nullable', 'string', 'max:100'],
        ]);
        $shift = $this->terminalShift($this->terminals->require($request))
            ?? throw new BusinessException('There is no open shift on this terminal.', ErrorCode::ShiftRequired, 409);

        $record->execute($shift, $request->user(), CashMovementType::from($data['type']), (string) $data['amount'], $data['reason'], $data['approval'] ?? null);

        return response()->json(['data' => PosResources::shift($shift->refresh(), $summary->for($shift))], 201);
    }

    /**
     * Records that the cash drawer was opened without a sale ("no sale"). The
     * drawer itself is opened by the terminal through its receipt printer; this
     * only puts it in the audit log (pos.open_drawer).
     */
    public function drawerOpened(Request $request, AuditLogger $audit): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:255']]);
        $terminal = $this->terminals->require($request);
        $audit->record('cash_drawer.opened', $terminal, new: ['reason' => $data['reason'], 'shift_id' => $this->terminalShift($terminal)?->id], device: $terminal);

        return response()->json(['data' => ['recorded' => true]], 201);
    }

    /** Sellable items: search by name/code, an exact barcode scan, or browse a category. */
    public function catalog(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'barcode' => ['nullable', 'string', 'max:64'],
            'category_id' => ['nullable', 'uuid'],
        ]);

        $matchedUnits = [];
        $query = ProductSku::query()
            ->with(['product.taxRate', 'product.images', 'baseUnit', 'unitConversions.unit', 'inventoryLevels'])
            ->where('product_skus.is_active', true)
            ->whereHas('product', fn (Builder $q) => $q->where('is_active', true));

        if (filled($filters['barcode'] ?? null)) {
            $barcode = ProductBarcode::where('barcode', $filters['barcode'])->first();
            if ($barcode === null) {
                return response()->json(['data' => []]);
            }
            $matchedUnits[$barcode->product_sku_id] = $barcode->unit_id;
            $query->whereKey($barcode->product_sku_id);
        } else {
            $term = trim($filters['q'] ?? '');
            $query->when($term !== '', fn (Builder $q) => $q->where(fn (Builder $q) => $q
                ->where('name', 'like', "%{$term}%")
                ->orWhere('code', 'like', "%{$term}%")
                ->orWhereHas('barcodes', fn (Builder $q) => $q->where('barcode', $term))))
                ->when($filters['category_id'] ?? null, fn (Builder $q, $id) => $q->whereHas('product', fn (Builder $q) => $q->where('category_id', $id)));
        }

        $skus = $query->orderBy('name')->limit(60)->get();
        $prices = ProductPrice::whereIn('product_sku_id', $skus->modelKeys())->where('tier', PriceTier::Retail)
            ->effectiveAt()->orderBy('effective_from')->get()
            ->groupBy('product_sku_id')
            ->map(fn ($rows) => $rows->pluck('price', 'unit_id')->all());

        return response()->json(['data' => $skus
            ->map(fn (ProductSku $sku) => PosResources::item($sku, $prices->get($sku->id, []), $matchedUnits[$sku->id] ?? null))
            ->filter(fn (array $item) => count($item['units']) > 0)
            ->values()]);
    }

    /** Prices a cart on the server: the same calculation checkout uses. */
    public function quote(CheckoutRequest $request, CartPricer $pricer): JsonResponse
    {
        $priced = $pricer->price($request->validated('lines'), $request->validated('discount'));

        return response()->json(['data' => [
            'lines' => array_map(fn (array $line) => [
                'sku_id' => $line['sku']->id,
                'unit_id' => $line['unit']->id,
                'quantity' => $line['quantity'],
                'regular_unit_price' => $line['regular_unit_price'],
                'unit_price' => $line['unit_price'],
            ] + $line['amounts'], $priced['lines']),
            'discount' => $priced['discount'] === null ? null : array_diff_key($priced['discount'], ['needs_permission' => true]),
            'totals' => $priced['totals'],
            'approval_needed' => array_values(array_filter($priced['permissions'], fn (string $p) => ! $request->user()->hasPermission($p))),
        ]]);
    }

    public function checkout(CheckoutRequest $request, CompleteSale $complete): JsonResponse
    {
        ['sale' => $sale, 'replayed' => $replayed] = $complete->execute($this->terminals->require($request), $request->user(), $request->validated());

        return SaleResource::receipt($sale)->additional(['meta' => ['replayed' => $replayed]])->response()->setStatusCode($replayed ? 200 : 201);
    }

    /** Sales of this terminal's open shift (newest first), or a receipt-number search across all sales. */
    public function sales(Request $request): JsonResponse
    {
        $filters = $request->validate(['q' => ['nullable', 'string', 'max:30']]);
        $terminal = $this->terminals->require($request);
        $shift = $this->terminalShift($terminal);

        $sales = Sale::query()
            ->with('device', 'cashier')
            ->withCount('items')
            ->when(filled($filters['q'] ?? null),
                fn (Builder $q) => $q->where('receipt_number', 'like', '%'.$filters['q'].'%'),
                fn (Builder $q) => $q->where('cashier_shift_id', $shift?->id))
            ->latest('occurred_at')
            ->limit(30)
            ->get();

        return response()->json(['data' => SaleResource::collection($sales)]);
    }

    private function terminalShift(Device $terminal): ?CashierShift
    {
        return CashierShift::where('device_id', $terminal->id)->where('status', ShiftStatus::Open)->first();
    }
}
