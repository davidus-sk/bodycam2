<?php

// Form

use App\Base\Config;
use App\Helpers\FormHelper;
use App\Helpers\HtmlHelper;

// app config
$cfg = Config::get('mqtt');

$postData = [];
$postData['debug'] = $cfg['debug'];
$postData['host'] = $cfg['host'];
$postData['port'] = $cfg['port'];
$postData['username'] = $cfg['username'];
$postData['password'] = $cfg['password'];
$postData['keepalive'] = $cfg['keepalive'];
$postData['reconnectPeriod'] = $cfg['reconnectPeriod'];
$postData['protocol'] = $cfg['protocol'];
$postData['protocolVersion'] = $cfg['protocolVersion'];

$form = new FormHelper();
$form->setAttributes($postData);

if (isPost()) {

    $dataBefore = $postData;
    $postData = get_post('form');

    $form->setAttributes($postData, true);
    $form->input('host')->required();
    $form->input('port')->integer(['min' => 1]);
    $form->input('username')->required();
    $form->input('keepalive')->integer(['min' => 1]);
    $form->input('reconnectPeriod')->integer(['min' => 1000]);
    $form->input('protocol')->required();
    $form->input('protocolVersion')->integer();
    $valid = $form->validate();

    if ($valid) {

        try {

            // set values
            Config::set('mqtt', $form->getValues());

            // write to file
            $saved = Config::save();

            if ($saved) {
                success_messages('The settings were saved successfully.');
                redirect('/settings', ['tab' => 'mqtt']);
            }
        } catch (Exception $e) {
            error_message($e->getMessage());
            redirect('/settings', ['tab' => 'mqtt']);
        }
    }
}
?>

<form 
    id="settings-form" 
    method="post" 
    action="" 
    class="card card-dark" 
    data-bs-theme="dark" 
>
    <div class="card-body">
        <h5 class="card-title mb-4">MQTT Configuration</h5>

        <?=showMessages(); ?>

        <div class="mb-3<?=$form->errorClass('debug'); ?>">
            <label for="debug" class="form-label">Debug</label>
            <?php
            echo HtmlHelper::dropdown('form[debug]', yesNoArray(), $form->getValue('debug'), [
                'id' => 'debug',
                'class' => 'form-select',
            ]);
?>
            <?=$form->error('debug'); ?>
        </div>

        <div class="mb-3<?=$form->errorClass('host'); ?>">
            <label for="host" class="form-label">Host</label>
            <input 
                id="host" 
                type="text" 
                name="form[host]" 
                value="<?=htmlspecialchars($form->getValue('host') ?? ''); ?>" 
                class="form-control" 
                placeholder="Broker host" 
                autocomplete="off"
            />
            <?=$form->error('host'); ?>
        </div>

        <div class="mb-3<?=$form->errorClass('port'); ?>">
            <label for="port" class="form-label">Port</label>
            <input 
                id="port" 
                type="number" 
                name="form[port]" 
                value="<?=htmlspecialchars($form->getValue('port') ?? ''); ?>" 
                class="form-control" 
                placeholder="Broker port" 
                autocomplete="off"
            />
            <?=$form->error('port'); ?>
        </div>

        <div class="mb-3<?=$form->errorClass('username'); ?>">
            <label for="username" class="form-label">Username</label>
            <input 
                id="username" 
                type="text" 
                name="form[username]" 
                value="<?=htmlspecialchars($form->getValue('username') ?? ''); ?>" 
                class="form-control" 
                placeholder="The username required by your broker" 
                autocomplete="off"
            />
            <?=$form->error('username'); ?>
        </div>

        <div class="mb-3<?=$form->errorClass('password'); ?>">
            <label for="password" class="form-label">Password</label>
            <input 
                id="password" 
                type="text" 
                name="form[password]" 
                value="<?=htmlspecialchars($form->getValue('password') ?? ''); ?>" 
                class="form-control" 
                placeholder="The password required by your broker" 
                autocomplete="off"
            />
            <?=$form->error('password'); ?>
        </div>

        <div class="mb-3<?=$form->errorClass('keepalive'); ?>">
            <label for="keepalive" class="form-label">Keepalive</label>
            <input 
                id="keepalive" 
                type="number" 
                name="form[keepalive]" 
                value="<?=htmlspecialchars($form->getValue('keepalive') ?? ''); ?>" 
                class="form-control" 
                min="0"
                max="60"
                autocomplete="off"
            />
            <?=$form->error('keepalive'); ?>
        </div>

        <div class="mb-3<?=$form->errorClass('reconnectPeriod'); ?>">
            <label for="reconnectPeriod" class="form-label">Reconnect period</label>
            <input 
                id="reconnectPeriod" 
                type="number" 
                name="form[reconnectPeriod]" 
                value="<?=htmlspecialchars($form->getValue('reconnectPeriod') ?? ''); ?>" 
                class="form-control" 
                placeholder="Interval between two reconnections (milliseconds)" 
                autocomplete="off"
            />
            <?=$form->error('reconnectPeriod'); ?>
        </div>

        <div class="mb-3<?=$form->errorClass('protocol'); ?>">
            <label for="protocol" class="form-label">Protocol</label>
            <input 
                id="protocol" 
                type="text" 
                name="form[protocol]" 
                value="<?=htmlspecialchars($form->getValue('protocol') ?? ''); ?>" 
                class="form-control" 
                autocomplete="off"
            />
            <?=$form->error('protocol'); ?>
        </div>

        <div class="mb-5<?=$form->errorClass('protocolVersion'); ?>">
            <label for="protocolVersion" class="form-label">Protocol version</label>
            <?php
            echo HtmlHelper::dropdown('form[protocolVersion]', [
                4 => 4,
                5 => 5,
            ], $form->getValue('protocolVersion'), [
                'id' => 'protocolVersion',
                'class' => 'form-select',
            ]);
?>
            <?=$form->error('protocolVersion'); ?>
        </div>

        <div class="d-grid">
            <button type="submit" class="btn btn-lg btn-primary">
                Save 
            </button>
        </div>
    </div>
</method=>
