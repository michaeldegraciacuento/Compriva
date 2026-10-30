<?php

namespace App\Domain\Identity;

/**
 * Permission catalog and default role definitions.
 *
 * Permissions are defined in code (so authorization checks can reference them
 * safely) and synced to the `permissions` table by the RolesAndPermissionsSeeder.
 * Roles listed here are system roles; stores can add their own roles later.
 */
final class Permissions
{
    /** name => [display name, group] */
    public const ALL = [
        'dashboard.view' => ['View dashboard', 'dashboard'],

        'pos.access' => ['Use the point of sale', 'pos'],
        'pos.price_override' => ['Override item prices', 'pos'],
        'pos.apply_discount' => ['Apply discounts', 'pos'],
        'pos.remove_item' => ['Remove scanned items from a cart', 'pos'],
        'pos.open_drawer' => ['Open the cash drawer without a sale', 'pos'],

        'sales.view' => ['View sales', 'sales'],
        'sales.void' => ['Void sales', 'sales'],
        'sales.return' => ['Process returns and refunds', 'sales'],
        'sales.reprint' => ['Reprint receipts', 'sales'],

        'products.view' => ['View products', 'products'],
        'products.manage' => ['Create and edit products', 'products'],
        'products.manage_prices' => ['Change prices', 'products'],

        'inventory.view' => ['View inventory', 'inventory'],
        'inventory.adjust' => ['Create stock adjustments', 'inventory'],
        'inventory.approve' => ['Approve and post stock adjustments', 'inventory'],
        'inventory.allocate' => ['Manage terminal stock allocations', 'inventory'],

        'purchasing.view' => ['View suppliers and purchase orders', 'purchasing'],
        'purchasing.manage' => ['Create purchase orders and suppliers', 'purchasing'],
        'purchasing.approve' => ['Approve purchase orders', 'purchasing'],
        'purchasing.receive' => ['Receive goods', 'purchasing'],

        'customers.view' => ['View customers', 'customers'],
        'customers.manage' => ['Create and edit customers', 'customers'],

        'cashier.shift' => ['Open and close own shift', 'cashier'],
        'cashier.cash_movements' => ['Record cash in / cash out', 'cashier'],
        'cashier.manage_shifts' => ['View and close any shift', 'cashier'],

        'payments.manage_methods' => ['Manage payment methods', 'payments'],

        'reports.view' => ['View sales and stock reports', 'reports'],
        'reports.view_profit' => ['View cost and profit reports', 'reports'],

        'users.manage' => ['Manage users', 'users'],
        'roles.manage' => ['Manage roles and permissions', 'users'],

        'settings.manage' => ['Manage store, tax, receipt and payment settings', 'settings'],
        'devices.manage' => ['Register and revoke terminals', 'devices'],
        'audit.view' => ['View audit logs', 'settings'],
    ];

    /** role => [display name, description, permissions ('*' = all)] */
    public const ROLES = [
        'owner' => ['Owner', 'Full access to everything', ['*']],
        'manager' => ['Store manager', 'Runs the store; cannot change roles, settings or devices', [
            'dashboard.view',
            'pos.access', 'pos.price_override', 'pos.apply_discount', 'pos.remove_item', 'pos.open_drawer',
            'sales.view', 'sales.void', 'sales.return', 'sales.reprint',
            'products.view', 'products.manage', 'products.manage_prices',
            'inventory.view', 'inventory.adjust', 'inventory.approve', 'inventory.allocate',
            'purchasing.view', 'purchasing.manage', 'purchasing.approve', 'purchasing.receive',
            'customers.view', 'customers.manage',
            'cashier.shift', 'cashier.cash_movements', 'cashier.manage_shifts',
            'reports.view', 'reports.view_profit',
            'users.manage', 'audit.view',
        ]],
        'cashier' => ['Cashier', 'Sells at a checkout terminal', [
            'pos.access', 'pos.remove_item', 'sales.reprint',
            'customers.view', 'customers.manage',
            'cashier.shift',
        ]],
        'inventory_clerk' => ['Inventory clerk', 'Receives goods and counts stock', [
            'products.view', 'inventory.view', 'inventory.adjust',
            'purchasing.view', 'purchasing.receive',
        ]],
    ];

    /** @return list<string> */
    public static function forRole(string $role): array
    {
        $permissions = self::ROLES[$role][2];

        return $permissions === ['*'] ? array_keys(self::ALL) : $permissions;
    }
}
