<?php

namespace App\Helpers;

/**
 * HtmlHelper class file.
 * @category Helpers
 */
class HtmlHelper
{
    /**
     * Returns HTML escaped variable.
     *
     * @param mixed $var The input string or array of strings to be escaped.
     * @param bool $doubleEncode Set to FALSE prevents escaping twice.
     * @return string|array|null The escaped string or array of strings as a result.
     */
    public static function escape($var, bool $doubleEncode = true): string|array|null
    {
        if (empty($var)) {
            return $var;
        }

        if (is_array($var)) {
            foreach (array_keys($var) as $key) {
                $var[$key] = static::escape($var[$key], $doubleEncode);
            }

            return $var;
        }

        return htmlspecialchars($var, ENT_QUOTES, 'UTF-8', $doubleEncode);
    }

    /**
     * Stringify attributes for use in HTML tags.
     *
     * Helper function used to convert a string, array, or object
     * of attributes to a string.
     *
     * @param string|array $attributes
     * @param bool $js
     * @return string|null
     */
    public static function attrs_old(string|array $attributes, bool $js = false): ?string
    {
        if (empty($attributes)) {
            return null;
        }

        if (is_string($attributes)) {
            return ' ' . $attributes;
        }

        $attrs = '';
        foreach ($attributes as $key => $val) {
            $attrs .= $js ? $key . '=' . $val . ',' : ' ' . $key . '="' . $val . '"';
        }

        return rtrim($attrs, ',');
    }

    /**
     * Stringify attributes for use in HTML tags.
     *
     * Helper function used to convert a string, array, or object
     * of attributes to a string.
     *
     * @param string|array $attributes
     * @param bool $js
     * @return string|null
     */
    public static function attrs(string|array $attributes, bool $js = false): ?string
    {
        if (empty($attributes)) {
            return null;
        }

        if (is_string($attributes)) {
            return ' ' . $attributes;
        }

        if (is_array($attributes)) {
            $attrs = '';

            foreach ($attributes as $key => $val) {
                if ($val === null || $val === false) {
                    continue;
                } elseif (is_int($key)) {
                    $attrs .= $js ? $val . '=1,' : ' ' . $val;
                } elseif (is_bool($val)) {
                    $b = $val === true ? 'true' : 'false';
                    $attrs .= $js ? $key . '='. $b .',' : ($val === true ? ' ' . $key : '');
                } else {
                    $attrs .= $js ? $key . '=' . $val . ',' : ' ' . $key . '="' . htmlspecialchars($val, ENT_QUOTES, 'UTF-8') . '"';
                }
            }

            return rtrim($attrs, ',');
        }

        return null;
    }

    /**
     * Parse the form attributes
     * Helper function used by some of the form helpers
     *
     * @param string|array $attributes List of attributes
     * @param array $default Default values
     * @return string
     */
    public static function parse_form_attributes(string|array $attributes, array $default = []): string
    {
        if (is_array($attributes)) {
            foreach ($default as $key => $val) {
                if (isset($attributes[$key])) {
                    $default[$key] = $attributes[$key];
                    unset($attributes[$key]);
                }
            }

            if (count($attributes) > 0) {
                $default = array_merge($default, $attributes);
            }
        }

        $attr = '';

        foreach ($default as $key => $val) {
            if ($key === 'value') {
                $val = static::escape($val);
            } elseif ($key === 'name' && !strlen($default['name'])) {
                continue;
            }

            if ($val !== null) {
                $attr .= ' ' . $key . '="' . $val . '"';
            }
        }

        return trim($attr);
    }

    /**
     * Converts string to id=""
     * @param string $string
     * @return string
     */
    public static function strToId($string): string
    {
        return preg_replace('/[^a-z0-9_-]/', '', strtolower((string) $string));
    }

