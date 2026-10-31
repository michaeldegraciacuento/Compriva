<?php

namespace App\Providers;

use App\Domain\Identity\Permissions;
use App\Domain\Sync\SyncChangeObserver;
use App\Models;
use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Database\MorphMap;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /** Models whose changes terminals pull. */
    private const OBSERVED_FOR_SYNC = [
        Models\Product::class, Models\ProductSku::class, Models\ProductPrice::class, Models\ProductBarcode::class,
        Models\UnitConversion::class, Models\ProductImage::class, Models\TaxRate::class, Models\Category::class,
        User::class, Models\PaymentMethod::class, Models\Discount::class, Models\Setting::class,
        Models\Store::class, Models\TerminalStockAllocation::class, Models\Customer::class,
    ];

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Relation::enforceMorphMap(MorphMap::MAP);

        // Mass assignment protection comes from validated FormRequest data, not
        // $fillable lists (docs/README.md). Outside production, fail
        // fast on lazy loading and on reading attributes that were not selected.
        Model::unguard();
        Model::shouldBeStrict(! $this->app->isProduction());

        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);

        // Terminals cache these; every change is logged for them to pull (docs/README.md).
        foreach (self::OBSERVED_FOR_SYNC as $model) {
            $model::observe(SyncChangeObserver::class);
        }

        $this->defineGates();
        $this->defineRateLimits();

        Password::defaults(fn () => $this->app->isProduction()
            ? Password::min(10)->letters()->mixedCase()->numbers()->uncompromised()
            : Password::min(8)->letters()->numbers());
    }

    /**
     * Every catalog permission is a Gate, so controllers, policies and the
     * `can:` middleware all check the same backend rule. Only active people
     * pass; device tokens never do (the closures require a User).
     */
    private function defineGates(): void
    {
        foreach (array_keys(Permissions::ALL) as $permission) {
            Gate::define($permission, fn (User $user) => $user->is_active && $user->hasPermission($permission));
        }
    }

    private function defineRateLimits(): void
    {
        RateLimiter::for('api', function (Request $request) {
            $actor = $request->user();
            $key = match (true) {
                $actor instanceof User => 'user:'.$actor->id,
                $actor instanceof Device => 'device:'.$actor->id,
                default => 'ip:'.$request->ip(),
            };

            return Limit::perMinute(300)->by($key);
        });

        // Per account and per IP: slows down both targeted guessing and spraying.
        RateLimiter::for('login', fn (Request $request) => [
            Limit::perMinute(5)->by('login:'.mb_strtolower((string) $request->input('login')).'|'.$request->ip()),
            Limit::perMinute(20)->by('login-ip:'.$request->ip()),
        ]);

        RateLimiter::for('terminal-login', fn (Request $request) => [
            Limit::perMinute(5)->by('terminal-login:'.$request->user()?->getKey().'|'.mb_strtolower((string) $request->input('username'))),
            Limit::perMinute(20)->by('terminal-login-device:'.$request->user()?->getKey()),
        ]);

        // Sync pushes: a terminal back online flushes its outbox in batches of up to 100.
        RateLimiter::for('sync', fn (Request $request) => Limit::perMinute(120)->by('sync:'.($request->user()?->getKey() ?? $request->ip())));
        RateLimiter::for('pairing', fn (Request $request) => Limit::perMinute(5)->by('pairing:'.$request->ip()));
    }
}
