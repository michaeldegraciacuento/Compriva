<?php

namespace Tests\Feature\Database;

use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

abstract class DatabaseTestCase extends TestCase
{
    use RefreshDatabase;

    /** SQLSTATE of trigger rejections (App\Support\Database\Integrity). */
    protected const TRIGGER = '45000';

    /** Integrity constraint violation: foreign key, unique, CHECK (MariaDB) or NOT NULL. */
    protected const CONSTRAINT = '23000';

    /** CHECK constraint violation on MySQL 8 (MariaDB reports 23000). */
    protected const CHECK = 'HY000';

    /**
     * Asserts the database itself rejects the statement (bypassing Eloquent).
     *
     * @param  list<string>  $sqlStates  accepted SQLSTATE codes
     */
    protected function assertDatabaseRejects(callable $statement, array $sqlStates, ?string $messageContains = null): void
    {
        try {
            $statement();
        } catch (QueryException $e) {
            $state = $e->errorInfo[0] ?? (string) $e->getCode();
            $this->assertContains($state, $sqlStates, "Unexpected SQLSTATE {$state}: {$e->getMessage()}");
            if ($messageContains !== null) {
                $this->assertStringContainsString($messageContains, $e->getMessage());
            }

            return;
        }

        $this->fail('The database accepted a statement it should have rejected.');
    }

    protected function assertCheckFails(callable $statement, string $constraint): void
    {
        $this->assertDatabaseRejects($statement, [self::CONSTRAINT, self::CHECK], $constraint);
    }
}