    /**
     * Heading
     *
     * Generates an HTML heading tag.
     *
     * @param string $data content
     * @param int $level heading level
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function heading(string|null $data, string|int $level = '1', array $options = []): string
    {
        $data = (string) $data;
        $level = (string) $level;

        return '<h' . $level . self::attrs($options) . '>' . $data . '</h' . $level . '>';
    }

    /**
     * Unordered List
     * Generates an HTML unordered list from an single or multi-dimensional array.
     *
     * @param array $list
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function ul($list, array $options = [])
    {
        return static::list('ul', $list, $options);
    }

    /**
     * Ordered List
     * Generates an HTML ordered list from an single or multi-dimensional array.
     *
     * @param array $list
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function ol($list, array $options = [])
    {
        return static::list('ol', $list, $options);
    }

    /**
     * Generates the list
     *
     * Generates an HTML ordered list from an single or multi-dimensional array.
     *
     * @param string $type
     * @param array|null $list
     * @param array $options the tag options in terms of name-value pairs.
     * @param int $depth
     * @return string|null
     */
    public static function list(string $type = 'ul', ?array $list = [], array $options = [], int $depth = 0): ?string
    {
        // If an array wasn't submitted there's nothing to do...
        if (!is_array($list)) {
            return null;
        }

        $type = strtolower((string) $type);

        // Set the indentation based on the depth
        $out = str_repeat(' ', $depth)
            // Write the opening list tag
            . '<' . $type . static::attrs($options) . ">\n";

        // Cycle through the list elements.  If an array is
        // encountered we will recursively call static::list()

        static $_last_list_item = '';
        foreach ($list as $key => $val) {
            $_last_list_item = $key;

            $out .= str_repeat(' ', $depth + 2) . '<li>';

            if (!is_array($val)) {
                $out .= $val;
            } else {
                $out .= $_last_list_item . "\n" . static::list($type, $val, [], $depth + 4) . str_repeat(' ', $depth + 2);
            }

            $out .= "</li>\n";
        }

        // Set the indentation for the closing tag and apply it
        return $out . str_repeat(' ', $depth) . '</' . $type . ">\n";
    }

    /**
     * Generates an <img /> element
     * @param string $src
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function img(string $src, array $options = []): string
    {
        if (!is_array($src)) {
            $src = ['src' => $src];
        }

        // If there is no alt attribute defined, set it to an empty string
        if (!isset($src['alt'])) {
            $src['alt'] = '';
        }

        $img = '<img';

        foreach ($src as $k => $v) {
            if ($k === 'src' && !preg_match('#^(data:[a-z,;])|(([a-z]+:)?(?<!data:)//)#i', $v)) {
                $img .= ' src="' . $v . '"';
            } else {
                $img .= ' ' . $k . '="' . $v . '"';
            }
        }

        return $img . static::attrs($options) . ' />';
    }

    /**
     * Text Input Field
     * @param string|array $name Input name
     * @param string $value the input value. Note that it will be encoded using [[encode()]]. Input value
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function input($name, mixed $value, array $options = []): string
    {
        $value = (string) $value;
        $defaults = [
            'id' => $options['id'] ?? null,
            'type' => 'text',
            'name' => is_array($name) ? null : $name,
            'value' => $value,
        ];

        return '<input ' . static::parse_form_attributes($name, $defaults) . static::attrs($options) . " />\n";
    }

    /**
     * Text Input Field
     * @param string|array $name Input name
     * @param string $value the input value. Note that it will be encoded using [[encode()]]. Input value
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function textInput(string|array $data, $value = null, array $options = []): string
    {
        return static::input($data, $value, $options);
    }

    /**
     * Number Field
     * @param mixed
     * @param string $value
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function numberInput(string|array $data, $value = null, array $options = []): string
    {
        is_array($data) || $data = ['name' => $data];
        $data['type'] = 'number';

        return static::input($data, $value, $options);
    }

    /**
     * Password Field
     * @param mixed
     * @param string $value
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function passwordInput(string|array $data, $value = null, array $options = []): string
    {
        is_array($data) || $data = ['name' => $data];
        $data['type'] = 'password';

        return static::input($data, $value, $options);
    }

    /**
     * Textarea field
     *
     * @param mixed $data
     * @param string $value the input value. Note that it will be encoded using [[encode()]].
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function textarea(string|array $data, $value = null, array $options = []): string
    {
        $defaults = [
            'id' => $options['id'] ?? null,
            'name' => is_array($data) ? null : $data,
            'cols' => '50',
            'rows' => '5'
        ];

        if (!is_array($data) || !isset($data['value'])) {
            $val = $value;
        } else {
            $val = $data['value'];
            unset($data['value']); // textarea don't use the value attribute
        }

        return '<textarea ' . static::parse_form_attributes($data, $defaults) . static::attrs($options) . '>'
            . static::escape($val)
            . "</textarea>\n";
    }

    /**
     * Drop-down Menu
     *
     * @param string|array $data
     * @param array $items
     * @param mixed $selected
     * @param array $options the tag options in terms of name-value pairs.
     * @param array $itemOptions
     * @return string
     */
    public static function dropdown(
        string|array $data,
        array $items = [],
        mixed $selected = [],
        array $options = [],
        array $itemOptions = []
    ): string {
        $defaults = [];

        if (is_array($data)) {

            if (isset($data['selected'])) {
                $selected = $data['selected'];
                unset($data['selected']); // select tags don't have a selected attribute
            }

            if (isset($data['items'])) {
                $items = $data['items'];
                unset($data['items']); // select tags don't use an items attribute
            }
        } else {
            $defaults = ['name' => $data];
        }

        is_array($selected) || $selected = [$selected];
        is_array($items) || $items = [$items];

        // If no selected state was submitted we will attempt to set it automatically
        if (empty($selected)) {
            if (is_array($data)) {
                if (isset($data['name'], $_POST[$data['name']])) {
                    $selected = [$_POST[$data['name']]];
                }
            } elseif (isset($_POST[$data])) {
                $selected = [$_POST[$data]];
            }
        }

        $options = static::attrs($options);
        $multiple = (count($selected) > 1 && stripos($options, 'multiple') === false) ? ' multiple="multiple"' : '';
        $form = '<select ' . rtrim(static::parse_form_attributes($data, $defaults)) . $options . $multiple . ">\n";

        foreach ($items as $key => $val) {
            $key = (string) $key;

            if (is_array($val)) {
                if (empty($val)) {
                    continue;
                }

                $form .= '<optgroup label="' . $key . "\">\n";

                foreach ($val as $optgroup_key => $optgroup_val) {
                    $sel = in_array($optgroup_key, $selected) ? ' selected="selected"' : '';
                    $form .= '<option value="' . static::escape($optgroup_key) . '"' . $sel . '>'
                        . (string) $optgroup_val . "</option>\n";
                }

                $form .= "</optgroup>\n";
            } else {
                $attrs = '';
                $a = $itemOptions[$key] ?? [];

                if (in_array($key, $selected)) {
                    $a['selected'] = true;
                }

                if ($a) {
                    $attrs = self::attrs($a);
                }

                $form .= '<option value="' . static::escape($key) . '"' . $attrs . '>'
                    . (string) $val . "</option>\n";
            }
        }

        return $form . "</select>\n";
    }

