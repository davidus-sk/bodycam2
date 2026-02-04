<?php
$tab = $_GET['tab'] ?? 'index';
?>

<div class="container" style="max-width: 740px; margin: 0 auto;">    
    <?= render('settings/_navbar'); ?>
    <?= render('settings/' . $tab); ?>
</div>
