<?php

namespace App\Helpers;

use Exception;

class FormHelper
{
    public $errorTemplate = '<span class="form-error-message">{{error}}</span>';
    public $errorClass = 'is-error';

    private $attributes = [];
    private $rules = [];
    private $activeInputs = [];
    private $errors = [];

    // 'validation.accepted_if' => "The {attribute} field must be accepted if :other.",
    // 'validation.accepted' => "The {attribute} field must be accepted.",
    // 'validation.active_url' => "The {attribute} field must be an active URL.",
    // 'validation.alpha_numeric' => "The {attribute} field must be alphanumeric.",
    // 'validation.boolean' => "The {attribute} field must be a boolean.",
    // 'validation.confirmed_rule' => "The {attribute} field must be confirmed by the :confirmedAttribute field.",
    // 'validation.email_rule' => "The {attribute} field must be a valid email.",
    // 'validation.empty_data' => 'Validation data cannot be empty.',
    // 'validation.empty_rules' => 'Validation rules cannot be empty.',
    // 'validation.file_rule' => "The {attribute} field must be a file.",
    // 'validation.in_rule' => "The {attribute} field must be one of the following values: {value}s.",
    // 'validation.json' => "The {attribute} field must be a valid json.",
    // 'validation.lowercase_rule' => "The {attribute} field must be lowercase.",
    // 'validation.max_length_rule' => "The {attribute} field must not exceed {max} characters.",
    // 'validation.min_length_rule' => "The {attribute} field must exceed {min} characters.",
    // 'validation.not_in_rule' => "The {attribute} field must not be one of the following {value}s.",
    // 'validation.not_required_with' => "The {attribute} field is not required along with the {value} field.",
    // 'validation.nullable_rule' => "The {attribute} field can be null.",
    // 'validation.numeric_rule' => "The {attribute} field must be numeric.",
    // 'validation.password_rule' => "The {attribute} field must meet password requirements.",
    // 'validation.required_rule' => "The {attribute} field is required.",
    // 'validation.required_with' => "The {attribute} field is required along with the {value} field.",
    // 'validation.rule_not_found' => "Validation rule ':ruleName' not found.",
    // 'validation.same_rule' => "The {attribute} field must be identical to the :otherAttribute field.",
    // 'validation.size' => "The {attribute} field must have the required length {value}.",
    // 'validation.string_rule' => "The {attribute} field must be a string.",
    // 'validation.uppercase_rule' => "The {attribute} field must be uppercase.",
    // 'validation.url' => "The {attribute} field must be a valid url.",
    // 'validation.valid_ip' => "The {attribute} field must be a valid IP address.",

