<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Business locale
    |--------------------------------------------------------------------------
    |
    | Timestamps are stored in UTC (config/app.php). The business timezone is
    | used to decide which business day a transaction belongs to and for
    | display. Monetary amounts are DECIMAL(15,4) values handled as strings
    | (bcmath); see docs/database.md.
    |
    */

    'timezone' => env('COMPRIVA_TIMEZONE', 'Asia/Manila'),

    'currency' => env('COMPRIVA_CURRENCY', 'PHP'),

    /*
    |--------------------------------------------------------------------------
    | API
    |--------------------------------------------------------------------------
    */

    'api' => [
        'version' => 'v1',
    ],

    /*
    |--------------------------------------------------------------------------
    | Offline synchronization
    |--------------------------------------------------------------------------
    |
    | max_batch_size: maximum operations a terminal may push in one request.
    | max_offline_hours: how long a terminal may sell without syncing before
    | it must reconnect (enforced on the terminal from its last sync time).
    |
    */

    'sync' => [
        'max_batch_size' => (int) env('COMPRIVA_SYNC_MAX_BATCH_SIZE', 100),
        'max_offline_hours' => (int) env('COMPRIVA_SYNC_MAX_OFFLINE_HOURS', 72),
    ],

    /*
    |--------------------------------------------------------------------------
    | Seeding
    |--------------------------------------------------------------------------
    |
    | The first owner account created by `php artisan db:seed`. Outside the
    | local environment a password must be provided; the seeder refuses to
    | create an owner with a default password.
    |
    */

    'seed' => [
        'owner_username' => env('COMPRIVA_OWNER_USERNAME', 'owner'),
        'owner_password' => env('COMPRIVA_OWNER_PASSWORD'),
        'store_code' => env('COMPRIVA_STORE_CODE', 'MAIN'),
        'store_name' => env('COMPRIVA_STORE_NAME', 'Compriva Grocery'),
    ],

];
