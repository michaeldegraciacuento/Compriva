<?php

namespace App\Domain\Reporting\Export;

/**
 * Minimal ZIP archive writer (deflate), enough for .xlsx files. Written here
 * because the PHP build has no zip extension; it needs only zlib. Follows the
 * PKWARE APPNOTE layout: local headers, data, central directory, end record.
 */
final class ZipWriter
{
    private string $body = '';

    /** @var list<string> */
    private array $central = [];

    public function add(string $name, string $content): void
    {
        $compressed = gzdeflate($content, 6);
        $crc = crc32($content);
        [$time, $date] = self::dosTime();
        $offset = strlen($this->body);

        $header = pack('vvvvvVVVvv', 20, 0x0800, 8, $time, $date, $crc, strlen($compressed), strlen($content), strlen($name), 0);
        $this->body .= pack('V', 0x04034B50).$header.$name.$compressed;

        $this->central[] = pack('V', 0x02014B50).pack('v', 20).$header.pack('vvvVV', 0, 0, 0, 0, $offset).$name;
    }

    public function finish(): string
    {
        $directory = implode('', $this->central);

        return $this->body.$directory
            .pack('VvvvvVVv', 0x06054B50, 0, 0, count($this->central), count($this->central), strlen($directory), strlen($this->body), 0);
    }

    /** @return array{0: int, 1: int} MS-DOS time and date of now */
    private static function dosTime(): array
    {
        $t = getdate();

        return [
            ($t['hours'] << 11) | ($t['minutes'] << 5) | intdiv($t['seconds'], 2),
            (($t['year'] - 1980) << 9) | ($t['mon'] << 5) | $t['mday'],
        ];
    }
}