    private $errorMessages = [
        'en' => [
            'alpha_numeric' => [
                'Value must be alphanumeric.',
                'The {attribute} field must be alphanumeric.',
            ],
            'email_address' => [
                'Not a valid email address.',
                'The {attribute} field must be a valid email address.',
            ],
            'file' => [
                'The file does not exists.',
                'The file does not exists.',
            ],
            'image' => [
                'The file is not an image.',
                'The file is not an image.',
            ],
            'integer' => [
                'Hodnota musí byť celé číslo.',
                'Hodnota {attribute} musí byť celé číslo.',
            ],
            'ip_address' => [
                'Invalid IP address format.',
                'Invalid IP address format.',
            ],
            'length' => [
                'Value should contain {length} characters.',
                'The {attribute} should contain {length} characters.',
            ],
            'max_length' => [
                'Value must not exceed {max} characters.',
                'The {attribute} field must not exceed {max} characters.',
            ],
            'min_length' => [
                'Value must exceed {min} characters.',
                'The {attribute} field must exceed {min} characters.',
            ],
            'mac_address' => [
                'Invalid MAC address format.',
                'The {attribute} field must be a valid MAC address.',
            ],
            'max_size' => [
                'The file is too big. Its size cannot exceed {size} bytes.',
                'The file is too big. Its size cannot exceed {size} bytes.',
            ],
            'mime_type' => [
                'Only files with these MIME types are allowed: {mimeTypes}.',
                'Only files with these MIME types are allowed: {mimeTypes}.',
            ],
            'min_height' =>  [
                'The image height is too small. (min. height: {limit}px)',
                'The image height is too small. (min. height: {limit}px)',
            ],
            'min_size' => [
                'The file is too small. Its size cannot be smaller than {size} bytes.',
                'The file is too small. Its size cannot be smaller than {size} bytes.',
            ],
            'min_width' => [
                'The image width is too small. (min. width: {limit}px)',
                'The image width is too small. (min. width: {limit}px)',
            ],
            'number_max' => [
                '{attribute} must be no greater than {max}.',
                '{attribute} must be no greater than {max}.',
            ],
            'number_min' => [
                '{attribute} must be no less than {min}.',
                '{attribute} must be no less than {min}.',
            ],
            'number' => [
                'Value must be a number.',
                'Value must be a number.',
            ],
            'regex' => [
                'Input didn\'t match required format.',
                'Input didn\'t match required format.',
            ],
            'required' => [
                'This field is required',
                'This field is required',
            ],
            'validator' =>  [
                'Invalid value.',
                'Invalid value.',
            ],
        ],
        'sk' => [
            'alpha_numeric' => [
                'Hodnota môže obsahovať len znaky abecedy a čísla.',
                'Hodnota {attribute} môže obsahovať len znaky abecedy a čísla.',
            ],
            'email_address' => [
                'Neplatná emailová adresa.',
                'Hodnota {attribute} nie je platná emailová adresa.',
            ],
            'file' => [
                'The file does not exists.',
                'The file does not exists.',
            ],
            'image' => [
                'The file is not an image.',
                'The file is not an image.',
            ],
            'integer' => [
                'Value must be an integer.',
                'The {attribute} field must be an integer.',
            ],
            'ip_address' => [
                'Invalid IP address format.',
                'Invalid IP address format.',
            ],
            'length' => [
                'Hodnota musí mať {length} znakov.',
                'Hodnota {attribute} musí mať {length} znakov.',
            ],
            'max_length' => [
                'Hodnota nesmie byť dlhšia ako {max} znakov.',
                'Hodnota {attribute} nesmie byť dlhšia ako {max} znakov.',
            ],
            'min_length' => [
                'Hodnota musí mať najmenej {min} znakov.',
                'Hodnota {attribute} musí mať najmenej {min} znakov.',
            ],
            'mac_address' => [
                'Invalid MAC address format.',
                'The {attribute} field must be a valid MAC address.',
            ],
            'max_size' => [
                'The file is too big. Its size cannot exceed {size} bytes.',
                'The file is too big. Its size cannot exceed {size} bytes.',
            ],
            'mime_type' => [
                'Only files with these MIME types are allowed: {mimeTypes}.',
                'Only files with these MIME types are allowed: {mimeTypes}.',
            ],
            'min_height' =>  [
                'The image height is too small. (min. height: {limit}px)',
                'The image height is too small. (min. height: {limit}px)',
            ],
            'min_size' => [
                'The file is too small. Its size cannot be smaller than {size} bytes.',
                'The file is too small. Its size cannot be smaller than {size} bytes.',
            ],
            'min_width' => [
                'The image width is too small. (min. width: {limit}px)',
                'The image width is too small. (min. width: {limit}px)',
            ],
            'number_max' => [
                '{attribute} must be no greater than {max}.',
                '{attribute} must be no greater than {max}.',
            ],
            'number_min' => [
                '{attribute} must be no less than {min}.',
                '{attribute} must be no less than {min}.',
            ],
            'number' => [
                'Hodnota musí byť číslo.',
                'Hodnota musí byť číslo.',
            ],
            'regex' => [
                'Hodnota nemá požadovaný formát.',
                'Hodnota nemá požadovaný formát.',
            ],
            'required' => [
                'Toto pole je povinné.',
                'Toto pole je povinné.',
            ],
            'validator' =>  [
                'Neplatná hodnota.',
                'Neplatná hodnota.',
            ],
        ],
    ];

    /**
     * Class constructor
     * @param array|null $attributes
     */
    public function __construct(?array $attributes = null)
    {
        if ($attributes !== null) {
            $this->attributes = $attributes;
        }
    }