    /**
     * Checkbox Field
     *
     * @param string|array $data
     * @param string $value the input value. Note that it will be encoded using [[encode()]]. the value attribute. If it is null, the value attribute will not be generated.
     * @param bool $checked whether the checkbox should be checked.
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function checkbox(string|array $data, $value = null, bool $checked = false, array $options = []): string
    {
        $value = (string) $value;
        $defaults = [
            'id' => $options['id'] ?? null,
            'type' => 'checkbox',
            'name' => (!is_array($data) ? $data : null),
            'value' => $value
        ];

        if (is_array($data) && array_key_exists('checked', $data)) {
            $checked = $data['checked'];

            if ($checked == false) {
                unset($data['checked']);
            } else {
                $data['checked'] = 'checked';
            }
        }

        if ($checked == true) {
            $defaults['checked'] = 'checked';
        } else {
            unset($defaults['checked']);
        }

        return '<input ' . static::parse_form_attributes($data, $defaults) . static::attrs($options) . " />\n";
    }

    /**
     * Radio Button
     *
     * @param mixed $data
     * @param string $value the input value. Note that it will be encoded using [[encode()]].
     * @param bool
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function radio(string|array $data, $value = null, $checked = false, array $options = []): string
    {
        is_array($data) || $data = ['name' => $data];
        $data['type'] = 'radio';

        return static::checkbox($data, $value, $checked, $options);
    }

    /**
     * Form Button
     *
     * @param string|array $content the content enclosed within the button tag. It will NOT be HTML-encoded.
     * @param array $options
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function button(string|array $data, array $options = []): string
    {
        $defaults = [
            'type' => 'button',
        ];

        if (is_string($data)) {
            $content = $data;
        } else {
            if (is_array($data) && isset($data['content'])) {
                $content = $data['content'];
                unset($data['content']); // content is not an attribute
            } elseif (is_array($options) && isset($options['content'])) {
                $content = $options['content'];
                unset($options['content']); // content is not an attribute
            }
        }

        $opt = static::parse_form_attributes($data, $defaults);
        $options = static::attrs($options);

        return '<button ' . $opt . $options . '>' . $content . "</button>\n";
    }

    /**
     * Submit Button
     *
     * @param string|array $content the content enclosed within the button tag. It will NOT be HTML-encoded.
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function submitButton(string|array $content, array $options = []): string
    {
        $content = [
            'type' => 'submit',
            'content' => is_string($content) ? $content : null,
        ];

        return static::button($content, $options);
    }

    /**
     * Form Label Tag
     *
     * @param string $content The text to appear onscreen
     * @param string|null $id The id the label applies to
     * @param array $options the tag options in terms of name-value pairs.
     * @return string
     */
    public static function label($content, ?string $id = null, array $options = []): string
    {
        $label = '<label';

        if ($id !== null) {
            $label .= ' for="' . static::escape($id) . '"';
        }

        $label .= static::attrs($options);

        return $label . '>' . $content . '</label>';
    }

}
