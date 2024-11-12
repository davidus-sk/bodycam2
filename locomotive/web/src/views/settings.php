<div class="relative h-full">
    <div class="container h-full d-flex justify-content-center align-items-center">
        
            <button id="btn-restart" type="button" class="btn btn-lg btn-cool btn-h-100" style="width: 220px;" data-bs-toggle="modal" data-bs-target="#restart">RESTART SYSTEM</button>
            <button id="btn-air" type="button" class="btn btn-lg btn-cool btn-h-100 ms-3" style="width: 220px;">BLOW AIR</button>
        
    </div>

    <!-- Modal -->
    <div id="restart" class="modal fade absolute" data-bs-theme="dark" data-bs-backdrop="static" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h1 class="modal-title fs-5">Restart system?</h1>
                </div>
                <div class="modal-body">
                    <div id="restart-content">
                        Are you sure you want to restart the system? It takes about 60 seconds.
                    </div>
                    <div id="restart-progress" style="display: none;">
                        <div class="mb-2">Please wait ... <span id="restart-time">60</span>s</div>
                        <div class="progress" role="progressbar">
                            <div class="progress-bar bg-success" style="width: 100%;"></div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer justify-content-between">
                    <button type="button" class="btn btn-lg btn-secondary" style="width: 170px" data-bs-dismiss="modal">Cancel</button>
                    <button id="btn-restart-confirm" type="button" class="btn btn-lg btn-warning" style="width: 170px" data-confirmed="0">Confirm restart</button>
                </div>
            </div>
        </div>
    </div>

</div>



<script>
$(function() {

    let $restart = $("#restart"),
        $restartContent = $("#restart-content"),
        $btnRestart = $("#btn-restart"),
        $btnRestartConfirm = $("#btn-restart-confirm"),
        $restartProgress = $("#restart-progress"),
        $restartTime = $("#restart-time"),
        restartTimer = null;

    let $btnBlowAir = $("#btn-air");

    $restart.on("show.bs.modal", function(e) {

    });

    $restart.on("hide.bs.modal", function(e) {
        if (restartTimer) {
            clearInterval(restartTimer);
            restartTimer = null;
        }

        $btnRestartConfirm
            .attr("data-confirmed", 0)
            .removeClass("btn-danger")
            .addClass("btn-warning")
            .html("Confirm restart");
        $restartProgress.hide();
        $restartContent.show();
    });

    $btnRestartConfirm.on("click", function(e) {
        e.preventDefault();
        var confirmed = parseInt($btnRestartConfirm.attr("data-confirmed")) || 0;

        if (confirmed) {
            $restartContent.hide();
            $restartProgress.show();
            var $bar = $restartProgress.find(".progress-bar");
            var timeTotal = 5,
                time = timeTotal,
                p = (time / timeTotal) * 100;

            $restartTime.html(time);

            restartTimer = setInterval(function() {
                time = time - 1;
                p = (time / timeTotal) * 100;
                $bar.css("width", p + "%");
            
                $restartTime.html(time);


                if (time <= 0) {
                    clearInterval(restartTimer);
                    restartTimer = null;
                    
                    $restartContent.html("Reloading ...");
                    $restartProgress.hide();
                    $restartContent.show();
                    setTimeout(() => {
                        window.location = 'index.php';
                    }, 3000);
                }
            }, 1000);

        } else {            
            $btnRestartConfirm
                .attr("data-confirmed", 1)
                .removeClass("btn-warning")
                .addClass("btn-danger")
                .html("Restart");
        }
        
    });

});
</script>
