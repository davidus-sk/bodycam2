export class Modal {
    options = {};

    constructor(options, app) {
        this.options = this.initializeOptions(options);
        this.app = app;

        // events dispatcher
        //EventDispatcher.attach(this);

        // local variables
        this._$element = null;
        this._$parent = null;

        this._id = null;
        this._initialized = false;
        this._width = 0;
        this._height = 0;

        // id
        this._id = this.options.id = this.options.id ?? this._generateId();

        // parent
        if (typeof this.options.parent === 'string') {
            this._$parent = $(this.options.parent ?? 'body');
        } else if (typeof this.options.parent === 'object') {
            this._$parent = this.options.parent;
        } else {
            this._$parent = $('body');
        }

        // events
        this.onInit = this.options.onInit;
        this.beforeShow = this.options.beforeShow;
        this.onShow = this.options.onShow;
        this.beforeHide = this.options.beforeHide;
        this.onHide = this.options.onHide;
        this.onDestroy = this.options.onDestroy;

        // trigger event
        this.onInit?.(this);
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            id: undefined,
            width: 400,
            height: 400,
            parent: 'body',
            x: 'CENTER',
            y: 'CENTER',
            offsetX: 0,
            offsetY: 0,
            body: '',
            active: true,

            // events
            onInit: undefined,
            beforeShow: undefined,
            onShow: undefined,
            beforeHide: undefined,
            onHide: undefined,
            onDestroy: undefined,
        };

        return { ...defaultOptions, ...userOptions };
    }

    getId() {
        return this._id;
    }

    setBody(body) {}

    show() {
        // initialize new modal window
        if (this._initialized === false) {
            this._initialized = true;

            // generate html code
            const html = this._generateHtml();

            // append html
            this._$parent.css({ position: 'relative' }).append(html);

            // get reference
            this._$element = $('#' + this._id);

            // dimensions
            this._width = this.options.width;
            this._height = this.options.height;

            // position
            this.setPosition(
                this.options.x,
                this.options.y,
                this.options.offsetX,
                this.options.offsetY
            );
        }

        // close button
        this._$element.on('click', '.modal-close', e => {
            const data = $(e.target).data();

            this.hide(data);
        });

        // active
        if (this.options.active === true) {
            this.setActiveStatus(true);
        }

        // trigger event
        this.beforeShow?.();

        // already initialized
        this._$element.show();

        // trigger event
        this.onShow?.();

        // return instance
        return this;
    }

    hide(data) {
        if (this._initialized === true) {
            this._$element.hide();
        }

        // trigger event
        this.onHide?.(data);

        // return instance
        return this;
    }

    reset() {
        if (this._initialized === true) {
            this._$element.html('');
        }

        // return instance
        return this;
    }

    destroy() {
        if (this._initialized === true) {
            this.hide();
            this._$element.remove();
        }

        this._initialized = false;
        this._$element = undefined;

        // trigger event
        this.onDestroy?.();
    }

    setPosition(x, y, offsetX, offsetY) {
        let _x = x;
        let _y = y;
        let _offsetX = offsetX !== undefined ? offsetX : 0;
        let _offsetY = offsetY !== undefined ? offsetY : 0;

        if (typeof _offsetX !== 'number') {
            _offsetX = 0;
        }
        if (typeof _offsetY !== 'number') {
            _offsetY = 0;
        }

        let position = { x: 0, y: 0 };

        // center of parent element
        let center = this._getCenterCoordinates();
        let parentD = this._getParentDimensions();

        // X
        if (typeof _x === 'string') {
            _x = _x.toUpperCase();
            if (['LEFT', 'RIGHT', 'CENTER'].indexOf(_x) !== -1) {
                switch (_x) {
                    case 'LEFT':
                        position.x = _offsetX;
                        break;
                    case 'RIGHT':
                        position.x = parentD.width - _offsetX - this._width;
                        break;
                    case 'CENTER':
                        position.x = center.x + _offsetX - this._width / 2;
                        break;
                }
            }
        }

        // Y
        if (typeof _y === 'string') {
            _y = _y.toUpperCase();
            if (['TOP', 'BOTTOM', 'CENTER'].indexOf(_y) !== -1) {
                switch (_y) {
                    case 'TOP':
                        position.y = _offsetY;
                        break;
                    case 'BOTTOM':
                        position.y = parentD.height - _offsetY - this._height;
                        break;
                    case 'CENTER':
                        position.y = center.y + _offsetY - this._height / 2;
                        break;
                }
            }
        }

        this._$element.css({
            left: position.x + 'px',
            top: position.y + 'px',
        });

        // return instance
        return this;
    }

    zIndex(value) {
        this._$element.css('z-index', value);
    }

    setActiveStatus(active) {
        if (active === true) {
            this._$element.css('z-index', 9999);
            this._$element.addClass('active');
        } else {
            this._$element.css('z-index', 1000);
            this._$element.removeClass('active');
        }
    }

    setActive() {
        this.setActive(true);
    }

    _generateHtml() {
        const body = this.options.body ?? '';
        const width = this.options.width;
        const height = this.options.height;

        return `
        <div id="${this._id}" class="modal-win" tabindex="-1" style="display: none; width:${width}px; height:${height}px;">
            <div class="modal-win-dialog">
                ${body}
            </div>
        </div>
        `;
    }

    _generateId() {
        return 'modal-' + Math.random().toString(36).substring(2, 8);
    }

    _getParentDimensions() {
        return {
            width: this._$parent.outerWidth(),
            height: this._$parent.outerHeight(),
        };
    }

    _getCenterCoordinates() {
        var offset = this._$parent.offset();
        const d = this._getParentDimensions();

        var centerX = offset.left + d.width / 2;
        var centerY = offset.top + d.height / 2;

        return { x: centerX, y: centerY };
    }
}
