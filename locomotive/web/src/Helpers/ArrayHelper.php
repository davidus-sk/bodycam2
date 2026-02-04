<?php

namespace App\Helpers;

class ArrayHelper
{
    /**
     * Get array value
     * @param array $arr
     * @param string $value
     * @return mixed
     */
    public static function getValue(array $arr, $value): mixed
    {
        return $arr[$value] ?? null;
    }

    /**
     * Merges two or more arrays into one recursively.
     * @param array $a array to be merged to
     * @param array $b array to be merged from. You can specify additional
     * arrays via third argument, fourth argument etc.
     * @return array the merged array (the original arrays are not changed.)
     */
    public static function merge($a, $b)
    {
        $args = func_get_args();
        $res = array_shift($args);

        while (!empty($args)) {
            foreach (array_shift($args) as $k => $v) {
                if (is_int($k)) {
                    if (array_key_exists($k, $res)) {
                        $res[] = $v;
                    } else {
                        $res[$k] = $v;
                    }
                } elseif (is_array($v) && isset($res[$k]) && is_array($res[$k])) {
                    $res[$k] = !count($v) ? [] : static::merge($res[$k], $v);
                } else {
                    $res[$k] = $v;
                }
            }
        }

        return $res;
    }

    /**
     * Indexes and/or groups the array according to a specified key.
     * The input should be either multidimensional array or an array of objects.
     * @param array $array the array that needs to be indexed or grouped
     * @param string $key the column name
     * @return array the indexed array
     */
    public static function arrayIndex($array, $key, $groups = []): array
    {
        $result = [];
        $groups = (array) $groups;

        foreach ($array as $element) {
            $lastArray = &$result;

            foreach ($groups as $group) {
                $value = $element[$group] ?? null;
                if (!array_key_exists($value, $lastArray)) {
                    $lastArray[$value] = [];
                }
                $lastArray = &$lastArray[$value];
            }

            if ($key === null) {
                if (!empty($groups)) {
                    $lastArray[] = $element;
                }
            } else {
                $value = $element[$key] ?? null;
                if ($value !== null) {
                    $lastArray[$value] = $element;
                }
            }

            unset($lastArray);
        }

        return $result;
    }
}
