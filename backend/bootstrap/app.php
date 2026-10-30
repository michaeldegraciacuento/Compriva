<?php

use App\Http\Middleware\AssignRequestId;
use App\Http\Middleware\EnsureActiveDevice;
use App\Http\Middleware\EnsureActiveUser;
use App\Support\Errors\ApiExceptionRenderer;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        // Global so that unmatched routes (404) also get a request ID.
        $middleware->prepend(AssignRequestId::class);

        // Sanctum cookie authentication for the web app (SANCTUM_STATEFUL_DOMAINS).
        // The desktop terminals authenticate with bearer tokens instead.
        $middleware->statefulApi();
        $middleware->throttleApi('api');

        $middleware->alias([
            'actor.user' => EnsureActiveUser::class,
            'actor.device' => EnsureActiveDevice::class,
        ]);

        // The API never redirects to a login page.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->render(new ApiExceptionRenderer);

        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