    /**
     * Get form attributes
     * @return array
     */
    public function getAttributes(): array
    {
        return $this->attributes;
    }

    /**
     * Get form values
     * @return array
     */
    public function getValues(): array
    {
        return $this->attributes;
    }

    /**
     * Get form attribute
     * @param string $attribute
     * @return mixed
     */
    public function getValue($attribute)
    {
        return array_key_exists($attribute, $this->attributes) ?
            $this->attributes[$attribute] : null;
    }

    /**
     * Set form attributes
     * @param string $attribute
     * @param mixed $value
     * @return static
     */
    public function setAttribute($attribute, $value)
    {
        $this->attributes[$attribute] = $value;

        return $this;
    }

    /**
     * Set form attributes
     * @param array $attributes
     * @param bool $numericCheck
     * @return array
     */
    public function setAttributes(array $attributes, bool $numericCheck = false)
    {
        if ($numericCheck === true) {
            $attributes = json_encode($attributes, JSON_NUMERIC_CHECK);
            $attributes = json_decode($attributes, true);
        }

        $this->attributes = $attributes;

        return $this->attributes;
    }

    /**
     * Check whether the POST request was submitted and store values
     * @return array
     */
    public function post(mixed $key = null): bool
    {
        if ($key !== null) {
            $data = $_POST[$key] ?? [];
        } else {
            $data = $_POST;
        }

        $this->setAttributes($data);

        return !empty($data);
    }

    /**
     * Set active input
     * @param string|array $attributes
     * @return static
     */
    public function input(string|array $attributes)
    {
        if (!is_array($attributes)) {
            $attributes = [$attributes];
        }

        $this->activeInputs = $attributes;

        return $this;
    }

    private function addRule(string $rule, array $ruleParams = [])
    {
        if (empty($this->activeInputs)) {
            throw new Exception('You must specify active input before setting the rules.');
        }

        foreach ($this->activeInputs as $attr) {

            if (!isset($this->rules[$attr])) {
                $this->rules[$attr] = [];
            }

            $this->rules[$attr][$rule] = $ruleParams;
        }

        return $this;
    }

    public function addError(string $attribute, $errorMessage, array $parameters = [])
    {
        if (!isset($this->errors[$attribute])) {
            $this->errors[$attribute] = [];
        }

        // Replace placeholders in the translation with the provided values.
        if ($parameters) {
            if (!isset($parameters['attribute'])) {
                $parameters['attribute'] = $attribute;
            }

            foreach ($parameters as $placeholder => $value) {
                $errorMessage = str_replace('{' . $placeholder . '}', $value, $errorMessage);
            }
        } else {
            $errorMessage = str_replace('{attribute}', $attribute, $errorMessage);
        }

        $this->errors[$attribute][] = $errorMessage;
    }

    public function formatError($message, array $params)
    {
        $placeholders = [];
        foreach ((array) $params as $name => $value) {
            $placeholders['{' . $name . '}'] = $value;
        }

        return ($placeholders === []) ? $message : strtr($message, $placeholders);
    }

    public function getErrors()
    {
        return $this->errors;
    }

    public function isError($attribute)
    {
        return !empty($this->errors[$attribute]);
    }

    public function getError($attribute)
    {
        return $this->isError($attribute) ? $this->errors[$attribute] : null;
    }

    public function getFirstError($attribute)
    {
        return $this->isError($attribute) ? $this->errors[$attribute][0] : null;
    }

    public function error($attribute)
    {
        $errorMessage = $this->getFirstError($attribute);

        if ($errorMessage) {
            $errorMessage = str_replace('{{error}}', $errorMessage, $this->errorTemplate);
        }

        return $errorMessage;
    }

    public function errorClass($attribute, string $prefix = ' ')
    {
        return $this->isError($attribute) ? $prefix . $this->errorClass : '';
    }

