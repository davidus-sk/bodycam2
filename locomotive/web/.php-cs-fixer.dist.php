<?php

/**
 * This file is part of the Carbon package.
 *
 * (c) Brian Nesbitt <brian@nesbot.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

use PhpCsFixer\Config;
use PhpCsFixer\Finder;

$rules = [
    '@PSR2' => true,
    '@PSR12' => true,
    '@PHP71Migration' => true,
    'blank_line_after_namespace' => true,
    'blank_line_before_statement' => [
        'statements' => [
            'continue',
            'declare',
            'return',
            'throw',
            'try',
        ],
    ],
    'cast_spaces' => true,
    'class_definition' => true,
    'concat_space' => [
        'spacing' => 'one',
    ],
    'align_multiline_comment' => true,
    'array_indentation' => true,
    'array_syntax' => [
        'syntax' => 'short',
    ],
    'visibility_required' => false,
    'general_phpdoc_tag_rename' => true,
    'no_blank_lines_after_phpdoc' => true,
    'no_unneeded_control_parentheses' => true,
    'no_unused_imports' => true,
    'no_extra_blank_lines' => [
        'tokens' => [
            'use',
            'continue',
            'square_brace_block',
            'parenthesis_brace_block',
        ],
    ],
    'phpdoc_indent' => true,
    'phpdoc_inline_tag_normalizer' => true,
    'space_after_semicolon' => true,
    'trim_array_spaces' => true,
];

// directories to not scan
$excludeDirs = [
    '.cloud',
    '.homestead',
    '.github',
    '.idea',
    'bootstrap/',
    'node_modules/',
    'public/',
    'resources/',
    'storage/',
    'tests/',
    'vendor/',
    'assets/',
    'runtime/',
];

// files to not scan
$excludeFiles = [
    'config/app.php',
];

$finder = (new Finder())
    ->in(__DIR__)
    ->name('*.php')
    ->notPath(['yii'])
    ->exclude($excludeDirs)
    ->ignoreDotFiles(true)
    ->ignoreVCS(true);

return (new Config())
    ->setRules($rules)
    ->setFinder($finder)
    ->setIndent('    ')
    ->setUsingCache(true)
    ->setRiskyAllowed(true);
