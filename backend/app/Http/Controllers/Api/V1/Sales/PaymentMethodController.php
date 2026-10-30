<?php

namespace App\Http\Controllers\Api\V1\Sales;

use App\Domain\Payments\Actions\ManagePaymentMethods;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Sales\PosResources;
use App\Models\PaymentMethod;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Cash, GCash and Maya: account details and the QR codes customers scan. */
class PaymentMethodController extends Controller
{
    public function index(): JsonResponse
    {
        $methods = PaymentMethod::whereIn('code', ManagePaymentMethods::ACCEPTED)->orderBy('sort_order')->get();

        return response()->json(['data' => $methods->map(PosResources::paymentMethod(...))]);
    }

    public function update(Request $request, PaymentMethod $method, ManagePaymentMethods $manage): JsonResponse
    {
        $data = $request->validate([
            'account_name' => ['sometimes', 'nullable', 'string', 'max:100'],
            'account_number' => ['sometimes', 'nullable', 'string', 'max:50'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        return response()->json(['data' => PosResources::paymentMethod($manage->update($method, $data))]);
    }

    public function uploadQr(Request $request, PaymentMethod $method, ManagePaymentMethods $manage): JsonResponse
    {
        $request->validate(['image' => ['required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:2048', 'dimensions:min_width=100,min_height=100,max_width=4000,max_height=4000']]);

        return response()->json(['data' => PosResources::paymentMethod($manage->uploadQr($method, $request->file('image')))]);
    }

    public function removeQr(PaymentMethod $method, ManagePaymentMethods $manage): JsonResponse
    {
        return response()->json(['data' => PosResources::paymentMethod($manage->removeQr($method))]);
    }

    /** The QR image for <img> tags. Public: the customer is shown it anyway. */
    public function media(PaymentMethod $method): StreamedResponse
    {
        abort_if($method->qr_image_path === null, 404);

        return Storage::disk(ManagePaymentMethods::DISK)->response($method->qr_image_path, null, [
            'Cache-Control' => 'public, max-age=300',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