    public function validate()
    {
        $valid = false;

        foreach ($this->rules as $attr => $rules) {

            // get attribute value
            $attrValue = $this->getValue($attr);

            // validate value with all rules
            foreach ($rules as $rule => $ruleParams) {

                $customMessage = isset($ruleParams['error_message']);

                if ($customMessage) {
                    $errorMessage = $ruleParams['error_message'];
                } else {
                    $errorMessage = isset($this->errorMessages['sk'][$rule]) ? $this->errorMessages['sk'][$rule][0] : null;
                }

                // skip on error (default: true)
                $skipOnError = !isset($ruleParams['skipOnError']) || $ruleParams['skipOnError'] === true;
                if ($skipOnError && $this->isError($attr)) {
                    continue;
                }

                // skip empty
                $isEmpty = $attrValue === null || $attrValue === '' || $attrValue === false;
                //$skipEmpty = !$isRequired && $isEmpty;

                switch ($rule) {
                    case 'nullable':
                    case 'default_null':
                        if ($attrValue === null || $attrValue === '') {
                            $this->setAttribute($attr, null);
                        }

                        break;

                    case 'default_value':
                        if ($attrValue === null || $attrValue === '') {
                            $this->setAttribute($attr, $ruleParams['value'] ?? null);
                        }

                        break;

                    case 'required':
                        if ($isEmpty) {
                            $this->addError($attr, $errorMessage);
                        }

                        break;

                    case 'alpha_numeric':
                        if (!$isEmpty && !ctype_alnum($attrValue)) {
                            $this->addError($attr, $errorMessage);
                        }

                        break;

                    case 'number':
                    case 'integer':
                        if (!$isEmpty) {
                            $valid = false;

                            if (isset($ruleParams['integer_only']) && $ruleParams['integer_only'] === true) {
                                $valid = is_numeric($attrValue) && preg_match('/^[+-]?\d+$/', $attrValue);
                            } else {
                                $valid = is_numeric($attrValue);
                            }

                            if (!$valid) {
                                $this->addError($attr, $errorMessage);

                                break;
                            }

                            // min value
                            if (isset($ruleParams['min']) && is_numeric($ruleParams['min'])) {
                                if ($attrValue < $ruleParams['min']) {
                                    $msg = $customMessage ? $customMessage : $this->errorMessages['sk']['number_min'][0];
                                    $this->addError($attr, $msg);
                                }
                            }

                            // max value
                            if (isset($ruleParams['max']) && is_numeric($ruleParams['max'])) {
                                if ($attrValue > $ruleParams['max']) {
                                    $msg = $customMessage ? $customMessage : $this->errorMessages['sk']['number_max'][0];
                                    $this->addError($attr, $msg);
                                }
                            }
                        }

                        break;

                    case 'length':
                        if (!$isEmpty) {

                            $min = isset($ruleParams['min']) && is_numeric($ruleParams['min']) ? (int) $ruleParams['min'] : null;
                            $max = isset($ruleParams['max']) && is_numeric($ruleParams['max']) ? (int) $ruleParams['max'] : null;
                            $length = function_exists('mb_strlen') ? mb_strlen($attrValue) : strlen($attrValue);

                            // min/max value
                            if ($min !== null && $max !== null) {

                                // min
                                if ($length < $min) {
                                    $errorMessage = $customMessage ? $customMessage : $this->errorMessages['sk']['min_length'][0];
                                    $this->addError($attr, $errorMessage, [
                                        'min' => $min,
                                    ]);
                                }

                                // max
                                if ($length > $max) {
                                    $errorMessage = $customMessage ? $customMessage : $this->errorMessages['sk']['max_length'][0];
                                    $this->addError($attr, $errorMessage, [
                                        'max' => $max,
                                    ]);
                                }
                            } else {
                                if ($length !== $min) {
                                    $this->addError($attr, $errorMessage, [
                                        'length' => $min,
                                    ]);
                                }
                            }

                        }

                        break;

                    case 'min_length':
                        if (!$isEmpty) {

                            $length = function_exists('mb_strlen') ? mb_strlen($attrValue) : strlen($attrValue);
                            if ($length < $ruleParams['length']) {
                                $this->addError($attr, $errorMessage, [
                                    'min' => $ruleParams['length'],
                                ]);
                            }
                        }

                        break;

                    case 'max_length':
                        if (!$isEmpty) {
                            $length = function_exists('mb_strlen') ? mb_strlen($attrValue) : strlen($attrValue);

                            if ($length > $ruleParams['length']) {
                                $this->addError($attr, $errorMessage, [
                                    'max' => $ruleParams['length'],
                                ]);
                            }
                        }

                        break;

                    case 'regex':
                        if (!$isEmpty && !preg_match($ruleParams['pattern'], $attrValue)) {
                            $this->addError($attr, $errorMessage);
                        }
                        break;

                    case 'ip_address':
                        if (!$isEmpty && !filter_var($attrValue, FILTER_VALIDATE_IP)) {
                            $this->addError($attr, $errorMessage);
                        }
                        break;

                    case 'mac_address':
                        if (!$isEmpty && !filter_var($attrValue, FILTER_VALIDATE_MAC)) {
                            $this->addError($attr, $errorMessage);
                        }
                        break;

                    case 'validator':
                        $valid = false;
                        $callback = $ruleParams['callback'] ?? null;

                        if ($callback && is_callable($callback)) {
                            $result = call_user_func($callback, $attrValue);

                            if ($result !== true) {
                                $this->addError($attr, $errorMessage);
                            }
                        } else {
                            $this->addError($attr, 'Invalid validation rule.');
                        }
                        break;

                    case 'file':
                        if (!$isEmpty) {
                            if ($attrValue && file_exists($attrValue)) {
                                $finfo = new \finfo();
                                $mimeType = $finfo->file($attrValue, FILEINFO_MIME_TYPE);
                                if (!$mimeType || strpos($mimeType, 'image/') !== 0) {
                                    $this->addError($attr, 'The file is not a valid image.');
                                }
                            } else {
                                $this->addError($attr, 'The image file does not exist.');
                            }
                        }
                        break;

                    case 'image':
                        if (!$isEmpty) {
                            if ($attrValue && file_exists($attrValue)) {
                                $finfo = new \finfo();
                                $mimeType = $finfo->file($attrValue, FILEINFO_MIME_TYPE);
                                if (!$mimeType || strpos($mimeType, 'image/') !== 0) {
                                    $this->addError($attr, 'The file is not a valid image.');
                                }
                            } else {
                                $this->addError($attr, 'The image file does not exist.');
                            }
                        }
                        break;

                    case 'min_size':
                    case 'max_size':
                        if (!$isEmpty) {
                            if (file_exists($attrValue)) {
                                $size = filesize($attrValue);
                                if ($rule === 'min_size') {
                                    if ($size < $ruleParams['size']) {
                                        $this->addError($attr, ['limit' => $ruleParams['size']]);
                                    }
                                } elseif ($rule === 'max_size') {
                                    if ($size > $ruleParams['size']) {
                                        $this->addError($attr, ['limit' => $ruleParams['size']]);
                                    }
                                }
                            } else {
                                $this->addError($attr, 'The file does not exist.');
                            }
                        }
                        break;

                    case 'min_width':
                    case 'min_height':
                    case 'mime_type':
                        if (!$isEmpty) {
                            if (file_exists($attrValue)) {

                                $info = [];
                                $mimeType = mime_content_type($attrValue);

                                // image
                                if (!$mimeType || strpos($mimeType, 'image/') === 0) {
                                    $info = getimagesize($attrValue);

                                    if ($info) {
                                        if ($rule === 'min_width') {
                                            if ($info[0] < $ruleParams['width']) {
                                                $errorMessage = $this->formatError($errorMessage, ['limit' => $ruleParams['width']]);
                                                $this->addError($attr, $errorMessage);
                                            }
                                        } elseif ($rule === 'min_height') {
                                            if ($info[1] < $ruleParams['height']) {
                                                $errorMessage = $this->formatError($errorMessage, ['limit' => $ruleParams['height']]);
                                                $this->addError($attr, $errorMessage);
                                            }
                                        } elseif ($rule === 'mime_type') {
                                            $allowed = $ruleParams['mime_type'];
                                            if (!is_array($allowed)) {
                                                $allowed = [$allowed];
                                            }
                                            if (!in_array($info['mime'], $allowed)) {
                                                $errorMessage = $this->formatError($errorMessage, ['mimeTypes' => implode(', ', $allowed)]);
                                                $this->addError($attr, $errorMessage);
                                            }
                                        }
                                    } else {
                                        $this->addError($attr, 'Failed to read image data.');
                                    }
                                } else {
                                    $this->addError($attr, 'The file is not a valid image.');
                                }
                            } else {
                                $this->addError($attr, 'The file does not exist.');
                            }
                        }
                        break;

                }//switch
            }//foreach
        }//foreach

        return empty($this->errors);
    }

