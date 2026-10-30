<?php

namespace App\Domain\Payments\Actions;

use App\Models\PaymentMethod;
use App\Support\Audit\AuditLogger;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Store settings for the accepted payment methods: GCash and Maya QR codes
 * (shown to the customer on the POS) and the account name/number under them.
 * QR images live on the private local disk and are served by
 * GET /api/v1/media/payment-qr/{id}.
 */
class ManagePaymentMethods
{
    public const DISK = 'local';

    /** Methods the store offers (docs/point-of-sale.md §5). */
    public const ACCEPTED = ['cash', 'gcash', 'maya'];

    public function __construct(private readonly AuditLogger $audit) {}

    /** @param array{account_name?: ?string, account_number?: ?string, is_active?: bool} $data */
    public function update(PaymentMethod $method, array $data): PaymentMethod
    {
        if (array_key_exists('is_active', $data) && ! $data['is_active'] && $method->code === 'cash') {
            throw new BusinessException('Cash cannot be switched off.', ErrorCode::BusinessRuleViolation, 422, ['reason' => 'cash_required']);
        }
        if (($data['is_active'] ?? false) && ! in_array($method->code, self::ACCEPTED, true)) {
            throw new BusinessException("{$method->name} is not accepted by this store.", ErrorCode::BusinessRuleViolation, 422, ['reason' => 'not_accepted']);
        }

        $old = $method->only(array_keys($data));
        $method->update($data);
        $this->audit->record('payment_method.updated', $method, $old, $data);

        return $method;
    }

    public function uploadQr(PaymentMethod $method, UploadedFile $file): PaymentMethod
    {
        if ($method->allows_change) {
            throw new BusinessException('Only GCash and Maya use a QR code.', ErrorCode::BusinessRuleViolation, 422, ['reason' => 'no_qr_for_cash']);
        }

        $extension = match ($file->getMimeType()) {
            'image/png' => 'png',
            'image/webp' => 'webp',
            default => 'jpg',
        };
        $previous = $method->qr_image_path;
        $path = $file->storeAs('payment-qr', $method->code.'-'.Str::uuid7().'.'.$extension, self::DISK);

        $method->update(['qr_image_path' => $path]);
        $this->audit->record('payment_method.qr_uploaded', $method);

        if ($previous !== null) {
            Storage::disk(self::DISK)->delete($previous);
        }

        return $method;
    }

    public function removeQr(PaymentMethod $method): PaymentMethod
    {
        $previous = $method->qr_image_path;
        $method->update(['qr_image_path' => null]);
        $this->audit->record('payment_method.qr_removed', $method);

        if ($previous !== null) {
            Storage::disk(self::DISK)->delete($previous);
        }

        return $method;
    }
}
