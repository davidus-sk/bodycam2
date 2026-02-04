<aside id="sidebar" aria-label="Sidebar">
    <div class="h-full overflow-y-auto position-relative">
        <div id="sidebar-toggle"><span></span></div>
        <ul class="sidebar-menu">
            <li>
                <a href="<?= url('/'); ?>" class="sidebar-menu-item<?=(VIEW === 'video' ? ' active' : ''); ?>">
                    <i class="icon ri-layout-grid-fill"></i>
                    <span class="label">Video</span>
                </a>
            </li>
            <li>
                <a href="<?= url('map'); ?>" class="sidebar-menu-item<?=(VIEW === 'map' ? ' active' : ''); ?>">
                    <i class="icon ri-road-map-fill"></i>
                    <span class="label">Map</span>
                </a>
            </li>
            <li>
                <a href="<?= url('settings'); ?>" class="sidebar-menu-item<?=(VIEW === 'settings' ? ' active' : ''); ?>">
                    <i class="icon ri-settings-3-line"></i>
                    <span class="label">Settings</span>
                </a>
            </li>
        </ul>

        <span class="separator"></span>

        <div id="mqtt-status" class="mt-4">OFFLINE</div>
        <div id="mqtt-status-count" class="mt-2">0</div>

    </div>
</aside>