    // ------------------------------------------------------------
    // VALIDATION RULES
    // ------------------------------------------------------------

    public function nullable()
    {
        return $this->addRule('nullable');
    }

    public function defaultNull()
    {
        return $this->addRule('default_null');
    }

    public function default(mixed $value)
    {
        return $this->addRule('default_value', ['value' => $value]);
    }

    public function required(array $params = [], ?string $errorMessage = null)
    {
        return $this->addRule('required', array_merge($params, [
            'errorMessage' => $errorMessage,
        ]));
    }

    public function number(array $params = [], ?string $errorMessage = null)
    {
        return $this->addRule('number', array_merge($params, [
            'errorMessage' => $errorMessage,
        ]));
    }

    public function integer(array $params = [], ?string $errorMessage = null)
    {
        return $this->addRule('integer', array_merge($params, [
            'integer_only' => true,
        ])) ;
    }

    public function alphaNumeric(?string $errorMessage = null)
    {
        return $this->addRule('alpha_numeric', [
            'error_message' => $errorMessage,
        ]) ;
    }

    public function length(int $min, ?int $max = null, ?string $errorMessage = null)
    {
        return $this->addRule('length', [
            'min' => $min,
            'max' => $max,
            'error_message' => $errorMessage,
        ]);
    }

    public function minLength(int $value, ?string $errorMessage = null)
    {
        return $this->addRule('min_length', [
            'length' => $value,
            'error_message' => $errorMessage,
        ]);
    }

