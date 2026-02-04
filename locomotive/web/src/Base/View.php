<?php

namespace App\Base;

use Exception;
use RuntimeException;
use Throwable;

class View
{
    private static $layout;

    /**
     * Set layout
     * @param string|bool $layout
     * @return void
     */
    public static function layout(string|bool $layout): void
    {
        if ($layout === false) {
            static::$layout = false;
        } else {
            static::$layout = trim((string) $layout);
        }
    }

    /**
     * Renders a view
     * @param string $view view name.
     * @param array $params view variables (`name => value`).
     * @param bool|string|null $layout
     * @return string rendered view content.
     * @throws RuntimeException if the view file does not exist or is not a file.
     * @throws Throwable If an error occurred during rendering.
     * @psalm-suppress RedundantCondition, NoValue
     */
    public static function render(
        string $view,
        array $params = [],
        bool|string|null $layout = null,
        array $layoutParams = [],
    ): string {

        // view
        $view = preg_replace('/[^a-zA-Z0-9\-\/]/', '_', trim($view, '\/'));
        $viewPath = APP_DIR . '/views/' . $view . '.php';
        $content = static::renderInternal($viewPath, $params);

        // layout (override from the view)
        if (static::$layout) {
            $layout = static::$layout;
        }

        static::$layout = null;

        if ($layout) {
            $layoutPath = APP_DIR . '/views/layouts/' . trim($layout, '\/') . '.php';
            $layoutParams['content'] = $content;

            $content = self::renderInternal($layoutPath, $layoutParams);
        }

        return $content;
    }

    protected static function renderInternal(string $viewPath, array $params = [])
    {
        // view
        if (!file_exists($viewPath)) {
            throw new RuntimeException(sprintf('View file "%s" does not exist or is not a file.', $viewPath));
        }

        $_obInitialLevel_ = ob_get_level();
        ob_start();
        ob_implicit_flush(false);
        extract($params, EXTR_OVERWRITE);

        try {
            require $viewPath;

            return ob_get_clean();
        } catch (Exception $e) {
            while (ob_get_level() > $_obInitialLevel_) {
                if (!@ob_end_clean()) {
                    ob_clean();
                }
            }

            throw $e;
        } catch (Throwable $e) {
            while (ob_get_level() > $_obInitialLevel_) {
                if (!@ob_end_clean()) {
                    ob_clean();
                }
            }

            throw $e;
        }
    }

    /**
     * Get sub-view from URL.
     * ?r=settings/mqtt -> sub-view= mqtt
     * @return string
     */
    public static function getSubviewFromUrl(): string
    {
        $subView = 'index';
        $route = $_GET['r'] ?? null;
        if ($route) {
            $parts = explode('/', $route);
            if (!empty($parts[1])) {
                $subView = $parts[1];
            }
        }

        return $subView;
    }

}
