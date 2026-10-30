<?php

namespace Tests\Feature\Api;

use Tests\TestCase;

class HealthTest extends TestCase
{
    public function test_health_reports_ok_with_server_metadata(): void
    {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertJsonPath('data.status', 'ok')
            ->assertJsonPath('data.api_version', 'v1')
            ->assertJsonPath('data.timezone', 'Asia/Manila')
            ->assertJsonPath('data.currency', 'PHP')
            ->assertJsonPath('data.checks.database', 'ok')
            ->assertJsonStructure(['data' => ['server_time']]);
    }

    public function test_cors_allows_the_web_app_and_desktop_origins(): void
    {
        foreach (['http://localhost:3000', 'http://tauri.localhost'] as $origin) {
            $this->getJson('/api/v1/health', ['Origin' => $origin])
                ->assertOk()
                ->assertHeader('Access-Control-Allow-Origin', $origin)
                ->assertHeader('Access-Control-Allow-Credentials', 'true');
        }
    }

    public function test_cors_rejects_unknown_origins(): void
    {
        $this->getJson('/api/v1/health', ['Origin' => 'https://evil.example'])
            ->assertHeaderMissing('Access-Control-Allow-Origin');
    }
}