    public function maxLength(int $value, ?string $errorMessage = null)
    {
        return $this->addRule('max_length', [
            'length' => $value,
            'error_message' => $errorMessage,
        ]);
    }

    public function regex($pattern, ?string $errorMessage = null)
    {
        return $this->addRule('regex', [
            'pattern' => $pattern,
            'error_message' => $errorMessage,
        ]);
    }

    public function ipAddress(?string $errorMessage = null)
    {
        return $this->addRule('ip_address', [
            'error_message' => $errorMessage,
        ]);
    }

    public function macAddress($separator = '-', ?string $errorMessage = null)
    {
        return $this->addRule('mac_address', [
            'separator' => $separator,
            'error_message' => $errorMessage,
        ]);
    }

    public function emailAddress(?string $errorMessage = null)
    {
        return $this->addRule('email_address', [
            'error_message' => $errorMessage,
        ]);
    }

    public function validator($callback, ?string $errorMessage = null)
    {
        return $this->addRule('validator', [
            'callback' => $callback,
            'error_message' => $errorMessage,
        ]);
    }

    public function file(?string $errorMessage = null)
    {
        return $this->addRule('file', [
            'error_message' => $errorMessage,
        ]);
    }

    public function image(?string $errorMessage = null)
    {
        return $this->addRule('image', [
            'error_message' => $errorMessage,
        ]);
    }

    public function minSize($size, ?string $errorMessage = null)
    {
        return $this->addRule('min_size', [
            'size' => $size,
            'error_message' => $errorMessage,
        ]);
    }

    public function maxSize($size, ?string $errorMessage = null)
    {
        return $this->addRule('max_size', [
            'size' => $size,
            'error_message' => $errorMessage,
        ]);
    }

    public function minWidth($width, ?string $errorMessage = null)
    {
        return $this->addRule('min_width', [
            'width' => $width,
            'error_message' => $errorMessage,
        ]);
    }

    public function minHeight($height, ?string $errorMessage = null)
    {
        return $this->addRule('min_height', [
            'height' => $height,
            'error_message' => $errorMessage,
        ]);
    }

    public function mimeType($mimeType, ?string $errorMessage = null)
    {
        return $this->addRule('mimeType', [
            'mimeType' => $mimeType,
            'error_message' => $errorMessage,
        ]);
    }
}
