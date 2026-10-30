<?php

namespace Tests\Feature\Api;

use App\Models\User;
use App\Support\Errors\BusinessException;
use App\Support\Errors\ErrorCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

class ErrorEnvelopeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Route::prefix('api/v1/_test')->middleware('api')->group(function () {
            Route::post('validation', fn (Request $request) => $request->validate(['name' => 'required']));
            Route::get('business', fn () => throw new BusinessException(
                'Only 2 left in stock.',
                ErrorCode::BusinessRuleViolation,
                409,
                ['available' => 2],
            ));
            Route::get('crash', fn () => throw new RuntimeException('secret internals'));
            Route::get('model', fn () => User::findOrFail(999));
        });
    }

    public function test_unknown_endpoint_returns_not_found_envelope(): void
    {
        $this->getJson('/api/v1/does-not-exist')
            ->assertNotFound()
            ->assertExactJsonStructure(['error' => ['code', 'message', 'details', 'request_id']])
            ->assertJsonPath('error.code', 'NOT_FOUND');
    }

    public function test_missing_model_does_not_leak_class_names(): void
    {
        $response = $this->getJson('/api/v1/_test/model')
            ->assertNotFound()
            ->assertJsonPath('error.code', 'NOT_FOUND');

        $this->assertStringNotContainsString('App\\Models', $response->getContent());
    }

    public function test_validation_errors_list_fields(): void
    {
        $this->postJson('/api/v1/_test/validation', [])
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'VALIDATION_FAILED')
            ->assertJsonStructure(['error' => ['details' => ['fields' => ['name']]]]);
    }

    public function test_business_exception_uses_its_code_status_and_details(): void
    {
        $this->getJson('/api/v1/_test/business')
            ->assertConflict()
            ->assertJsonPath('error.code', 'BUSINESS_RULE_VIOLATION')
            ->assertJsonPath('error.message', 'Only 2 left in stock.')
            ->assertJsonPath('error.details.available', 2);
    }

    public function test_unauthenticated_request_returns_401_envelope(): void
    {
        $this->getJson('/api/v1/auth/me')
            ->assertUnauthorized()
            ->assertJsonPath('error.code', 'UNAUTHENTICATED');
    }

    public function test_bearer_token_authenticates(): void
    {
        $token = User::factory()->create()->createToken('test')->plainTextToken;

        $this->getJson('/api/v1/auth/me', ['Authorization' => "Bearer {$token}"])
            ->assertOk()
            ->assertJsonStructure(['data' => ['user' => ['id', 'email'], 'permissions']]);
    }

    public function test_unexpected_errors_hide_internals_in_production(): void
    {
        config(['app.debug' => false]);

        $response = $this->getJson('/api/v1/_test/crash')
            ->assertInternalServerError()
            ->assertJsonPath('error.code', 'SERVER_ERROR')
            ->assertJsonPath('error.message', 'An unexpected error occurred.');

        $this->assertStringNotContainsString('secret internals', $response->getContent());
    }

    public function test_request_id_is_generated_and_echoed(): void
    {
        $response = $this->getJson('/api/v1/does-not-exist');

        $id = $response->headers->get('X-Request-Id');
        $this->assertNotEmpty($id);
        $response->assertJsonPath('error.request_id', $id);
    }

    public function test_client_request_id_is_preserved_and_invalid_ones_replaced(): void
    {
        $this->getJson('/api/v1/health', ['X-Request-Id' => 'term-01.abc123'])
            ->assertHeader('X-Request-Id', 'term-01.abc123');

        $this->assertNotSame(
            'bad id with spaces',
            $this->getJson('/api/v1/health', ['X-Request-Id' => 'bad id with spaces'])->headers->get('X-Request-Id'),
        );
    }
}
