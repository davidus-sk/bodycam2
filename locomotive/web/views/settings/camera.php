<?php

// Form

use App\Base\Config;
use App\Helpers\FormHelper;
use App\Helpers\HtmlHelper;

// app config
$cfg = Config::get('camera');

$postData = [];
$postData['debug'] = $cfg['debug'];
$postData['timeout'] = $cfg['timeout'];
$postData['iceServers'] = $cfg['iceServers'];

$form = new FormHelper();
$form->setAttributes($postData);

if (isPost()) {

    $dataBefore = $postData;
    $postData = get_post('form');
    
    // fix types
    $postData['debug'] = (bool) $postData['debug'];

    // remove empty ice servers
    if (!empty($postData['iceServers'])) {
        foreach ($postData['iceServers'] as $idx => &$server) {
            if (empty($server['urls']) && empty($server['username']) && empty($server['credential'])) {
                unset($postData['iceServers'][$idx]);
            }
        }
    }

    $form->setAttributes($postData, true);
    $form->input('timeout')->required()->integer(['min' => 15000]);
    $valid = $form->validate();

    if ($valid) {

        try {

            // set values
            Config::set('camera', $form->getValues());

            // write to file
            $saved = Config::save();

            if ($saved) {
                success_messages('The settings were saved successfully.');
                redirect('/settings', ['tab' => 'camera']);
            }
        } catch (Exception $e) {
            error_message($e->getMessage());
            redirect('/settings', ['tab' => 'camera']);
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
        <h5 class="card-title mb-4">Camera Configuration</h5>

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


        <div class="mb-3<?=$form->errorClass('timeout'); ?>">
            <label for="timeout" class="form-label">Connection timeout</label>
            <input 
                id="timeout" 
                type="number" 
                name="form[timeout]" 
                value="<?=htmlspecialchars($form->getValue('timeout') ?? ''); ?>" 
                class="form-control" 
                placeholder="Connection timeout" 
                autocomplete="off"
            />
            <?=$form->error('port'); ?>
        </div>

        <div class="mb-3<?=$form->errorClass('iceServers'); ?>">
            <label for="timeout" class="form-label">ICE Servers</label>

            <div class="ice-servers">
                <?php 
                $_servers = $form->getValue('iceServers');
                $count = count($_servers);

                for ($i = 0; $i <= $count; $i++) {
                    $iceServer = $cfg['iceServers'][$i] ?? [];
                    $mt = $i === 0 ? '' : 'mt-3';
                    ?>
                
                <div class="ice-server">
                    <div class="<?= $mt; ?><?=$form->errorClass('iceServers.urls'); ?>">
                        <div class="input-group mb-1">
                            <span class="input-group-text justify-content-end" style="width:100px;">Urls:</span>
                            <input 
                                type="text" 
                                name="form[iceServers][<?= $i; ?>][urls]" 
                                value="<?=htmlspecialchars($_servers[$i]['urls'] ?? ''); ?>" 
                                class="form-control" 
                                autocomplete="off" 
                            />
                            <?=$form->error('host'); ?>
                        </div>
                    </div>
                    <div class="row g-1">
                        <div class="col-6">
                            <div class="mb-1<?=$form->errorClass('iceServers.username'); ?>">
                                <div class="input-group mb-1">
                                    <span class="input-group-text justify-content-end" style="width:100px;">Username:</span>
                                    <input 
                                        type="text" 
                                        name="form[iceServers][<?= $i; ?>][username]" 
                                        value="<?=htmlspecialchars($_servers[$i]['username'] ?? ''); ?>" 
                                        class="form-control" 
                                        autocomplete="off" 
                                    />
                                    <?=$form->error('iceServers.username'); ?>
                                </div>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="mb-1<?=$form->errorClass('iceServers.credential'); ?>">
                                <div class="input-group mb-1">
                                    <span class="input-group-text justify-content-end" style="width:100px;">Credential:</span>
                                    <input 
                                        type="text" 
                                        name="form[iceServers][<?= $i; ?>][credential]" 
                                        value="<?=htmlspecialchars($_servers[$i]['credential'] ?? ''); ?>" 
                                        class="form-control" 
                                        autocomplete="off" 
                                    />
                                    <?=$form->error('iceServers.credential'); ?>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <?php 
                }//for 
                ?>
            </div>
        </div>

        <div class="d-grid">
            <button type="submit" class="btn btn-lg btn-primary">
                Save 
            </button>
        </div>
    </div>
</form>
<script>
$(function() {
    /*
    const $servers = $("#ice-servers");
    let iceServersCount = $servers.length;
    let newCount = iceServersCount + 1;

    // get the first element with class ".ice-server" and create a copy
    var $iceServer = $('.ice-server').first().clone();
    // template
    var template = $iceServer.html();
    // Replace all occurrences of form[iceServers][0] with form[iceServers][iceServersCount]
    var html = template.replace(/form\[iceServers\]\[0\]/g, 'form[iceServers][' + newCount + ']');
    */
});
</script>
